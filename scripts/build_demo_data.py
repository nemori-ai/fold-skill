"""把自由运行的结果打磨成原型演示数据：prototype/data/<name>/scenario.mjs。

输入（前两项只在本机，第三、四项入库）：
  corpus/<name>/frames.json                 语料原文（化名改写后的版本；composite 含作者编写的家庭流）
  prototype/data/<name>/agent-batches.json  自由运行里 Agent 每帧被接受的批次与处置（由 --import-run 从运行目录导出）
  prototype/data/<name>/edits.json          打磨：对 Agent 批次的修正、处置更正、旁白、信号、回应路径与反馈
修正只改批次，再用内存内核从空状态逐帧重放；任何一帧被拒绝就停下并报出原因，不手改最终状态。

用法：
  .venv/bin/python scripts/build_demo_data.py composite --import-run .local/eval/free-20261015-161501
  .venv/bin/python scripts/build_demo_data.py composite            # 重放并写出 scenario.mjs，再用原型引擎回放核对
  .venv/bin/python scripts/build_demo_data.py composite --report   # 另打印每帧根层与修正清单，供写 POLISH.md

演示数据的正文截到 500 字符以内并带原链接（化名链接，不一定能打开）；字段形态见 prototype/README.md。
"""

from __future__ import annotations

import argparse
import collections
import copy
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fold import MemoryStore  # noqa: E402

TEXT_LIMIT = 500
# Enron 营销群发只用于评测时的噪音，不进演示数据（见 POLISH.md）：输入删去，Agent 对它的引用一并去掉。
DROPPED_PREFIXES = ("promo:",)
QUOTE_LIMIT = 280
STREAM_NAMES = {"work": "工作", "family": "家庭", "life": "生活", "community": "社区", "subscription": "订阅"}
PALETTE = ["#2f7f6f", "#b8643a", "#c49a2c", "#86569c", "#3a78b0", "#c04f78", "#5b8c37", "#8a6a3c",
           "#4f6fa8", "#a3485a", "#6b7f2a", "#7a5c99", "#2a8a9a", "#b0704a", "#5e6f86", "#9a7a2a"]
COLOR_KEYS = ["sage", "clay", "sand", "lilac", "blue", "mint"]
# 回应路径模板：edits.json 的 ask 写 template 与 prompt，按钮从这里来；也可以直接写 expects 与 actions。
TEMPLATES = {
    "review": {"expects": "approve", "actions": [
        {"id": "approve", "label": "批准", "meaning": "decide", "recommended": True},
        {"id": "request-changes", "label": "要求修改", "meaning": "decide"},
        {"id": "comment", "label": "评论", "meaning": "input", "input": {"type": "text"}}]},
    "issue": {"expects": "choose", "actions": [
        {"id": "comment", "label": "回一句", "meaning": "input", "input": {"type": "text"}},
        {"id": "close", "label": "关掉", "meaning": "act"},
        {"id": "handoff", "label": "交给别人", "meaning": "decide"}]},
    "answer": {"expects": "reply", "actions": [
        {"id": "comment", "label": "回一句", "meaning": "input", "input": {"type": "text"}}]},
    "confirm": {"expects": "confirm", "actions": [
        {"id": "done", "label": "已处理", "meaning": "act"}]},
    "schedule": {"expects": "schedule", "actions": [
        {"id": "time", "label": "选时间", "meaning": "input", "input": {"type": "datetime"}}]},
    "defer": {"expects": "defer", "actions": [{"id": "defer", "label": "推到…", "meaning": "snooze"}]},
}
# 本人在来源处的动作（语料的 kind 与 review_state）→ 反馈动作。via 记为 source：不是在 Fold 里按的按钮或回的消息。
SOURCE_ACTIONS = [
    {"id": "approve", "label": "批准", "meaning": "decide"},
    {"id": "request-changes", "label": "要求修改", "meaning": "decide"},
    {"id": "merge", "label": "合并", "meaning": "act"},
    {"id": "close", "label": "关闭", "meaning": "act"},
    {"id": "comment", "label": "回复", "meaning": "input"},
    # 家庭流（作者编写）里本人的动作：通话记录、表情回应、Swish 转账。
    {"id": "call", "label": "打电话", "meaning": "act"},
    {"id": "react", "label": "回了表情", "meaning": "ack"},
    {"id": "pay", "label": "转账", "meaning": "act"},
]
VERB_OF_KIND = {"comment": "comment", "discussion_comment": "comment", "qa_comment": "comment", "forum_post": "comment",
                "list_post": "comment", "blog_comment": "comment", "mastodon_post": "comment",
                "state_merged": "merge", "state_closed": "close",
                "message": "comment", "call_log": "call", "reaction": "react", "swish_sent": "pay", "screen_time_approved": "approve"}
# 一条 ask 没有这个动作时，按它最接近的按钮记：合并算批准，关闭算处理完。
VERB_FALLBACK = {"merge": ["approve", "done"], "close": ["done", "close"], "approve": ["done"], "request-changes": ["comment"],
                 "pay": ["done"]}
FEEDBACK = {
    "defaults": [{"id": "ack", "meaning": "ack", "label": "已阅"}, {"id": "snooze", "meaning": "snooze", "label": "稍后提醒"}],
    "sourceActions": SOURCE_ACTIONS,
    "surfaces": [
        {"id": "focus", "label": "近期重点", "policy": "关注事项的持续影响：已阅只说明你知道了，事项仍按 Agent 的份额保留。"},
        {"id": "inbox", "label": "通知中心", "policy": "关注尚未告知的内容：已阅后这一条不再占位，事项本身仍在状态里。"},
    ],
}


def dump(value) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2)


def clip(text: str | None, limit: int) -> str:
    text = (text or "").replace("\r\n", "\n").strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


# ---------- 导入自由运行 ----------

def import_run(run_dir: Path, out: Path) -> None:
    frames = []
    for path in sorted(run_dir.glob("f*.json")):
        record = json.loads(path.read_text(encoding="utf-8"))
        frames.append({
            "frame": record["frame"], "status": record.get("status"),
            "batch": {"declarations": (record.get("batch") or {}).get("declarations", []),
                      "acknowledges": (record.get("batch") or {}).get("acknowledges", [])},
            "dispositions": [{k: d.get(k) for k in ("event", "disposition", "why", "related")}
                             for d in record.get("dispositions") or []],
            "attempts": len(record.get("attempts", [])),
            "rejections": [a["receipt"]["error"]["code"] for a in record.get("attempts", [])
                           if a.get("receipt") and not a["receipt"].get("accepted")],
            "cost_usd": record.get("cost_usd"),
        })
    meta = json.loads((run_dir / "meta.json").read_text(encoding="utf-8"))
    payload = {"run_id": meta["run_id"], "model": meta["model"], "skill_sha256": meta["skill_sha256"],
               "persona_context": meta.get("persona_context"), "frames": frames}
    out.write_text(dump(payload) + "\n", encoding="utf-8")
    print(f"导出 {len(frames)} 帧到 {out.relative_to(ROOT)}")


# ---------- 修正 ----------

def walk(declarations, parent=None):
    for index, declaration in enumerate(declarations):
        yield declarations, index, declaration, parent
        yield from walk(declaration.get("children") or [], declaration)


def find(declarations, item_id):
    for container, index, declaration, parent in walk(declarations):
        if declaration.get("id") == item_id:
            return container, index, declaration
    return None


def rename_refs(batch: dict, renames: dict) -> dict:
    """语料改版后改了 ID 的输入（edits.renamed_events）：把 Agent 引用的旧 ID 换成新 ID。"""
    batch = copy.deepcopy(batch)
    for _, _, declaration, _ in walk(batch["declarations"]):
        for source in declaration.get("sources") or []:
            ref = source.get("ref", "")
            if ref.startswith("event:") and ref[6:] in renames:
                source["ref"] = "event:" + renames[ref[6:]]
    return batch


def apply_edits(batch: dict, ops: list[dict], frame_id: str) -> dict:
    batch = copy.deepcopy(batch)
    declarations = batch["declarations"]
    for op in ops:
        kind = op["op"]
        if kind == "add":
            declarations.append(copy.deepcopy(op["declaration"]))
            continue
        if kind == "ack":
            batch["acknowledges"] = op["ids"]
            continue
        if kind == "clear":
            declarations.clear()
            continue
        found = find(declarations, op["id"])
        if not found:
            raise SystemExit(f"{frame_id}：修正 {kind} 找不到声明 {op['id']}")
        container, index, declaration = found
        if kind == "drop":
            container.pop(index)
        elif kind == "replace":
            container[index] = copy.deepcopy(op["declaration"])
        elif kind == "patch":
            for key, value in op["set"].items():
                if value is None and key in op.get("remove", []):
                    declaration.pop(key, None)
                else:
                    declaration[key] = copy.deepcopy(value)
            for key in op.get("unset", []):
                declaration.pop(key, None)
        else:
            raise SystemExit(f"{frame_id}：未知修正 {kind}")
    return batch


# ---------- 构建 ----------

def load(name: str):
    corpus = json.loads((ROOT / "corpus" / name / "frames.json").read_text(encoding="utf-8"))
    data_dir = ROOT / "prototype" / "data" / name
    agent = json.loads((data_dir / "agent-batches.json").read_text(encoding="utf-8"))
    edits_path = data_dir / "edits.json"
    edits = json.loads(edits_path.read_text(encoding="utf-8")) if edits_path.exists() else {}
    return corpus, agent, edits, data_dir


def shorten_sources(declarations):
    for _, _, declaration, _ in walk(declarations):
        for source in declaration.get("sources") or []:
            if source.get("quote"):
                source["quote"] = clip(source["quote"], QUOTE_LIMIT)


def build(name: str, report: bool = False) -> dict:
    corpus, agent, edits, data_dir = load(name)
    agent_frames = {f["frame"]: f for f in agent["frames"]}
    frame_edits = edits.get("frames", {})
    renames = edits.get("renamed_events", {})
    store = MemoryStore()
    frames_out = []
    threads = {e["id"]: e.get("thread") for f in corpus["frames"] for e in f["events"]}
    items_before: list[dict] = [{}]  # per output frame: active items before its batch, {id: (updated_at, threads)}
    versions: list[dict] = [{}]      # per output frame: {id: (status, updated_at)} after its batch
    roots_seen: dict[str, str] = {}
    root_frames: list[set] = []
    log = []
    # An untouched first view: the replay starts from a genuinely empty state.
    first = corpus["frames"][0]
    frames_out.append({
        "id": "f00", "at": first["signal"]["window"]["from"], "phase": "initial", "chapter": None,
        "title": edits.get("initial_title", "还没有整理过任何输入"),
        "narrative": edits.get("initial_narrative", ""), "events": [], "batch": None,
    })
    for frame in corpus["frames"]:
        fid = frame["id"]
        source = agent_frames.get(fid, {"batch": {"declarations": [], "acknowledges": []}, "dispositions": [], "status": "missing"})
        fe = frame_edits.get(fid, {})
        batch = apply_edits(rename_refs(source["batch"], renames), fe.get("batch", []), fid)
        shorten_sources(batch["declarations"])
        for _, _, declaration, _ in walk(batch["declarations"]):
            kept = [s for s in declaration.get("sources") or [] if not s.get("ref", "").startswith(tuple("event:" + p for p in DROPPED_PREFIXES))]
            if "sources" in declaration and len(kept) < len(declaration["sources"]):
                log.append({"frame": fid, "op": "drop-source", "id": declaration["id"], "why": "引用了不进演示的 Enron 营销邮件"})
                declaration["sources"] = kept
        for op in fe.get("batch", []):
            log.append({"frame": fid, "op": op["op"], "id": op.get("id") or op.get("declaration", {}).get("id"), "why": op.get("why", "")})
        request = {"batch_id": f"{name}-{fid}", "declarations": batch["declarations"], "acknowledges": batch.get("acknowledges", [])}
        items_before.append({k: (v["updated_at"], collections.Counter(t for s in v.get("sources") or [] if (t := threads.get(s.get("ref", "")[6:]))))
                             for k, v in store.snapshot["items"].items() if v["status"] == "active"})
        receipt = store.commit(copy.deepcopy(request), "assistant", frame["at"])
        if not receipt.get("accepted"):
            raise SystemExit(f"{fid} 重放被拒绝：{dump(receipt['error'])}")
        state = store.state(frame["at"])
        versions.append({k: (v["status"], v["updated_at"]) for k, v in store.snapshot["items"].items()})
        for item in state["root"]["items"]:
            roots_seen.setdefault(item["id"], item["title"])
        root_frames.append({item["id"] for item in state["root"]["items"]})
        dispositions = {renames.get(d["event"], d["event"]): d for d in source.get("dispositions", [])}
        for event_id, change in fe.get("dispositions", {}).items():
            dispositions[event_id] = {**dispositions.get(event_id, {"event": event_id}), **change}
            log.append({"frame": fid, "op": "disposition", "id": event_id, "why": change.get("why", "")})
        events = []
        for e in frame["events"]:
            if e["id"].startswith(DROPPED_PREFIXES):
                continue
            d = dispositions.get(e["id"], {})
            text = (e.get("text") or "").replace("\r\n", "\n")
            event = {"id": e["id"], "channel": e["channel"], "from": e["from"], "at": e["at"], "stream": e.get("stream")}
            if e.get("stream") == "family" and e.get("kind") != "message":
                event["kind"] = e["kind"]
            if e.get("author_kind") == "self":
                event["self"] = True
            elif e.get("author_kind") not in (None, "human"):
                event["author_kind"] = e["author_kind"]
            event["text"] = clip(text, TEXT_LIMIT)
            if e.get("subject"):
                event["subject"] = clip(e["subject"], 160)
            if e.get("url"):
                event["url"] = e["url"]
            original = e.get("text_length", len(text))
            if len(event["text"]) < original:
                event["text_length"] = original
            event.update({"disposition": d.get("disposition", "unjudged"), "why": d.get("why") or "",
                          "relatedIds": d.get("related") or []})
            events.append(event)
        signal = copy.deepcopy(frame.get("signal") or {})
        names = STREAM_NAMES
        counts = collections.Counter(e["stream"] for e in events)
        dropped = sum(1 for e in frame["events"] if e["id"].startswith(DROPPED_PREFIXES))
        signal["coverage"] = " · ".join(f"{names.get(k, k)} {counts[k]}" for k in names if counts[k]) + (
            f"（另有 {dropped} 封营销邮件未收入演示）" if dropped else "")
        signal.update(fe.get("signal", {}))
        out = {"id": fid, "at": frame["at"], "chapter": None, "title": fe.get("title") or auto_title(state, receipt),
               "narrative": fe.get("narrative") or auto_narrative(events), "events": events,
               "batch": {"batch_id": request["batch_id"], "actor": "assistant", "declarations": request["declarations"],
                         "acknowledges": request["acknowledges"]},
               "signal": signal}
        frames_out.append(out)
        if report:
            print(f"{fid} {receipt['type']:<11} r={state['revision']:<4} used={state['root']['used']:>2} "
                  f"items={len(state['root']['items']):>2} " + " | ".join(f"{i['share']}:{i['title']}" for i in state['root']['items']))
    registry = attach_asks(frames_out, edits, versions)
    derive_feedback(frames_out, corpus, edits, items_before, registry, log)
    for chapter in edits.get("chapters", []):
        for f in frames_out:
            if chapter["from"] <= f["id"] <= chapter["to"]:
                f["chapter"] = chapter["id"]
    colors = assign_colors(list(roots_seen), root_frames)
    categories = {}
    for index, (root_id, title) in enumerate(roots_seen.items()):
        given = edits.get("categories", {}).get(root_id, {})
        categories[root_id] = {"label": given.get("label", title), "colorKey": given.get("colorKey", COLOR_KEYS[index % len(COLOR_KEYS)]),
                               "color": given.get("color", colors[root_id]), "short": given.get("short", short_name(title))}
    scenario = {
        "id": f"{name}-demo", "title": edits.get("title", corpus.get("title")), "subtitle": edits.get("subtitle", corpus.get("subtitle")),
        "persona": edits.get("persona", corpus.get("persona")),
        "startAt": frames_out[0]["at"], "endAt": frames_out[-1]["at"], "timeZone": corpus.get("timeZone", "Europe/Stockholm"),
        "categories": categories, "chapters": [{"id": c["id"], "title": c["title"]} for c in edits.get("chapters", [])],
        "publicSources": [], "feedback": edits.get("feedback_policy", FEEDBACK),
        "source": {**edits.get("source", {}), "agent_run": agent["run_id"], "model": agent["model"]},
        "sketchFrames": edits.get("sketchFrames", {}), "sketchNotes": edits.get("sketchNotes", {}),
        "frames": frames_out,
    }
    return {"scenario": scenario, "log": log, "data_dir": data_dir}


def short_name(title: str) -> str:
    """草图里贴在色块旁的短名：编号优先（#13350），否则取第一个词，中文最多 4 字、英文最多 8 字符。"""
    found = re.search(r"#(\d{3,5})|(?<!\d)(\d{5})(?!\d)", title)
    if found:
        return "#" + (found.group(1) or found.group(2))
    head = re.split(r"[：:，,、\s]", title.strip())[0] or title
    return head[:8] if re.match(r"[\x00-\x7f]", head) else head[:4]


def assign_colors(roots: list[str], root_frames: list[set]) -> dict:
    """身份色比事项少：按首次出现的先后贪心上色，避开与它同帧出现过的事项已用的颜色（同帧次数多的优先避开）。"""
    together = collections.defaultdict(collections.Counter)
    for present in root_frames:
        for a in present:
            for b in present:
                if a != b:
                    together[a][b] += 1
    colors: dict = {}
    used = collections.Counter()
    for root in roots:
        clash = collections.Counter()
        for other, n in together[root].items():
            if other in colors:
                clash[colors[other]] += n
        colors[root] = min(PALETTE, key=lambda c: (clash[c], used[c], PALETTE.index(c)))
        used[colors[root]] += 1
    return colors


def auto_title(state: dict, receipt: dict) -> str:
    items = state["root"]["items"]
    if receipt["type"] == "checked":
        return "检查后不改"
    changed = [i for i in items if i["id"] in set(receipt.get("changed_ids", []))]
    return (changed or items or [{"title": "没有占位的事项"}])[0]["title"]


def auto_narrative(events: list[dict]) -> str:
    streams = collections.Counter(e["stream"] for e in events)
    disp = collections.Counter(e["disposition"] for e in events)
    names = STREAM_NAMES
    parts = "、".join(f"{names.get(k, k)} {v}" for k, v in streams.most_common())
    kept = disp.get("used", 0)
    return f"这 12 小时收到 {len(events)} 条（{parts}）；Agent 采用 {kept} 条，其余判为重复、噪音或暂缓。"


UNLINKED: set = set()
# 不推导反馈的线程：家庭流里的杂事（浇番茄、收快递、照片），几件事都会顺带引用，回一句“好”不是对哪件事的回应。
UNDERIVED_THREADS = {"fam:hemmasysslor"}
# ask id → 能回答它的线程。批准某个 PR 的 ask 默认只认那个 PR 上的动作（条目引用了别的线程时，那边的回复只记在事项上）；
# 也可以在 edits 里用 answer_threads 显式写。
ANSWER_THREADS: dict = {}


def resolve_ask(spec: dict) -> dict:
    template = TEMPLATES.get(spec.get("template"), {})
    actions = spec.get("actions") or template.get("actions")
    if not actions:
        raise SystemExit(f"ask {spec['item']}@{spec['frame']} 没有 actions 也没有已知 template")
    return {"expects": spec.get("expects") or template["expects"], "actions": copy.deepcopy(actions)}


def attach_asks(frames: list[dict], edits: dict, versions: list[dict]) -> list[dict]:
    """edits.asks: [{item, frame, until?, template | (expects, actions), prompt, short?, due_at?, subject?, answer_threads?, link_source?}]。

    ask 属于登记时的条目版本：在登记帧写入；此后条目每被改写一次（updated_at 变化）就在那一帧以同一 id
    重登记，直到 until 帧（不含）或条目不再 active。id 按登记先后编为 ask-NN。
    返回每帧之后的登记表 {item: (ask, version)}，供推导反馈。
    """
    index = {f["id"]: i for i, f in enumerate(frames)}
    specs = sorted(edits.get("asks", []), key=lambda s: (index[s["frame"]], s["item"]))
    UNLINKED.clear()
    ANSWER_THREADS.clear()
    for n, spec in enumerate(specs, 1):
        start = index[spec["frame"]]
        end = index[spec["until"]] if spec.get("until") else len(frames)
        shape = resolve_ask(spec)
        ask = {"id": f"ask-{n:02d}", "item": spec["item"], "registered_at": frames[start]["at"], "due_at": spec.get("due_at"),
               "expects": shape["expects"], "meanings": sorted({a["meaning"] for a in shape["actions"]}),
               "prompt": spec["prompt"], "actions": shape["actions"], "handler": "assistant:next-batch"}
        if spec.get("short"):  # 16 字以内的短问法，供腕上一瞥这类只能放一行的形式
            ask["short"] = spec["short"]
        if spec.get("subject"):
            ask["subject"] = spec["subject"]
        if spec.get("link_source") is False:  # 他在来源处的动作答的不是这个问题（例如回的是另一个人）
            UNLINKED.add(ask["id"])
        pull = re.search(r"github\.com/([^/]+/[^/]+)/pull/(\d+)", (spec.get("subject") or {}).get("url", ""))
        if spec.get("answer_threads") is not None:
            ANSWER_THREADS[ask["id"]] = set(spec["answer_threads"])
        elif pull:
            ANSWER_THREADS[ask["id"]] = {f"gh:{pull.group(1)}#{pull.group(2)}"}
        last = None
        for i in range(start, end):
            status, version = versions[i].get(spec["item"], (None, None))
            if status != "active":
                if i == start:
                    raise SystemExit(f"{spec['frame']}：ask 指向的 {spec['item']} 此刻不是 active")
                break
            if version != last:
                frames[i].setdefault("asks", {})[spec["item"]] = ask
                last = version
    registry: list[dict] = []
    current: dict = {}
    for i, frame in enumerate(frames):
        for item, ask in (frame.get("asks") or {}).items():
            current[item] = (ask, versions[i].get(item, (None, None))[1])
        registry.append(dict(current))
    return registry


def source_verb(event: dict) -> str | None:
    if event.get("kind") == "review":
        return {"APPROVED": "approve", "CHANGES_REQUESTED": "request-changes"}.get(event.get("review_state"), "comment")
    if event.get("kind") == "state_closed" and re.search(r"closed this in [0-9a-f]{7,}", event.get("text") or ""):
        return "merge"
    return VERB_OF_KIND.get(event.get("kind"))


def derive_feedback(frames: list[dict], corpus: dict, edits: dict, items_before: list[dict], registry: list[dict], log: list) -> None:
    """本人在来源处的回复、评审、合并与关闭，按线程挂到当时 active 的条目上；那件事登记着 ask 就挂到 ask。

    edits.feedback 可以按事件覆盖：{event_id: [links]} 换成手写的链接，{event_id: []} 去掉推导结果。
    """
    raw = {e["id"]: e for f in corpus["frames"] for e in f["events"]}
    labels = {a["id"]: a for a in SOURCE_ACTIONS}
    overrides = edits.get("feedback", {})
    for i, frame in enumerate(frames):
        if i == 0:
            continue
        before, asks = items_before[i], registry[i - 1]
        for event in frame["events"]:
            if event["id"] in overrides:
                links = copy.deepcopy(overrides[event["id"]])
                for link in links:
                    if link.get("ask") == "@item":  # 手写链接指向这件事当时登记着的 ask
                        ask, version = asks.get(link["target"], (None, None))
                        if not ask or version != before.get(link["target"], (None,))[0]:
                            raise SystemExit(f"{frame['id']} {event['id']}：{link['target']} 此刻没有登记着的 ask")
                        link["ask"] = ask["id"]
                if links:
                    event["feedback"] = links
                log.append({"frame": frame["id"], "op": "feedback", "id": event["id"], "why": "手写反馈链接" if links else "去掉推导出的反馈"})
                continue
            if not event.get("self"):
                continue
            source = raw[event["id"]]
            verb = source_verb(source)
            thread = source.get("thread")
            if not verb or not thread:
                continue
            if thread in UNDERIVED_THREADS:
                continue
            # 同一线程被几件事引用时：Agent 在处置里把这条输入关联到其中哪几件，就挂到哪几件；
            # 没有关联的，先挂到以它为主线程（引用最多）的那件，再看引用次数，并列都挂。
            # 一件事顺带引用了别处的一两条输入，不等于他在那边的回复是对这件事的回应。
            weight = {item: (item in event.get("relatedIds", []), cited[thread] == max(cited.values()), cited[thread])
                      for item, (_, cited) in before.items() if cited[thread]}
            targets = [item for item, w in weight.items() if w == max(weight.values())]
            links = []
            for target in targets:
                ask, version = asks.get(target, (None, None))
                link = None
                if (ask and version == before[target][0] and ask["id"] not in UNLINKED
                        and thread in ANSWER_THREADS.get(ask["id"], {thread})):
                    ids = {a["id"]: a for a in ask["actions"]}
                    action = next((a for a in [verb, *VERB_FALLBACK.get(verb, [])] if a in ids), None)
                    if action:
                        link = {"ask": ask["id"], "target": target, "action": action, "meaning": ids[action]["meaning"], "via": "source"}
                if link is None:
                    link = {"target": target, "action": verb, "meaning": labels[verb]["meaning"], "via": "source"}
                if verb == "comment":
                    link["value"] = clip(re.sub(r"\s+", " ", re.sub(r"(?m)^>.*$", "", source.get("text") or "")), 60)
                links.append(link)
            if links:
                event["feedback"] = links


def write(name: str, scenario: dict, data_dir: Path) -> Path:
    path = data_dir / "scenario.mjs"
    body = json.dumps(scenario, ensure_ascii=False, separators=(",", ":"))
    path.write_text(
        "// Generated by scripts/build_demo_data.py from the free run and edits.json; do not edit by hand.\n"
        "// Texts are pseudonymised public data, clipped to 500 characters; see MIX.md and POLISH.md.\n"
        f"export const scenario = {body};\nexport default scenario;\n", encoding="utf-8")
    return path


def verify_in_engine(path: Path) -> None:
    script = (f"import {{ replayScenario }} from '{(ROOT / 'prototype' / 'engine.mjs').as_posix()}';"
              f"import {{ scenario }} from '{path.as_posix()}';"
              "const records = replayScenario(scenario);"
              "const last = records.at(-1).state.root;"
              "console.log(`原型引擎回放 ${records.length} 帧，末帧根层 ${last.used}/64，${last.items.length} 件`);")
    subprocess.run(["node", "--input-type=module", "-e", script], check=True)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("name")
    parser.add_argument("--import-run", metavar="RUN_DIR")
    parser.add_argument("--report", action="store_true")
    args = parser.parse_args(argv)
    data_dir = ROOT / "prototype" / "data" / args.name
    data_dir.mkdir(parents=True, exist_ok=True)
    if args.import_run:
        import_run(Path(args.import_run), data_dir / "agent-batches.json")
        return 0
    result = build(args.name, report=args.report)
    path = write(args.name, result["scenario"], result["data_dir"])
    print(f"写出 {path.relative_to(ROOT)}（{path.stat().st_size // 1024} KB），修正 {len(result['log'])} 处")
    if args.report:
        for entry in result["log"]:
            print(f"  {entry['frame']} {entry['op']:<11} {entry['id']}：{entry['why']}")
    verify_in_engine(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
