"""founder 语料：作者编写的创业者陆晨的两周（corpus/founder/OUTLINE.md）。

节拍表 beats.json 是事实与标注的唯一来源；本脚本只做确定性的转换，不调用模型：

  render    beats.json → messages.json（入库，一行一条）与 BEATS.md（中文可读版）
  build     messages.json → frames.json（不入库）：从窗口起点的当地零点起每 12 小时一帧，与 composite 同形
  labels    beats.json + frames.json → labels.json 与 LABELS.md：作者标注（authored），覆盖全部五条流
  noise     frames.json → noise.json 与 NOISE.md：build_corpus 的噪音指标（认中文的附和），与大纲第 5 节的目标并排
  check     成品与节拍表的检查，任何一条不过就以非零退出；另打印各渠道条数与大纲第 5 节对照
  all       依次运行 render、build、labels、noise、check
  selftest  在临时目录里用小样例（scripts/fixtures/founder-mini）跑完各步，再逐条注入错误，确认 check 的每条规则都会报错

--root DIR 是读写的目录（默认 corpus/founder），--beats PATH 是节拍表（默认 <root>/beats.json）。正式内容写好之前：
  .venv/bin/python scripts/founder_corpus.py all --beats scripts/fixtures/founder-mini/beats.json --root .local/founder-mini
"""

from __future__ import annotations

import argparse
import collections
import copy
import datetime as dt
import hashlib
import json
import re
import shutil
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import family_stream  # noqa: E402
from build_corpus import TEXT_LIMIT, dump_lines, frame_bounds, local_iso, metric_table, metrics, parse_time, save  # noqa: E402

DEFAULT_ROOT = ROOT / "corpus" / "founder"
FIXTURE = ROOT / "scripts" / "fixtures" / "founder-mini" / "beats.json"
STREAMS = ("work", "community", "life", "family", "subscription")
SIDE_OF_STREAM = {"work": "work", "community": "work", "family": "life", "life": "life"}  # subscription 按渠道写 side
PROJECTS = ("main", "oss", "collab", "misc")
AUTHOR_KINDS = ("human", "self", "bot", "automation")
# kind：GitHub 沿用 curl 的名字（build_corpus.curl_events），其余 13 个见大纲第 7 节。
GITHUB_KINDS = ("issue_opened", "pr_opened", "comment", "review", "review_comment", "state_closed", "state_reopened",
                "state_merged", "state_review_requested", "state_assigned", "discussion_opened", "discussion_comment",
                "ci_failure", "release")
CHAT_KINDS = ("message", "voice", "image", "file", "forward", "recalled", "reaction", "call_log", "missed_call",
              "transfer", "poll", "system", "notification")
KINDS = GITHUB_KINDS + CHAT_KINDS
# 事件只带大纲第 7 节列出的字段；结构化的通话与转账不给模型看，形式从这里取。
REQUIRED = ("id", "channel", "from", "at", "stream", "text", "self", "text_length", "author_kind", "kind", "thread",
            "side", "text_origin", "origin")
OPTIONAL = ("subject", "url", "project", "edited", "call", "transfer")
STRUCTURED = {"call_log": ("call", ("direction", "peer", "seconds")), "missed_call": ("call", ("direction", "peer")),
              "transfer": ("transfer", ("direction", "peer", "amount"))}
RATIO = (2.7, 3.3)            # 工作侧 : 生活侧，大纲第 5 节
ASK_SHORT_MAX = 16            # 短问法，腕上一瞥只放得下一行
LABEL_MAX, SHORT_NAME_MAX = 20, 6
# 大纲第 6 节“不要用的词”：扫给 Agent 与读者看的标签、短名、问法、短问法、选项与旁白；人物的台词不扫。
BANNED = (
    ("生造的说法", r"接得住|接住|交出|落进|(?<!飞机)(?<!航班)落地|兜住|托底|闭环|抓手|拉齐|打穿|沉淀|颗粒度"),
    ("翻译腔", r"进行一个|做一个.{0,12}?的动作|基于|关于.{0,16}?的问题|我将会|对于.{0,16}?来说|被[^，。；,;]{0,12}?所(?!以|有|在)"),
    ("生硬的书面词", r"亟待|拟于|遂|业已|殊为|定夺|恐将|敬请|届时"),
    ("自造的比喻", r"信息洪流|噪音的海|注意力账本|敲响警钟|风暴"),
    ("夹在中文里的英文", r"(?i)(?<![a-z])(?:cutover|follow-up|booking|confirm|align|sync|escalation|blocker)"),
)
# 通话与转账没有写 text 也没有写 template 时的默认正文；节拍表的 templates 可以覆盖同名模板。
DEFAULT_TEMPLATES = {
    "call_log:out": "呼出 · {peer} · {duration}",
    "call_log:in": "来电 · {peer} · {duration}",
    "missed_call:in": "未接来电 · {peer}",
    "missed_call:out": "呼出未接通 · {peer}",
    "transfer:out": "向{peer}转账 ¥{amount}",
    "transfer:in": "{peer}向你转账 ¥{amount}",
}
# 大纲第 5 节的渠道表：(行, 流, 项目, 条数, 本人, 应忽略占他人发来 %)。节拍表的渠道用 row 指明计入哪一行。
TARGET_CHANNELS = (
    ("飞书 · 铃语全员", "work", "main", 160, 25, 65), ("飞书 · 白鹭上线", "work", "main", 170, 40, 30),
    ("飞书 · 单聊", "work", "main", 160, 55, 20), ("飞书 · 机器人", "work", "main", 180, 0, 85),
    ("GitHub · lingyu-ai/frontdesk", "work", "main", 120, 35, 45), ("微信 · 白鹭口腔×铃语", "work", "main", 130, 18, 50),
    ("微信 · 孟洁", "work", "main", 22, 9, 5), ("微信 · 小店老板", "work", "main", 28, 10, 30),
    ("邮件 · 工作", "work", "main", 26, 5, 40), ("电话", "work", "main", 16, 6, 30),
    ("GitHub · saydone/saydone", "work", "oss", 240, 55, 45), ("邮件 · saydone", "work", "oss", 10, 3, 30),
    ("微信 · 语音AI小聚·筹备", "work", "collab", 90, 24, 40), ("微信 · 老范、场地、赞助", "work", "collab", 26, 11, 15),
    ("报名小程序", "work", "collab", 40, 0, 95), ("邮件与 App · 杂项来信", "work", "misc", 55, 4, 90),
    ("Discord · saydone", "community", "oss", 100, 12, 85), ("X · 提及", "community", "oss", 15, 2, 70),
    ("微信 · 语音AI小聚③群", "community", "collab", 70, 3, 90), ("微信 · 杭州AI创业交流", "community", "misc", 80, 1, 95),
    ("微信 · 大模型应用开发", "community", "misc", 65, 2, 95), ("订阅 · 技术与行业", "subscription", None, 54, 0, 100),
    ("微信 · 韩敏", "family", None, 120, 48, 25), ("微信 · 一家人", "family", None, 35, 8, 60),
    ("微信 · 爸、妈", "family", None, 22, 8, 40), ("电话手表 · 可可", "family", None, 14, 4, 30),
    ("微信 · 三(2)班家长群", "family", None, 85, 2, 80), ("家校通知", "family", None, 8, 0, 40),
    ("微信 · 大二班家长群", "family", None, 35, 1, 85), ("微信 · 课外班", "family", None, 30, 5, 55),
    ("宠物医院", "family", None, 11, 3, 25), ("微信 · 业主群", "life", None, 50, 1, 95),
    ("物业与水电燃气", "life", None, 6, 0, 50), ("快递", "life", None, 35, 0, 90), ("购物与外卖订单", "life", None, 30, 0, 80),
    ("银行", "life", None, 30, 0, 90), ("携程、航空、酒店", "life", None, 14, 2, 30), ("体检与挂号", "life", None, 8, 1, 50),
    ("短信", "life", None, 15, 0, 100), ("App 推送与营销", "subscription", None, 72, 0, 100),
)
TARGET_STREAMS = {"work": (1473, 300), "community": (330, 20), "family": (360, 79), "life": (188, 4),
                  "subscription": (126, 0)}
# 大纲第 5 节“噪音目标与实测并排”的目标列，按原文照抄。
NOISE_TARGETS = {
    "inputs": "2477；88.5 / 200", "self": "16%", "machine": "约 25%", "low_info": "35–40%", "ignore": "约 60%",
    "exact": "约 7%", "near": "约 8%", "same_minute": "约 20%", "gap": "3–4", "length": "约 5 / 30 / 600",
    "under_20": "约 35%", "over_limit": "50–60", "night": "约 10%", "edited": "约 4%（另有约 15 条撤回）",
    "authors": "约 300；约 30%", "per_thread": "3 / 15", "multi_channel": "约 30", "resend": "约 15；25；35",
}
LEVEL_ORDER = {lv: n for n, lv in enumerate(family_stream.LEVELS)}
WEEKDAYS = "一二三四五六日"


class CheckFailed(Exception):
    pass


def paths(root: Path, beats: Path | None) -> SimpleNamespace:
    root = root.resolve()
    return SimpleNamespace(root=root, beats=(beats or root / "beats.json").resolve(), messages=root / "messages.json",
                           beats_md=root / "BEATS.md", frames=root / "frames.json", labels=root / "labels.json",
                           labels_md=root / "LABELS.md", noise=root / "noise.json", noise_md=root / "NOISE.md")


QUIET = False  # selftest 里各步的进度不打印


def log(message: str) -> None:
    if not QUIET:
        print(message, file=sys.stderr, flush=True)


def load_json(path: Path, hint: str):
    if not path.exists():
        raise SystemExit(f"找不到 {path}：{hint}")
    return json.loads(path.read_text(encoding="utf-8"))


def load_beats(p: SimpleNamespace) -> dict:
    return load_json(p.beats, f"内容还没写时，可以先用 --beats {FIXTURE.relative_to(ROOT)} 跑通各步")


def shown(path: Path) -> str:
    return str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else str(path)


# ---------- render：节拍表 → 事件 ----------

def messages_of(doc: dict) -> list[tuple[str, dict, dict]]:
    """(引用“<拍>.<序>”, 消息, 所属的拍或噪音组)，按节拍表里的先后；序从 1 起，dup_of 用同样的引用。"""
    out = []
    for parent in list(doc.get("beats", [])) + list(doc.get("noise", [])):
        for n, x in enumerate(parent.get("messages", []), 1):
            out.append((f"{parent['id']}.{n}", x, parent))
    return out


def event_id(ref: str) -> str:
    """fd- 加 origin 的 8 位摘要：不透露线的字母（大纲第 7 节）。"""
    return "fd-" + hashlib.sha1(f"authored:{ref}".encode()).hexdigest()[:8]


def duration_words(seconds: int) -> str:
    minutes, rest = divmod(int(seconds), 60)
    return f"{minutes} 分 {rest} 秒" if minutes and rest else f"{minutes} 分钟" if minutes else f"{rest} 秒"


def render_text(doc: dict, ref: str, x: dict) -> tuple[str, str]:
    """正文与来源：写了 template 就用模板；否则用 text；通话与转账都没写时用默认模板。"""
    structured = x.get("call") or x.get("transfer") or {}
    name = x.get("template")
    if name is None and "text" in x:
        return x["text"], "authored"
    if name is None and structured:
        name = f"{x.get('kind')}:{structured.get('direction')}"
    if name is None:
        raise SystemExit(f"{ref}：消息既没有 text，也没有 template")
    fmt = (doc.get("templates") or {}).get(name) or DEFAULT_TEMPLATES.get(name)
    if fmt is None:
        raise SystemExit(f"{ref}：未知模板 {name}")
    context = {**structured, **(x.get("params") or {})}
    if "seconds" in structured:
        context.setdefault("duration", duration_words(structured["seconds"]))
    try:
        return fmt.format_map(context), "template"
    except (KeyError, IndexError) as missing:
        raise SystemExit(f"{ref}：模板 {name} 缺参数 {missing}") from None


def side_of(stream: str | None, x: dict, channel: dict) -> str | None:
    if stream in SIDE_OF_STREAM:
        return SIDE_OF_STREAM[stream]
    return x.get("side") or channel.get("side")


def render(doc: dict) -> list[dict]:
    """节拍表 → 与 frames.json 同形的事件（不含帧号），按时间与 id 排序；字段见大纲第 7 节。"""
    zone = ZoneInfo(doc["window"]["timezone"])
    events = []
    for ref, x, parent in messages_of(doc):
        person = (doc.get("people") or {}).get(x.get("who"))
        channel = (doc.get("channels") or {}).get(x.get("ch"))
        if person is None or channel is None:
            raise SystemExit(f"{ref}：who {x.get('who')!r} 或 ch {x.get('ch')!r} 不在节拍表的 people / channels 里")
        text, text_origin = render_text(doc, ref, x)
        stream = x.get("stream") or channel.get("stream")
        item_key = x.get("item") or parent.get("item")
        item = (doc.get("items") or {}).get(item_key) or {}
        event = {"id": event_id(ref), "channel": channel["channel"], "from": x.get("from") or person["name"],
                 "at": local_iso(parse_time(x["at"]), zone), "stream": stream}
        if x.get("subject"):
            event["subject"] = x["subject"]
        if x.get("url"):
            event["url"] = x["url"]
        event["text"] = text[:TEXT_LIMIT]
        event["self"] = person.get("author_kind") == "self"
        event["text_length"] = len(text)
        event["author_kind"] = person.get("author_kind")
        event["kind"] = x.get("kind") or "message"
        event["thread"] = x.get("thread") or item_key or parent.get("thread")
        if stream in ("work", "community"):
            event["project"] = x.get("project") or channel.get("project") or item.get("project")
        event["side"] = side_of(stream, x, channel)
        if x.get("edited"):
            event["edited"] = True
        event["text_origin"] = text_origin
        event["origin"] = f"authored:{ref}"
        for key in ("call", "transfer"):
            if x.get(key):
                event[key] = dict(x[key])
        events.append(event)
    events.sort(key=lambda e: (parse_time(e["at"]), e["id"]))
    return events


def frame_label(doc: dict, at: str) -> str:
    """一个时刻落在哪一帧（f01 起，每 12 小时一帧），只用于可读版；窗口外写“窗口外”。"""
    zone = ZoneInfo(doc["window"]["timezone"])
    start = dt.datetime.combine(dt.date.fromisoformat(doc["window"]["start"]), dt.time(), zone)
    hours = (parse_time(at) - start).total_seconds() / 3600
    end = (dt.date.fromisoformat(doc["window"]["end"]) - start.date()).days * 24
    return f"f{int(hours // 12) + 1:02d}" if 0 <= hours < end else "窗口外"


def beats_md(doc: dict, events: list[dict]) -> str:
    asks = {b["ask"]["id"]: (b, b["ask"]) for b in doc.get("beats", []) if b.get("ask")}
    fate = {}
    for b in doc.get("beats", []):
        for key, word in (("answers", "答"), ("voids", "失效")):
            if b.get(key):
                first = min(b["messages"], key=lambda x: x["at"])["at"]
                fate[b[key]] = f"{word}（{b['id']}，{frame_label(doc, first)}）"
    count = collections.Counter(e["origin"].split(":", 1)[1].rsplit(".", 1)[0] for e in events)
    lines = [f"# {doc.get('title') or '创始人语料'}：节拍表（中文可读版）", "",
             "状态：由 `scripts/founder_corpus.py render` 从 [beats.json](beats.json) 生成，不要手改。成品见 "
             "[messages.json](messages.json)，方法见 [README.md](README.md)，设计见 [OUTLINE.md](OUTLINE.md)。", "",
             "“档”是这一拍之后 Fold 应给的关注（critical / high / normal / low / trace / none）；“问”是登记给他的问题，"
             "“答”与“失效”是它的去向；“错位”标出有意放进去的回错对象、答案先于问题或重复发送。", "",
             "## 事项", "", "| 事项 | 线 | 标签 | 短名 | 流 · 项目 | 拍数 |", "| --- | --- | --- | --- | --- | --- |"]
    beats_of = collections.Counter(b["item"] for b in doc.get("beats", []))
    for key, item in (doc.get("items") or {}).items():
        where = " · ".join(v for v in (item.get("stream"), item.get("project")) if v)
        lines.append(f"| `{key}` | {item.get('line', '')} | {item.get('title', '')} | {item.get('short', '')} | {where} | "
                     f"{beats_of[key]} |")
    lines += ["", "## 问题", "", "| 问 | 事项 | 问法 | 短问法 | 期限 | 登记 | 去向 |", "| --- | --- | --- | --- | --- | --- | --- |"]
    for ask_id, (b, ask) in asks.items():
        first = min(b["messages"], key=lambda x: x["at"])["at"]
        due = (ask.get("due") or "—").replace("T", " ")[:16]
        lines.append(f"| {ask_id} | `{b['item']}` | {ask['q']} | {ask.get('short', '')} | {due} | {b['id']}，{frame_label(doc, first)} | "
                     f"{fate.get(ask_id, '开着')} |")
    by_day = collections.defaultdict(list)
    for b in doc.get("beats", []):
        first = min(b["messages"], key=lambda x: x["at"])
        by_day[first["at"][:10]].append((first["at"], b))
    lines += ["", "## 逐日", ""]
    start = dt.date.fromisoformat(doc["window"]["start"])
    for day in sorted(by_day):
        d = dt.date.fromisoformat(day)
        n = (d - start).days
        lines += [f"### {d.month}/{d.day} 周{WEEKDAYS[d.weekday()]}（f{2 * n + 1:02d}–f{2 * n + 2:02d}）", "",
                  "| 时间 | 拍 | 事项 | 发生了什么 | 档 | 问题与去向 | 条数（应忽略） |", "| --- | --- | --- | --- | --- | --- | --- |"]
        for at, b in sorted(by_day[day], key=lambda t: t[0]):
            notes = []
            if b.get("ask"):
                notes.append(f"问 {b['ask']['id']}：{b['ask']['q']}（{b['ask'].get('short', '')}）")
            if b.get("answers"):
                notes.append(f"答 {b['answers']}：{asks.get(b['answers'], (None, {'q': '？'}))[1]['q']}")
            if b.get("voids"):
                notes.append(f"失效 {b['voids']}：{asks.get(b['voids'], (None, {'q': '？'}))[1]['q']}")
            if b.get("misfit"):
                notes.append(f"错位：{b['misfit']}")
            if b.get("note"):
                notes.append(b["note"])
            ignored = sum(1 for x in b["messages"] if x.get("ignore"))
            lines.append(f"| {at[11:16]} | {b['id']} | {b['item'].removeprefix('fd:')} | {b['gist']} | {b['level']} | "
                         f"{'；'.join(notes) or '—'} | {count[b['id']]}（{ignored}） |")
        lines.append("")
    lines += ["## 噪音层", "", "不服务剧情的群聊、通知与推送；除他本人的发言外按节拍表的 ignore 计。", "",
              "| 组 | 话题 | 渠道 | 条数（应忽略） | 时间 |", "| --- | --- | --- | --- | --- |"]
    channels = doc.get("channels") or {}
    for g in doc.get("noise", []):
        ats = sorted(x["at"] for x in g["messages"])
        span = ats[0][5:16].replace("T", " ") + ("" if ats[0][:10] == ats[-1][:10] else " … " + ats[-1][5:10])
        where = "、".join(dict.fromkeys(channels.get(x["ch"], {}).get("channel", x["ch"]) for x in g["messages"]))
        ignored = sum(1 for x in g["messages"] if x.get("ignore"))
        lines.append(f"| {g['id']} | {g.get('topic', '')} | {where} | {len(g['messages'])}（{ignored}） | {span} |")
    return "\n".join(lines) + "\n"


def step_render(p: SimpleNamespace) -> list[dict]:
    doc = load_beats(p)
    events = render(doc)
    p.root.mkdir(parents=True, exist_ok=True)
    p.messages.write_text(dump_lines({"source": doc.get("source", "founder"), "doc": "corpus/founder/README.md",
                                      "note": "作者编写的原创文本，由 beats.json 渲染；不要手改。", "events": events}) + "\n",
                          encoding="utf-8")
    p.beats_md.write_text(beats_md(doc, events), encoding="utf-8")
    log(f"渲染 {len(events)} 条 → {shown(p.messages)}、{shown(p.beats_md)}")
    return events


# ---------- build：事件 → 帧 ----------

def window_meta(doc: dict) -> dict:
    zone = ZoneInfo(doc["window"]["timezone"])
    start, end = (dt.datetime.combine(dt.date.fromisoformat(doc["window"][k]), dt.time(), zone) for k in ("start", "end"))
    return {"timezone": doc["window"]["timezone"], "window": {"from": start.isoformat(), "to": end.isoformat()}}


def build_frames(doc: dict, events: list[dict]) -> dict:
    meta = window_meta(doc)
    zone = ZoneInfo(meta["timezone"])
    bounds = frame_bounds(meta, 12)
    lo, hi = bounds[0][0], bounds[-1][1]
    outside = [e for e in events if not lo <= parse_time(e["at"]) < hi]
    if outside:
        raise SystemExit(f"{len(outside)} 条不在窗口 {meta['window']['from']} – {meta['window']['to']} 内："
                         + "、".join(f"{e['origin']} {e['at']}" for e in outside[:5]))
    events = sorted(events, key=lambda e: (parse_time(e["at"]), e["id"]))
    frames, cursor = [], 0
    for index, (start, end) in enumerate(bounds, 1):
        chunk = []
        while cursor < len(events) and parse_time(events[cursor]["at"]) < end:
            chunk.append(events[cursor])
            cursor += 1
        frames.append({
            "id": f"f{index:02d}", "at": local_iso(end, zone),
            "title": f"{end.astimezone(zone):%m-%d %H:%M} 前 12 小时 · {len(chunk)} 条输入",
            "events": chunk, "batch": None,
            "signal": {"type": "events" if chunk else "review", "reason": "每 12 小时定时整理", "received": len(chunk),
                       "window": {"from": local_iso(start, zone), "to": local_iso(end, zone)}}})
    counts = collections.Counter(e["stream"] for e in events)
    window = {"start": doc["window"]["start"], "end": doc["window"]["end"], **meta["window"]}
    persona = doc.get("persona")
    if not persona:
        raise SystemExit("节拍表缺 persona（name、role、context、accounts、language）")
    scenario = {
        "id": f"{doc.get('source', 'founder')}-{doc['window']['start']}",
        "title": doc.get("title") or "作者编写的创业者两周",
        "subtitle": f"{doc['window']['start']} 至 {doc['window']['end']}（不含）· {len(events)} 条输入（作者编写）· {len(frames)} 帧",
        "persona": persona,
        "startAt": frames[0]["at"], "endAt": frames[-1]["at"], "timeZone": meta["timezone"], "feedback": doc.get("feedback"),
        "streams": doc.get("streams"),
        "source": {"name": doc.get("source", "founder"), "window": window, "frame_hours": 12, "text_limit": TEXT_LIMIT,
                   "streams": {s: counts[s] for s in STREAMS if counts[s]}, "languages": doc.get("languages", ["zh"]),
                   "doc": "corpus/founder/README.md"},
        "frames": frames,
    }
    if scenario["streams"] is None:
        del scenario["streams"]
    return scenario


def step_build(p: SimpleNamespace) -> dict:
    doc = load_beats(p)
    events = load_json(p.messages, "先运行 render")["events"]
    scenario = build_frames(doc, events)
    save(p.frames, scenario)
    log(f"{len(events)} 条输入，{len(scenario['frames'])} 帧 → {shown(p.frames)}")
    return scenario


# ---------- labels：作者标注 ----------

LABEL_METHOD = {
    "basis": "authored", "source": "beats.json",
    "scope": "全部五条流：每条输入都来自节拍表，标注由作者写定",
    "level": "节拍表里作者写定的 Fold 关注档（critical / high / normal / low / trace / none），帧末取该事项最后一拍的档位",
    "tier": "行为档，口径同 composite 的家庭流：他本人合成的回复、评论、通话与转账算行动，24 小时内为 engaged、7 天内为 later，"
            "输入全是应忽略的为 noise，否则 untouched；它检验一致，不检验真实",
    "ignore": "节拍表里标了 ignore 的输入，依据前缀 authored；dup_of 写明它重复的是哪一条",
    "asks": "节拍表登记的问题：登记的输入与帧、被回答（answered）或失效（void）的输入与帧；到窗口结束仍开着的 resolved 为 null",
    "doc": "corpus/founder/LABELS.md",
}


def labels_of(doc: dict, scenario: dict, source: str = "beats.json") -> dict:
    """由节拍表与帧生成 labels.json：authored 一节与 composite 的家庭流同形（family_stream.labels），范围是全部五条流。"""
    events = [e for f in scenario["frames"] for e in f["events"]]
    work = copy.deepcopy(doc)
    work.setdefault("noise", [])
    message_of = {}
    for ref, x, _ in messages_of(work):
        x["id"] = event_id(ref)
        message_of[x["id"]] = x
    selves = [key for key, person in doc["people"].items() if person.get("author_kind") == "self"]
    if len(selves) != 1:
        raise SystemExit(f"people 里要有且只有一个 author_kind 为 self 的人，现在是 {selves}")
    zh = "zh" in (scenario.get("source") or {}).get("languages", [])
    section = family_stream.labels(work, scenario["frames"], events=events, self_who=selves[0],
                                   method={**LABEL_METHOD, "source": source}, zh=zh)
    for frame in section["frames"]:
        for entry in frame["ignore"]:
            dup = message_of[entry["event"]].get("dup_of")
            if dup:
                entry["dup_of"] = event_id(dup)
    section["cross_stream"] = [{"item": c["item"], "title": c["title"], "threads": c["life_threads"], "frames": c["frames"]}
                               for c in section["cross_stream"]]
    ignored = {i["event"] for f in section["frames"] for i in f["ignore"]}
    by_stream = {s: collections.Counter() for s in STREAMS}
    for e in events:
        c = by_stream[e["stream"]] if e["stream"] in by_stream else collections.Counter()
        c["self" if e["author_kind"] == "self" else "inputs"] += 1
        c["ignored"] += e["id"] in ignored
    inputs = sum(c["inputs"] for c in by_stream.values())
    return {
        "source": doc.get("source", "founder"), "window": scenario["source"]["window"], "doc": "corpus/founder/LABELS.md",
        "summary": {"inputs": inputs, "ignored": len(ignored), "ignored_share": round(len(ignored) / inputs, 3) if inputs else 0,
                    "by_stream": {s: dict(sorted(c.items())) for s, c in by_stream.items() if c}},
        "authored": {"scope": {"streams": list(STREAMS)}, **section},
    }


def labels_md(doc: dict, result: dict) -> str:
    section = result["authored"]
    s = section["summary"]
    lines = ["# 作者标注", "",
             "状态：由 `scripts/founder_corpus.py labels` 从 [beats.json](beats.json) 与本机的 frames.json 生成，不要手改；"
             "数据在 [labels.json](labels.json)。", "",
             "依据都是 authored：节拍表写定的应忽略、事项、关注档与问题，覆盖全部五条流。他本人的回复也是合成的，"
             "所以评测（`scripts/eval_judgment.py --free-run`）用它检验 Agent 与作者写定是否一致，不检验真实。规则见 labels.json 的 "
             "`authored.method`。", "",
             "## 规模", "", "| 流 | 他人发来 | 应忽略 | 占比 | 本人 |", "| --- | --- | --- | --- | --- |"]
    for stream, c in result["summary"]["by_stream"].items():
        share = f"{c.get('ignored', 0) / c['inputs']:.0%}" if c.get("inputs") else "—"
        lines.append(f"| {stream} | {c.get('inputs', 0)} | {c.get('ignored', 0)} | {share} | {c.get('self', 0)} |")
    total = result["summary"]
    lines.append(f"| 合计 | {total['inputs']} | {total['ignored']} | {total['ignored_share']:.0%} | "
                 f"{sum(c.get('self', 0) for c in total['by_stream'].values())} |")
    lines += ["", f"事项帧 {sum(v for k, v in s.items() if k.startswith('tier_'))} 个：" +
              "、".join(f"{k.removeprefix('tier_')} {v}" for k, v in s.items() if k.startswith("tier_")) +
              f"；作者档 high 以上 {s.get('high', 0)} 个。问题 {s.get('asks', 0)} 个：答 {s.get('asks_answered', 0)}、"
              f"失效 {s.get('asks_void', 0)}、到窗口结束仍开着 {s.get('asks_open', 0)}。", "",
              "## 问题", "", "| 问 | 事项 | 短问法 | 登记 | 去向 |", "| --- | --- | --- | --- | --- |"]
    for ask in section["asks"]:
        r = ask["resolved"]
        where = f"{'答' if r['how'] == 'answered' else '失效'}，{r['frame']}" if r else "开着"
        lines.append(f"| {ask['id']} | `{ask['item']}` | {ask.get('short', '')} | {ask['registered']['frame']} | {where} |")
    lines += ["", "## 每帧", "", "作者档在 normal 以上的事项，以及当时开着的问题；其余事项只计数。", "",
              "| 帧 | critical / high | normal | 其余事项 | 开着的问题 | 应忽略 |", "| --- | --- | --- | --- | --- | --- |"]
    for frame in section["frames"]:
        items = frame["items"]
        hot = "、".join(f"{i['thread'].removeprefix('fd:')}（{i['level']}）" for i in items if i["level"] in ("critical", "high"))
        normal = "、".join(i["thread"].removeprefix("fd:") for i in items if i["level"] == "normal")
        rest = sum(1 for i in items if LEVEL_ORDER[i["level"]] > LEVEL_ORDER["normal"])
        asks = "、".join(sorted({a for i in items for a in i.get("open_asks", [])}))
        lines.append(f"| {frame['frame']} | {hot or '—'} | {normal or '—'} | {rest} | {asks or '—'} | {len(frame['ignore'])} |")
    return "\n".join(lines) + "\n"


def step_labels(p: SimpleNamespace) -> dict:
    doc = load_beats(p)
    scenario = load_json(p.frames, "先运行 build")
    result = labels_of(doc, scenario, "beats.json" if p.beats.parent == p.root else shown(p.beats))
    save(p.labels, result, lines=True)
    p.labels_md.write_text(labels_md(doc, result), encoding="utf-8")
    s = result["authored"]["summary"]
    log(f"标注 → {shown(p.labels)}、{shown(p.labels_md)}：应忽略 {result['summary']['ignored']} 条（占他人发来 "
        f"{result['summary']['ignored_share']:.0%}），问题 {s.get('asks', 0)} 个")
    return result


# ---------- noise：噪音画像 ----------

def side_counts(events: list[dict]) -> dict:
    sides = collections.Counter(e.get("side") for e in events)
    work, life = sides.get("work", 0), sides.get("life", 0)
    return {"work": work, "life": life, "ratio": round(work / life, 2) if life else None}


def extras_of(doc: dict, events: list[dict]) -> dict:
    """metrics() 之外、第 5 节要看的数：应忽略占他人发来、再发、半截话、转发、撤回，以及工作与生活之比。"""
    message_of = {event_id(ref): x for ref, x, _ in messages_of(doc)}
    others = [e for e in events if e["author_kind"] != "self"]
    ignored = sum(1 for e in others if message_of.get(e["id"], {}).get("ignore"))
    kinds = collections.Counter(e["kind"] for e in events)
    resend = sum(1 for e in others if message_of.get(e["id"], {}).get("ignore") == "resend")
    fragment = sum(1 for e in events if message_of.get(e["id"], {}).get("fragment"))
    return {"ignore_share": round(ignored / len(others), 3) if others else 0, "resend": resend, "fragment": fragment,
            "forward": kinds.get("forward", 0), "recalled": kinds.get("recalled", 0), "sides": side_counts(events)}


def pct(value: float | None, digits: int = 0) -> str:
    return "—" if value is None else f"{value * 100:.{digits}f}%"


def noise_rows(m: dict, x: dict) -> dict:
    n = m["inputs"] or 1
    k = m["author_kinds"]
    edited = pct(m["edited_after_post"] / n, 1) + (f"（撤回 {x['recalled']}）" if x.get("recalled") is not None else "")
    resend = "；".join(str(x[key]) for key in ("resend", "fragment", "forward")) if "resend" in x else "—"
    return {
        "inputs": f"{m['inputs']}；{m['per_frame']['mean']} / {m['per_frame']['max']}",
        "self": pct(k.get("self", 0) / n), "machine": pct((k.get("bot", 0) + k.get("automation", 0)) / n),
        "low_info": pct(m["low_info"]["share_of_non_self"]), "ignore": x.get("ignore", "—"),
        "exact": pct(m["duplicates"]["share_exact"], 1), "near": pct(m["duplicates"]["share_near"], 1),
        "same_minute": pct(m["gaps_minutes"]["same_minute"] / n, 1), "gap": f"{m['gaps_minutes']['p50']:g}",
        "length": " / ".join(f"{m['length_chars'][q]:.0f}" for q in ("p10", "p50", "p90")),
        "under_20": pct(m["length_chars"]["under_20"] / n, 1), "over_limit": str(m["length_chars"]["over_limit"]),
        "night": pct(m["local_hours"]["night_00_07"] / n, 1), "edited": edited,
        "authors": f"{m['distinct_authors']}；{m['top_authors_share']:.0%}",
        "per_thread": f"{m['threads']['inputs_per_thread_p50']:g} / {m['threads']['inputs_per_thread_p90']:g}",
        "multi_channel": str(m["threads"]["multi_channel_threads"]), "resend": resend,
    }


NOISE_LABELS = (
    ("inputs", "条数；每帧均值 / 最多"), ("self", "本人占比"), ("machine", "机器人与群发占比"),
    ("low_info", "低信息量占他人发来（文本规则）"), ("ignore", "应被忽略占他人发来（标注）"), ("exact", "核心文本完全重复"),
    ("near", "近重复（≥30 字）"), ("same_minute", "同一分钟连续到达"), ("gap", "到达间隔中位（分钟）"),
    ("length", "长度 P10 / 中位 / P90"), ("under_20", "短于 20 字"), ("over_limit", "超过 2000 字被截断"),
    ("night", "当地 0–7 点到达"), ("edited", "发出后被编辑"), ("authors", "不同作者；前 5 位占比"),
    ("per_thread", "每事项输入 中位 / P90"), ("multi_channel", "跨渠道的事项"), ("resend", "“??”再发；半截话；转发"),
)


def reference_columns() -> list[tuple[str, dict]]:
    """前三列：curl-bagder、composite 与其中的家庭流，指标取自入库的 noise.json，应被忽略取自入库的 labels.json。"""
    curl = json.loads((ROOT / "corpus" / "curl-bagder" / "noise.json").read_text(encoding="utf-8"))["corpus"]
    comp = json.loads((ROOT / "corpus" / "composite" / "noise.json").read_text(encoding="utf-8"))
    curl_labels = json.loads((ROOT / "corpus" / "curl-bagder" / "labels.json").read_text(encoding="utf-8"))["summary"]
    family_labels = json.loads((ROOT / "corpus" / "composite" / "labels.json").read_text(encoding="utf-8"))["family"]["summary"]
    return [
        ("curl-bagder", noise_rows(curl, {"ignore": f"{pct(curl_labels['ignore_events'] / curl_labels['input_events'])}（工作流弱标注）"})),
        ("composite", noise_rows(comp["corpus"], {})),
        ("其中家庭流", noise_rows(comp["streams"]["family"],
                             {"ignore": pct(family_labels["ignore_events"] / family_labels["input_events"])})),
    ]


def channel_rows(doc: dict, events: list[dict]) -> list[tuple]:
    """第 5 节的每一行，加上不在第 5 节里的渠道（行名后注明）：(行名, 流, 条数 目标/实际, 本人 目标/实际, 应忽略 目标/实际)。

    节拍表的渠道用 row 指明计入第 5 节的哪一行，没写就按渠道名；应忽略按节拍表的 ignore，占他人发来。
    """
    message_of = {event_id(ref): x for ref, x, _ in messages_of(doc)}
    row_of = {c["channel"]: c.get("row") or c["channel"] for c in (doc.get("channels") or {}).values()}
    counts = collections.defaultdict(collections.Counter)
    for e in events:
        c = counts[row_of.get(e["channel"], e["channel"])]
        c["n"] += 1
        c["self"] += e["author_kind"] == "self"
        if e["author_kind"] != "self":
            c["others"] += 1
            c["ignored"] += bool(message_of.get(e["id"], {}).get("ignore"))

    def ignored(c):
        return pct(c["ignored"] / c["others"]) if c["others"] else "—"
    rows = []
    for row, stream, _, n, mine, ignore in TARGET_CHANNELS:
        c = counts.pop(row, collections.Counter())
        rows.append((row, stream, f"{n} / {c['n']}", f"{mine} / {c['self']}", f"{ignore}% / {ignored(c)}"))
    rows += [(f"{row}（不在第 5 节）", "", f"— / {c['n']}", f"— / {c['self']}", f"— / {ignored(c)}")
             for row, c in sorted(counts.items())]
    return rows


def channel_table(doc: dict, events: list[dict]) -> str:
    lines = ["| 渠道（第 5 节的行） | 流 | 条数 目标 / 实际 | 本人 目标 / 实际 | 应忽略 目标 / 实际 |", "| --- | --- | --- | --- | --- |"]
    lines += ["| " + " | ".join(row) + " |" for row in channel_rows(doc, events)]
    by_stream = collections.Counter(e["stream"] for e in events)
    self_stream = collections.Counter(e["stream"] for e in events if e["author_kind"] == "self")
    lines += ["", "| 流 | 条数 目标 / 实际 | 本人 目标 / 实际 |", "| --- | --- | --- |"]
    for stream, (n, mine) in TARGET_STREAMS.items():
        lines.append(f"| {stream} | {n} / {by_stream.get(stream, 0)} | {mine} / {self_stream.get(stream, 0)} |")
    sides = side_counts(events)
    lines.append(f"| 合计 | 2477 / {len(events)} | 403 / {sum(self_stream.values())} |")
    lines += ["", f"工作侧 {sides['work']}，生活侧 {sides['life']}，比例 {sides['ratio']} : 1（目标 3.0，检查范围 {RATIO[0]}–{RATIO[1]}）。"]
    return "\n".join(lines)


def noise_md(doc: dict, result: dict, events: list[dict]) -> str:
    refs = reference_columns()
    mine = noise_rows(result["corpus"], {**result["extra"], "ignore": pct(result["extra"]["ignore_share"])})
    headers = [name for name, _ in refs] + ["本语料目标", "本语料实测"]
    lines = ["# 噪音画像", "",
             "状态：由 `scripts/founder_corpus.py noise` 从本机的 frames.json 生成，不要手改；数据在 [noise.json](noise.json)。"
             "口径与 [curl-bagder 的指标口径](../curl-bagder/NOISE.md#指标口径)相同（`build_corpus.metrics`），低信息量另认中文的附和"
             "（“收到”“好的”“1”“+1”“嗯嗯”“收到谢谢老师”）与表情代码（[玫瑰]）。目标照抄[大纲第 5 节](OUTLINE.md#5-渠道与条数)；"
             "前三列取自入库的 noise.json 与 labels.json；“应被忽略”取节拍表的 ignore。差得多的回到节拍表调整，不在成品里补丁。", "",
             "## 目标与实测", "", "| 指标 | " + " | ".join(headers) + " |", "| --- |" + " --- |" * len(headers)]
    for key, label in NOISE_LABELS:
        lines.append(f"| {label} | " + " | ".join(cols[key] for _, cols in refs) + f" | {NOISE_TARGETS[key]} | {mine[key]} |")
    lines += ["", "“再发”是节拍表里 ignore 为 resend 的输入；“半截话”是标了 fragment 的消息；“转发”是 kind 为 forward 的输入。", "",
              "## 各渠道", "", channel_table(doc, events), "", "## 各流", "",
              metric_table([result["streams"][s] for s in STREAMS], list(STREAMS))]
    return "\n".join(lines) + "\n"


def step_noise(p: SimpleNamespace) -> dict:
    doc = load_beats(p)
    scenario = load_json(p.frames, "先运行 build")
    zone = ZoneInfo(scenario["timeZone"])
    zh = "zh" in scenario["source"].get("languages", [])
    events = [{**e, "author": e["from"], "frame": f["id"]} for f in scenario["frames"] for e in f["events"]]
    result = {"source": scenario["source"]["name"], "zh_rules": zh,
              "corpus": metrics(events, scenario["frames"], zone, zh), "streams": {}}
    for stream in STREAMS:
        frames = [{"events": [e for e in f["events"] if e["stream"] == stream]} for f in scenario["frames"]]
        result["streams"][stream] = metrics([e for e in events if e["stream"] == stream], frames, zone, zh)
    for e in events:  # metrics() 往事件上写的中间值不进成品
        e.pop("_core", None)
        e.pop("_info", None)
    result["extra"] = extras_of(doc, events)
    save(p.noise, result)
    p.noise_md.write_text(noise_md(doc, result, events), encoding="utf-8")
    log(f"噪音 → {shown(p.noise)}、{shown(p.noise_md)}；低信息量占他人发来 {result['corpus']['low_info']['share_of_non_self']:.0%}，"
        f"应忽略 {result['extra']['ignore_share']:.0%}，工作 : 生活 = {result['extra']['sides']['ratio']}")
    return result


# ---------- check ----------

def base_name(name: str) -> str:
    name = re.sub(r"[（(].*?[)）]", "", name).split(" · ")[0]
    return name.strip().lstrip("~").strip()


def latin_tokens(name: str) -> set[str]:
    return set(re.findall(r"[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ]{2,}", name))


def reference_names() -> dict:
    """手写情境（prototype/STORY.md 与 data/story/scenario.mjs）与 composite（人物与家庭流）用过的名字和姓。"""
    story = (ROOT / "prototype" / "data" / "story" / "scenario.mjs").read_text(encoding="utf-8")
    story_md = (ROOT / "prototype" / "STORY.md").read_text(encoding="utf-8")
    senders = set(re.findall(r"\[\s*'[^'\n]*',\s*'([^'\n]+)',\s*'", story))
    people = set(re.findall(r"persona:\s*\{\s*name:\s*'([^']+)'", story))
    people |= set(re.findall(r"^# (\S+?)的两周", story_md, re.M))
    people |= {s.split(" · ")[0] for s in senders if " · " in s}
    nicknames = {m for s in senders for m in re.findall(r"[小老][一-鿿]", s)}
    surnames = {n[0] for n in people if re.fullmatch(r"[一-鿿]{2,3}", n)} | {n[1] for n in nicknames}
    family = json.loads((ROOT / "corpus" / "composite" / "family" / "beats.json").read_text(encoding="utf-8"))
    composite = {p["name"] for p in family["people"].values()}
    scenario = (ROOT / "prototype" / "data" / "composite" / "scenario.mjs").read_text(encoding="utf-8")
    composite |= set(re.findall(r'"persona":\{"name":"([^"]+)"', scenario))
    return {"story": people | nicknames, "surnames": surnames, "composite": {base_name(n) for n in composite},
            "tokens": set().union(*(latin_tokens(n) for n in composite))}


def name_collisions(doc: dict) -> list[str]:
    ref = reference_names()
    out = []
    for key, person in (doc.get("people") or {}).items():
        name = base_name(person.get("name", ""))
        if name in ref["story"]:
            out.append(f"{key}「{person['name']}」与手写情境重名")
        elif name in ref["composite"]:
            out.append(f"{key}「{person['name']}」与 composite 重名")
        elif re.fullmatch(r"[一-鿿]{2,3}", name) and name[0] not in "小老阿" and name[0] in ref["surnames"]:
            out.append(f"{key}「{person['name']}」的姓「{name[0]}」手写情境用过（{'、'.join(sorted(ref['surnames']))}）")
        elif re.fullmatch(r"[小老阿][一-鿿]", name) and name[1] in ref["surnames"]:
            out.append(f"{key}「{person['name']}」的姓「{name[1]}」手写情境用过")
        elif latin_tokens(person.get("name", "")) & ref["tokens"]:
            out.append(f"{key}「{person['name']}」与 composite 的名字重合：{sorted(latin_tokens(person['name']) & ref['tokens'])}")
    return out


def agent_texts(doc: dict) -> list[tuple[str, str]]:
    """给 Agent 与读者看的文字：事项标签与短名、问法、短问法与选项、旁白（gist、misfit、note、噪音话题）。"""
    out = []
    for key, item in (doc.get("items") or {}).items():
        out += [(f"{key}.title", item.get("title") or ""), (f"{key}.short", item.get("short") or "")]
    for b in doc.get("beats", []):
        out += [(f"{b['id']}.{field}", b[field]) for field in ("gist", "misfit", "note") if b.get(field)]
        if b.get("ask"):
            ask = b["ask"]
            out += [(f"{ask['id']}.q", ask.get("q") or ""), (f"{ask['id']}.short", ask.get("short") or "")]
            out += [(f"{ask['id']}.options", option) for option in ask.get("options") or []]
    out += [(f"{g['id']}.topic", g["topic"]) for g in doc.get("noise", []) if g.get("topic")]
    return out


def reference_errors(doc: dict) -> list[str]:
    out = []
    for key in ("window", "people", "channels", "items", "beats"):
        if not doc.get(key):
            out.append(f"节拍表缺 {key}")
    if out:
        return out
    ids = collections.Counter(g["id"] for g in doc.get("beats", []) + doc.get("noise", []))
    out += [f"拍或噪音组的编号 {i} 用了 {n} 次" for i, n in ids.items() if n > 1]
    asks = collections.Counter(b["ask"]["id"] for b in doc["beats"] if b.get("ask"))
    out += [f"问题 {i} 登记了 {n} 次" for i, n in asks.items() if n > 1]
    refs = {ref for ref, _, _ in messages_of(doc)}
    for b in doc["beats"]:
        if b.get("item") not in doc["items"]:
            out.append(f"{b['id']}：事项 {b.get('item')!r} 不在 items 里")
        if b.get("level") not in family_stream.LEVELS:
            out.append(f"{b['id']}：档位 {b.get('level')!r} 不在 {family_stream.LEVELS} 里")
        for key in ("answers", "voids"):
            if b.get(key) and b[key] not in asks:
                out.append(f"{b['id']}：{key} {b[key]!r} 不是登记过的问题")
    for ref, x, parent in messages_of(doc):
        if x.get("who") not in doc["people"]:
            out.append(f"{ref}：who {x.get('who')!r} 不在 people 里")
        if x.get("ch") not in doc["channels"]:
            out.append(f"{ref}：ch {x.get('ch')!r} 不在 channels 里")
        if x.get("item") and x["item"] not in doc["items"]:
            out.append(f"{ref}：事项 {x['item']!r} 不在 items 里")
        if x.get("dup_of") and x["dup_of"] not in refs:
            out.append(f"{ref}：dup_of {x['dup_of']!r} 不是节拍表里的消息")
        if not parent.get("item") and not parent.get("thread") and not x.get("thread"):
            out.append(f"{ref}：噪音组 {parent['id']} 没有 thread")
    return out


def event_errors(events: list[dict], doc: dict, where: str) -> dict[str, list[str]]:
    """一份事件列表（渲染结果、messages.json 或 frames.json）的检查：编号、先后、窗口、流与字段。"""
    errors = collections.defaultdict(list)
    meta = window_meta(doc)
    lo, hi = parse_time(meta["window"]["from"]), parse_time(meta["window"]["to"])
    for event_id_, n in collections.Counter(e.get("id") for e in events).items():
        if n > 1:
            errors["duplicate_id"].append(f"{where}：{event_id_} 出现 {n} 次")
    timed = [e for e in events if e.get("at")]
    for before, e in zip(timed, timed[1:]):
        if (parse_time(e["at"]), e.get("id") or "") < (parse_time(before["at"]), before.get("id") or ""):
            errors["order"].append(f"{where}：{e.get('id')} {e['at']} 排在更晚的 {before.get('id')} {before['at']} 之后")
    for e in events:
        name = e.get("id") or e.get("origin") or "?"
        if e.get("at") and not lo <= parse_time(e["at"]) < hi:
            errors["window"].append(f"{where}：{name} {e['at']} 不在窗口 {meta['window']['from']} – {meta['window']['to']} 内")
        if e.get("stream") not in STREAMS:
            errors["stream"].append(f"{where}：{name} 的流 {e.get('stream')!r} 不在 {STREAMS} 里")
        missing = [k for k in REQUIRED if e.get(k) in (None, "")]
        if e.get("stream") in ("work", "community") and e.get("project") not in PROJECTS:
            missing.append(f"project（{e.get('project')!r}，应为 {'/'.join(PROJECTS)}）")
        extra = [k for k in e if k not in REQUIRED + OPTIONAL]
        problems = []
        if e.get("author_kind") not in AUTHOR_KINDS:
            problems.append(f"author_kind {e.get('author_kind')!r}")
        if e.get("self") is not (e.get("author_kind") == "self"):
            problems.append("self 与 author_kind 不一致")
        if e.get("side") not in ("work", "life"):
            problems.append(f"side {e.get('side')!r}（subscription 的渠道要写 side）")
        if e.get("kind") not in KINDS:
            problems.append(f"kind {e.get('kind')!r} 不在大纲第 7 节的列表里")
        if e.get("id") and not re.fullmatch(r"fd-[0-9a-f]{8}", e["id"]):
            problems.append(f"id {e['id']!r} 不是 fd- 加 8 位摘要")
        if isinstance(e.get("text"), str) and isinstance(e.get("text_length"), int) and e["text_length"] < len(e["text"]):
            problems.append("text_length 比正文短")
        if e.get("kind") in STRUCTURED:
            field, needed = STRUCTURED[e["kind"]]
            value = e.get(field) or {}
            lacking = [k for k in needed if value.get(k) in (None, "")]
            if lacking or value.get("direction") not in ("in", "out"):
                problems.append(f"{e['kind']} 要带结构化的 {field}：{{{', '.join(needed)}}}，direction 为 in / out")
        if missing or extra or problems:
            errors["fields"].append(f"{where}：{name} " + "；".join(
                ([f"缺 {', '.join(missing)}"] if missing else []) + ([f"多出 {', '.join(extra)}"] if extra else []) + problems))
    return errors


def check(p: SimpleNamespace, quiet: bool = False) -> dict[str, list[str]]:
    """返回 {规则: [问题]}；空表示通过。引用错到渲染不出来时只报 refs。"""
    doc = load_beats(p)
    errors: dict[str, list[str]] = collections.defaultdict(list)
    errors["refs"] += reference_errors(doc)
    try:
        events = render(doc)
    except (SystemExit, KeyError, TypeError, ValueError) as failed:
        errors["refs"].append(f"渲染失败：{failed}")
        return {rule: problems for rule, problems in errors.items() if problems}
    sources = [("渲染结果", events)]
    if p.messages.exists():
        stored = json.loads(p.messages.read_text(encoding="utf-8"))["events"]
        sources.append(("messages.json", stored))
        if stored != events:
            errors["stale"].append("messages.json 与 beats.json 的渲染结果不一致，先运行 render")
    if p.frames.exists():
        scenario = json.loads(p.frames.read_text(encoding="utf-8"))
        framed = [e for f in scenario["frames"] for e in f["events"]]
        sources.append(("frames.json", framed))
        if framed != events:
            errors["stale"].append("frames.json 与渲染结果不一致，先运行 render 与 build")
        expected = len(frame_bounds(window_meta(doc), 12))
        if len(scenario["frames"]) != expected:
            errors["window"].append(f"frames.json 有 {len(scenario['frames'])} 帧，窗口应切成 {expected} 帧")
        for f in scenario["frames"]:
            lo, hi = parse_time(f["signal"]["window"]["from"]), parse_time(f["signal"]["window"]["to"])
            for e in f["events"]:
                if e.get("at") and not lo <= parse_time(e["at"]) < hi:
                    errors["window"].append(f"frames.json：{e.get('id')} {e['at']} 不在所在帧 {f['id']} 的窗口内")
    for where, items in sources:
        for rule, problems in event_errors(items, doc, where).items():
            errors[rule] += problems
    for where, text in agent_texts(doc):
        for family, pattern in BANNED:
            for hit in re.finditer(pattern, text):
                errors["banned"].append(f"{where}「{text}」用了{family}「{hit.group(0)}」")
    errors["names"] += name_collisions(doc)
    for b in doc["beats"]:
        short = (b.get("ask") or {}).get("short")
        if b.get("ask") and (not short or len(short) > ASK_SHORT_MAX):
            errors["short"].append(f"{b['ask']['id']} 的短问法「{short}」{len(short or '')} 字，应在 1–{ASK_SHORT_MAX} 字")
    for key, item in doc["items"].items():
        if not item.get("title") or len(item["title"]) > LABEL_MAX:
            errors["length"].append(f"{key} 的标签「{item.get('title')}」应在 1–{LABEL_MAX} 字")
        if not item.get("short") or len(item["short"]) > SHORT_NAME_MAX:
            errors["length"].append(f"{key} 的短名「{item.get('short')}」应在 1–{SHORT_NAME_MAX} 字")
    sides = side_counts(events)
    if sides["ratio"] is None or not RATIO[0] <= sides["ratio"] <= RATIO[1]:
        errors["ratio"].append(f"工作侧 {sides['work']} : 生活侧 {sides['life']} = {sides['ratio']}，应在 {RATIO[0]}–{RATIO[1]}")
    if not quiet:
        print(f"## 各渠道与第 5 节\n\n{channel_table(doc, events)}\n")
    return {rule: problems for rule, problems in errors.items() if problems}


def step_check(p: SimpleNamespace) -> None:
    errors = check(p)
    if not errors:
        print(f"检查通过：{shown(p.beats)}")
        return
    print("检查未通过：", file=sys.stderr)
    for rule, problems in errors.items():
        for problem in problems[:12]:
            print(f"- [{rule}] {problem}", file=sys.stderr)
        if len(problems) > 12:
            print(f"- [{rule}] …… 另有 {len(problems) - 12} 处", file=sys.stderr)
    raise SystemExit(1)


# ---------- selftest：小样例与逐条注入的错误 ----------

def _beats(change):
    def apply(p: SimpleNamespace) -> None:
        doc = json.loads(p.beats.read_text(encoding="utf-8"))
        change(doc)
        p.beats.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        for step in (step_render, step_build):
            try:
                step(p)
            except SystemExit:
                break  # 例如窗口外的输入：build 拒绝写帧，留给 check 报出来
    return apply


def _frames(change):
    def apply(p: SimpleNamespace) -> None:
        scenario = json.loads(p.frames.read_text(encoding="utf-8"))
        change(scenario)
        save(p.frames, scenario)
    return apply


def _swap_first_pair(scenario: dict) -> None:
    frame = next(f for f in scenario["frames"] if len({e["at"] for e in f["events"]}) > 1)
    frame["events"][0], frame["events"][1] = frame["events"][1], frame["events"][0]


def _drop_call(doc: dict) -> None:
    """通话记录照写正文，只去掉结构化的 call：渲染得出，字段检查要报。"""
    x = next(x for _, x, _ in messages_of(doc) if x.get("kind") == "call_log")
    x["text"] = "来电 · 3 分钟"
    x.pop("call")


def _first_ask(doc: dict) -> dict:
    return next(b["ask"] for b in doc["beats"] if b.get("ask"))


MUTATIONS = (
    ("duplicate_id", "两拍用了同一个编号，消息的 id 撞在一起",
     _beats(lambda d: d["beats"][1].__setitem__("id", d["beats"][0]["id"]))),
    ("order", "frames.json 里一帧的前两条输入调换先后", _frames(_swap_first_pair)),
    ("window", "一条消息挪到窗口结束之后（9/21 09:00）",
     _beats(lambda d: d["beats"][0]["messages"][0].__setitem__("at", "2026-09-21T09:00:00+08:00"))),
    ("stream", "一个渠道的流写成 personal", _beats(lambda d: next(iter(d["channels"].values())).__setitem__("stream", "personal"))),
    ("fields", "frames.json 里一条输入缺 author_kind",
     _frames(lambda s: next(e for f in s["frames"] for e in f["events"]).pop("author_kind"))),
    ("fields", "通话记录没带结构化的 call", _beats(_drop_call)),
    ("banned", "事项标签里用了“闭环”", _beats(lambda d: next(iter(d["items"].values())).__setitem__("title", "白鹭上线闭环"))),
    ("banned", "旁白里用了“confirm”", _beats(lambda d: d["beats"][0].__setitem__("gist", "等孟洁 confirm 切换时间"))),
    ("names", "加一个与手写情境重名的人（周屿）",
     _beats(lambda d: d["people"].__setitem__("zhouyu", {"name": "周屿", "author_kind": "human"}))),
    ("names", "加一个姓林的人（手写情境的姓）",
     _beats(lambda d: d["people"].__setitem__("linxiao", {"name": "林晓", "author_kind": "human"}))),
    ("names", "加一个与 composite 家庭流重名的人（Kajsa）",
     _beats(lambda d: d["people"].__setitem__("kajsa", {"name": "Kajsa", "author_kind": "human"}))),
    ("short", "短问法写到 17 字", _beats(lambda d: _first_ask(d).__setitem__("short", "明早九点半谁带土豆去宠物医院打疫苗"))),
    ("ratio", "把一个工作渠道改成家庭流，比例跌出 2.7–3.3",
     _beats(lambda d: next(c for c in d["channels"].values() if c.get("row") == "飞书 · 机器人").update(stream="family", project=None))),
)


def selftest(beats: Path) -> None:
    global QUIET
    QUIET = True
    with tempfile.TemporaryDirectory(prefix="founder-mini-") as tmp:
        base = Path(tmp) / "base"
        base.mkdir()
        shutil.copy(beats, base / "beats.json")
        p = paths(base, None)
        for step in (step_render, step_build, step_labels, step_noise):
            step(p)
        clean = check(p, quiet=True)
        if clean:
            raise SystemExit(f"小样例本身没通过检查：{clean}")
        scenario = json.loads(p.frames.read_text(encoding="utf-8"))
        labels = json.loads(p.labels.read_text(encoding="utf-8"))
        again = Path(tmp) / "again"
        shutil.copytree(base, again)
        for step in (step_render, step_build):
            step(paths(again, None))
        same = all((base / name).read_bytes() == (again / name).read_bytes() for name in ("messages.json", "frames.json"))
        print(f"小样例：{sum(len(f['events']) for f in scenario['frames'])} 条输入，{len(scenario['frames'])} 帧，"
              f"问题 {len(labels['authored']['asks'])} 个，检查通过；重跑 render 与 build 逐字节相同：{same}")
        if not same:
            raise SystemExit("render / build 的输出不确定")
        failed = []
        for n, (rule, what, mutate) in enumerate(MUTATIONS, 1):
            work = Path(tmp) / f"m{n:02d}"
            shutil.copytree(base, work)
            q = paths(work, None)
            mutate(q)
            errors = check(q, quiet=True)
            fired = rule in errors
            print(f"  {'✓' if fired else '✗'} [{rule}] {what} → " + (errors[rule][0] if fired else f"没有报出；报了 {sorted(errors)}"))
            failed += [] if fired else [rule]
        if failed:
            raise SystemExit(f"这些规则没有在注入的错误上报出：{failed}")
        print(f"注入 {len(MUTATIONS)} 种错误，check 的 {len({r for r, _, _ in MUTATIONS})} 条规则都报出了。")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=("render", "build", "labels", "noise", "check", "all", "selftest"))
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="读写的目录，默认 corpus/founder")
    parser.add_argument("--beats", type=Path, help="节拍表，默认 <root>/beats.json")
    args = parser.parse_args()
    if args.command == "selftest":
        selftest(args.beats or FIXTURE)
        return 0
    p = paths(args.root, args.beats)
    steps = {"render": [step_render], "build": [step_build], "labels": [step_labels], "noise": [step_noise],
             "check": [step_check], "all": [step_render, step_build, step_labels, step_noise, step_check]}
    for step in steps[args.command]:
        step(p)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
