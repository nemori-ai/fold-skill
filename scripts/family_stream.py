"""composite 的家庭流：由节拍表渲染成品、生成作者标注，并检查成品与 Enron 参考邮件不可回溯。

家庭流是作者编写的原创文本（见 corpus/composite/family/README.md）。唯一的来源是
corpus/composite/family/beats.json：人物、渠道、事项、每一拍的消息与“Fold 应当怎么判”。
本脚本只做确定性的转换，不调用模型：

  render  beats.json → messages.json（入库的成品，一行一条）与 BEATS.md（中文可读版）
  check   不可回溯检查：成品不含参考过的 Enron 邮件里的专名，与整个 Enron 语料没有 8 词以上的重合。
          需要本机的 Enron 压缩包与参考文件夹清单（.local/family/consulted-folders.txt），结果写入 check.json

合并进 frames.json、ids.json、noise.json 与 labels.json 由 `compose_corpus.py family` 完成，它调用这里的
render() 与 labels()。
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import re
import sys
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from build_corpus import core_text, dump_lines, info_class, parse_time  # noqa: E402

BASE = ROOT / "corpus" / "composite" / "family"
BEATS = BASE / "beats.json"
MESSAGES = BASE / "messages.json"
BEATS_MD = BASE / "BEATS.md"
CHECK = BASE / "check.json"
TARBALL = ROOT / ".local" / "cache" / "enron" / "enron_mail_20150507.tar.gz"
CONSULTED = ROOT / ".local" / "family" / "consulted-folders.txt"
LEVELS = ("critical", "high", "normal", "low", "trace", "none")
HIGH_LEVELS = ("critical", "high")


def _items(values: list[str]) -> str:
    return values[0] if len(values) == 1 else ", ".join(values[:-1]) + " och " + values[-1]


# 通知类消息的模板：参数来自节拍表，渲染结果标 text_origin: template。
TEMPLATES = {
    "missed_call": lambda p: f"Missat samtal från {p['who']}" + (f" ({p['count']})" if p.get("count", 1) > 1 else ""),
    "voicemail": lambda p: f"Röstmeddelande från {p['who']} ({p['secs']} s)\nTranskribering: {p['text']}",
    "call_out": lambda p: f"Utgående samtal till {p['who']} · {p['min']} min",
    "wa_created": lambda p: f"{p['who']} skapade gruppen ”{p['group']}”",
    "wa_added": lambda p: f"{p['who']} lade till dig",
    "vet_booking": lambda p: (f"Djurkliniken Kvarnbacken: Din bokning för {p['pet']} är bekräftad {p['when']}. Avboka senast 24 timmar "
                              "innan, annars debiteras besöket. Detta SMS går inte att svara på."),
    "vet_summary": lambda p: (f"Djurkliniken Kvarnbacken: Sammanfattning av {p['pet']}s besök idag.\nBedömning: {p['findings']}.\n"
                              f"Behandling: {p['drug']}, {p['dose']}.\nÅterbesök vid behov. Frågor? Ring oss vardagar 08–16."),
    "clinic_closed": lambda p: ("Tack för att du ringde Djurkliniken Kvarnbacken. Telefonen är stängd för idag. Vi ringer upp dig nästa "
                                "vardag i turordning. Vid akuta ärenden, kontakta djursjukhusets jour."),
    "vet_confirmed": lambda p: "Tack, din tid är bekräftad. Välkommen!",
    "card_purchase": lambda p: f"Kortköp {p['amount']} kr · {p['merchant']}",
    "swish_sent": lambda p: f"Du har swishat {p['amount']} kr till {p['who']}",
    "swish_request": lambda p: f"Swish-förfrågan från {p['who']}: {p['amount']} kr · ”{p['msg']}” · Godkänn i appen",
    "chargeback_done": lambda p: (f"Ditt ärende om återkrav är avslutat. {p['amount']} kr har krediterats ditt kort. Mer information "
                                  "finns under Meddelanden."),
    "list_add": lambda p: f"{p['who']} lade till {_items(p['items'])} i Hemma",
    "list_check": lambda p: f"{p['who']} bockade av {p['count']} varor i Hemma",
    "calendar_invite": lambda p: f"{p['who']} har bjudit in dig: {p['title']} · {p['when']}",
    "calendar_reminder": lambda p: f"{p['title']} · {p['when']}",
    "delivery_eta": lambda p: f"Budbilen: Din leverans från {p['from']} kommer {p['when']}. Följ den i appen.",
    "delivered": lambda p: f"Budbilen: Levererat! {p['what'][0].upper() + p['what'][1:]} har lämnats {p['where']}.",
    "smishing": lambda p: ("Paketservice: Ditt paket kunde inte levereras på grund av obetald tullavgift (29 kr). Betala inom 24 "
                           "timmar för att undvika retur: https://paketservice-tull.example/b7Kx2"),
    "smishing_bankid": lambda p: ("BankID: Ditt BankID upphör att gälla idag. Förnya direkt för att undvika spärr: "
                                  "http://bankid-fornya.example/s"),
    "screen_time_request": lambda p: f"{p['who']} ber om mer tid: {p['app']} · {p['minutes']} min",
    "screen_time_approved": lambda p: f"Du gav {p['who']} {p['minutes']} min till för {p['app']}",
    "screen_time_report": lambda p: (f"Veckorapport: {p['who']}s skärmtid var i snitt {p['avg']} per dag ({p['delta']} jämfört med "
                                     "förra veckan)."),
    "order_confirm": lambda p: f"Tack för din beställning hos {p['shop']}! {p['what']}, {p['price']} kr. Beräknad leverans {p['when']}.",
    "plumber_eta": lambda p: (f"Rörfixarna Söder: Vi kommer idag mellan kl {p['window']}. Jourtillägg {p['fee']} kr tillkommer på "
                              "helger. Svara STOPP för att avboka."),
    "claim_received": lambda p: (f"Trygghem: Vi har tagit emot din skadeanmälan (ärende {p['case']}). En handläggare kontaktar dig "
                                 "inom 3 arbetsdagar. Självrisk enligt dina villkor."),
    "claim_assigned": lambda p: (f"Trygghem: Ditt ärende {p['case']} har tilldelats en handläggare. Du kan ladda upp bilder och "
                                 "kvitton i appen."),
    "school_reminder": lambda p: f"Påminnelse: ”{p['doc']}” för {p['who']} är inte signerat. Signera med BankID senast {p['due']}.",
    "school_schedule": lambda p: f"Nytt schema för klass {p['klass']} är publicerat. Gäller från vecka 34.",
    "einvoice": lambda p: f"Ny e-faktura från {p['sender']}: {p['amount']} kr, förfaller {p['due']}. Betalas automatiskt via autogiro.",
}


def load_beats() -> dict:
    return json.loads(BEATS.read_text(encoding="utf-8"))


def messages_of(doc: dict) -> list[tuple[dict, dict, str]]:
    """(消息, 所属的拍或噪音组, 'beat'|'noise')，按时间排序。"""
    out = [(x, b, "beat") for b in doc["beats"] for x in b["messages"]]
    out += [(x, g, "noise") for g in doc["noise"] for x in g["messages"]]
    return sorted(out, key=lambda t: (parse_time(t[0]["at"]), t[0]["id"]))


def render(doc: dict) -> list[dict]:
    """节拍表 → 与 frames.json 同形的事件（不含帧号）。"""
    events = []
    for x, parent, origin in messages_of(doc):
        person = doc["people"][x["who"]]
        if "template" in x:
            text = TEMPLATES[x["template"]](x.get("params") or {})
        else:
            text = x["text"]
        event = {"id": x["id"], "channel": doc["channels"][x["ch"]]["channel"], "from": person["name"], "at": x["at"],
                 "text": text, "kind": x["kind"]}
        if x.get("subject"):
            event["subject"] = x["subject"]
        event["thread"] = x.get("item") or parent.get("item") or parent["thread"]
        event["author_kind"] = person["author_kind"]
        if x.get("reply_to"):
            event["reply_to"] = x["reply_to"]
        event["text_origin"] = "template" if "template" in x else "authored"
        event["text_length"] = len(text)
        event["stream"] = "family"
        event["origin"] = "authored:" + x["id"].split(":", 1)[1]
        events.append(event)
    return events


# ---------- 作者标注 ----------

def labels(doc: dict, frames: list[dict]) -> dict:
    """由节拍表生成 labels.json 的 family 一节：每帧的事项、作者给的关注档、行为档、应忽略的输入与问题的登记和去向。

    行为档（tier）与其他流同一口径，只是“本人后来的行动”来自合成的 Jonas 消息与通话记录：24 小时内有行动为 engaged，
    7 天内为 later，输入全是应忽略的为 noise，否则 untouched。作者档（level）是节拍表里写定的 Fold 应给的关注。
    """
    horizon, soon = dt.timedelta(days=7), dt.timedelta(hours=24)
    events = {e["id"]: e for e in render(doc)}
    meta = {x["id"]: (x, parent, origin) for x, parent, origin in messages_of(doc)}
    frame_of, bounds = {}, []
    for f in frames:
        lo, hi = parse_time(f["signal"]["window"]["from"]), parse_time(f["signal"]["window"]["to"])
        bounds.append((f["id"], f["at"], lo, hi))
    for eid, e in events.items():
        at = parse_time(e["at"])
        frame_of[eid] = next(fid for fid, _, lo, hi in bounds if lo <= at < hi)
    actions = collections.defaultdict(list)
    for e in events.values():
        if e["author_kind"] == "self":
            actions[e["thread"]].append((parse_time(e["at"]), e))
    # 事项的作者档：每拍写下的是这一拍之后的关注档；帧末取该事项最后一拍的档位。
    beat_level = []
    for b in doc["beats"]:
        first = min(parse_time(x["at"]) for x in b["messages"])
        beat_level.append((first, b["item"], b["level"], b["id"]))
    beat_level.sort()
    asks = []
    for b in doc["beats"]:
        msgs = sorted(b["messages"], key=lambda x: x["at"])
        if b.get("ask"):
            ask = dict(b["ask"])
            posed = next((x for x in msgs if x["who"] != "jonas"), msgs[0])
            ask.update({"item": b["item"], "beat": b["id"], "registered": {"event": posed["id"], "frame": frame_of[posed["id"]],
                                                                          "at": posed["at"]}, "resolved": None})
            asks.append(ask)
    by_ask = {a["id"]: a for a in asks}
    for b in doc["beats"]:
        msgs = sorted(b["messages"], key=lambda x: x["at"])
        if b.get("answers"):
            done = next((x for x in msgs if x["who"] == "jonas"), msgs[-1])
            by_ask[b["answers"]]["resolved"] = {"how": "answered", "event": done["id"], "frame": frame_of[done["id"]],
                                                "at": done["at"], "beat": b["id"]}
        if b.get("voids"):
            first = msgs[0]
            by_ask[b["voids"]]["resolved"] = {"how": "void", "event": first["id"], "frame": frame_of[first["id"]],
                                              "at": first["at"], "beat": b["id"]}
    out_frames, totals = [], collections.Counter()
    for fid, fat, lo, hi in bounds:
        in_frame = [e for e in events.values() if frame_of[e["id"]] == fid]
        by_thread = collections.defaultdict(list)
        for e in in_frame:
            by_thread[e["thread"]].append(e)
        items, ignore, groups = [], [], []
        for thread, group in sorted(by_thread.items()):
            inputs = [e for e in group if e["author_kind"] != "self"]
            if not inputs:
                totals["self_only_threads"] += 1
                continue
            first = min(parse_time(e["at"]) for e in inputs)
            later = [(at, e) for at, e in actions.get(thread, []) if first < at <= hi + horizon]
            self_soon = [(at, e) for at, e in later if at <= hi + soon]
            self_late = [(at, e) for at, e in later if at > hi + soon]
            ignored = {e["id"] for e in inputs if meta[e["id"]][0].get("ignore")}
            if self_soon:
                tier, basis = "engaged", ["self_acted_within_24h"]
            elif self_late:
                tier, basis = "later", ["self_acted_within_7d"]
            elif len(ignored) == len(inputs):
                tier, basis = "noise", ["authored_ignore", "no_action_7d"]
            else:
                tier, basis = "untouched", ["no_action_7d"]
            levels = [lv for at, item, lv, _ in beat_level if item == thread and at < hi]
            level = levels[-1] if levels else "none"
            item = {"thread": thread, "level": level, "high": level in HIGH_LEVELS, "tier": tier,
                    "events": [e["id"] for e in sorted(inputs, key=lambda e: e["at"])], "basis": ["authored"] + basis,
                    "evidence": [{"at": e["at"], "who": "self", "action": e["kind"], "ref": e["id"]}
                                 for _, e in (self_soon or self_late)[:4]]}
            open_asks = [a["id"] for a in asks if a["item"] == thread and a["registered"]["at"] < fat
                         and not (a["resolved"] and a["resolved"]["at"] < fat)]
            if open_asks:
                item["open_asks"] = open_asks
            items.append(item)
            totals[f"tier_{tier}"] += 1
            totals[f"level_{level}"] += 1
            totals["high"] += item["high"]
            for e in inputs:
                reason = meta[e["id"]][0].get("ignore")
                if reason:
                    info = info_class({**e, "_core": core_text(e["text"])})
                    ignore.append({"event": e["id"], "basis": ["authored", reason] + ([f"low_info:{info}"] if info else [])})
        # 同一件事被拆成几个线程（母亲的 BankID 并入换水管，托邻居喂猫并入看兽医）：同帧出现时并成一组。
        present = {i["thread"] for i in items}
        for thread in sorted(present):
            parent = (doc["items"].get(thread) or {}).get("merge")
            if parent and parent in present:
                members = [thread, parent]
                groups.append({"threads": members, "events": [ev for i in items if i["thread"] in members for ev in i["events"]],
                               "why": ["authored_merge"]})
        totals["ignore_events"] += len(ignore)
        totals["input_events"] += sum(1 for e in in_frame if e["author_kind"] != "self")
        totals["events"] += len(in_frame)
        order = {lv: n for n, lv in enumerate(LEVELS)}
        out_frames.append({"frame": fid, "at": fat, "ignore": ignore, "groups": groups,
                           "items": sorted(items, key=lambda i: (order[i["level"]], i["thread"]))})
    cross = []
    for key, item in doc["items"].items():
        if item.get("cross"):
            frames_seen = sorted({frame_of[e["id"]] for e in events.values() if e["thread"] == key})
            cross.append({"item": key, "title": item["title"], "life_threads": item["cross"], "frames": frames_seen})
    totals["asks"] = len(asks)
    totals["asks_answered"] = sum(1 for a in asks if a["resolved"] and a["resolved"]["how"] == "answered")
    totals["asks_void"] = sum(1 for a in asks if a["resolved"] and a["resolved"]["how"] == "void")
    totals["asks_open"] = sum(1 for a in asks if not a["resolved"])
    return {
        "method": {"basis": "authored", "source": "corpus/composite/family/beats.json",
                   "level": "节拍表里作者写定的 Fold 关注档（critical / high / normal / low / trace / none），帧末取该事项最后一拍的档位",
                   "tier": "与其他流同一口径的行为档；“本人后来的行动”是合成的 Jonas 消息与通话记录，所以它检验一致，不检验真实",
                   "ignore": "节拍表里标了 ignore 的输入（表情、附和、群聊闲聊、照片、通知、诈骗短信、重复催促等），依据前缀 authored",
                   "asks": "节拍表登记的问题：登记的输入与帧、被回答（answered）或失效（void）的输入与帧；到窗口结束仍开着的 resolved 为 null",
                   "doc": "corpus/composite/LABELS.md"},
        "summary": dict(sorted(totals.items())),
        "items": doc["items"],
        "asks": asks,
        "cross_stream": cross,
        "frames": out_frames,
    }


# ---------- 中文可读版 ----------

WEEKDAYS = "一二三四五六日"


def beats_md(doc: dict, events: list[dict]) -> str:
    ev = {e["id"]: e for e in events}
    lines = ["# 家庭流节拍表（中文可读版）", "",
             "状态：由 `scripts/family_stream.py render` 从 [beats.json](beats.json) 生成，不要手改。瑞典语原文见 "
             "[messages.json](messages.json)，方法与规模见 [README.md](README.md)。", "",
             "“档”是这一拍之后 Fold 应给的关注（critical / high / normal / low / trace / none）；“问”是登记给 Jonas 的问题，"
             "“答”与“失效”是它的去向；“错位”标出有意放进去的回错对象、答案先于问题或重复发送。", "",
             "## 事项", "", "| 事项 | 线 | 内容 | 类型 | 咬合的生活流问题 |", "| --- | --- | --- | --- | --- |"]
    for key, item in doc["items"].items():
        lines.append(f"| `{key}` | {item['line']} | {item['title']} | {item['kind']} | {'、'.join(item.get('cross') or []) or '—'} |")
    asks = {b["ask"]["id"]: b["ask"]["q"] for b in doc["beats"] if b.get("ask")}
    by_day = collections.defaultdict(list)
    for b in doc["beats"]:
        first = min(b["messages"], key=lambda x: x["at"])
        by_day[first["at"][:10]].append((first["at"], b))
    lines += ["", "## 逐日", ""]
    for day in sorted(by_day):
        d = dt.date.fromisoformat(day)
        n = (d - dt.date(2026, 8, 3)).days
        lines += [f"### {d.month}/{d.day} 周{WEEKDAYS[d.weekday()]}（f{2 * n + 1:02d}–f{2 * n + 2:02d}）", "",
                  "| 时间 | 拍 | 事项 | 发生了什么 | 档 | 问题与去向 | 条数（应忽略） |", "| --- | --- | --- | --- | --- | --- | --- |"]
        for at, b in sorted(by_day[day], key=lambda t: t[0]):
            notes = []
            if b.get("ask"):
                notes.append(f"问：{b['ask']['q']}")
            if b.get("answers"):
                notes.append(f"答：{asks[b['answers']]}")
            if b.get("voids"):
                notes.append(f"失效：{asks[b['voids']]}")
            if b.get("misplaced"):
                notes.append(f"错位：{b['misplaced']}")
            if b.get("note"):
                notes.append(b["note"])
            n_ign = sum(1 for x in b["messages"] if x.get("ignore"))
            short = b["item"].removeprefix("fam:")
            lines.append(f"| {at[11:16]} | {b['id']} | {short} | {b['gist']} | {b['level']} | {'；'.join(notes) or '—'} | "
                         f"{len(b['messages'])}（{n_ign}） |")
        lines.append("")
    lines += ["## 噪音层", "", "不服务剧情的群聊、照片与通知；除 Jonas 自己的发言外全部应被忽略。", "",
              "| 组 | 内容 | 条数 | 时间 |", "| --- | --- | --- | --- |"]
    for g in doc["noise"]:
        ats = sorted(x["at"] for x in g["messages"])
        span = ats[0][5:16].replace("T", " ") + ("" if ats[0][:10] == ats[-1][:10] else " … " + ats[-1][5:10])
        lines.append(f"| {g['id']} | {g['topic']} | {len(g['messages'])} | {span} |")
    return "\n".join(lines) + "\n"


def write_render() -> list[dict]:
    doc = load_beats()
    events = render(doc)
    MESSAGES.write_text(dump_lines({"source": "composite/family", "doc": "corpus/composite/family/README.md",
                                    "note": "作者编写的原创文本，由 beats.json 渲染；不要手改。",
                                    "events": events}) + "\n", encoding="utf-8")
    BEATS_MD.write_text(beats_md(doc, events), encoding="utf-8")
    return events


# ---------- 不可回溯检查 ----------

WORD = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿ']+")
# 只在句首大写、成品里没有小写形式的瑞典语普通词（grannen 邻居，hoppas 希望）：不是专名，显式排除并在结果里列出。
SWEDISH_COMMON = {"Grannen", "Hoppas"}
CAP = re.compile(r"\b[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ]{2,}\b")


def dictionary() -> tuple[set[str], set[str]]:
    words, names = set(), set()
    for path, target in ((Path("/usr/share/dict/words"), words), (Path("/usr/share/dict/propernames"), names)):
        if path.exists():
            for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
                if line.strip():
                    target.add(line.strip() if target is names else line.strip().lower())
    return words, names


def check(ngram: int) -> dict:
    """成品与 Enron 的对照，只输出成品一侧的词与计数，不输出 Enron 原文。

    专名：成品里的大写词，排除普通英文词（系统词典）与成品里也以小写出现的词（句首大写的瑞典语普通词），
    再与参考文件夹里每封邮件的全文（含信头）里的大写词求交集；出现在收发人信头里的单列为人名。
    重合：成品每条正文的 8 词序列，与整个 Enron 语料每封邮件的全文逐一比对。
    """
    if not TARBALL.exists() or not CONSULTED.exists():
        raise SystemExit(f"需要 {TARBALL} 与 {CONSULTED}（见 corpus/composite/family/README.md）")
    events = render(load_beats())
    words, propernames = dictionary()
    fam_text = "\n".join([e["text"] for e in events] + [e["from"] for e in events] + [e.get("subject") or "" for e in events]
                          + [e["channel"] for e in events])
    lower = {w for w in WORD.findall(fam_text) if w.islower()}
    caps = set(CAP.findall(fam_text))
    candidates = {w for w in caps if w.lower() not in lower and not (w.lower() in words and w not in propernames)
                  and w not in SWEDISH_COMMON}
    fam_grams = set()
    for e in events:
        toks = [w.lower() for w in WORD.findall(e["text"])]
        fam_grams.update(tuple(toks[i:i + ngram]) for i in range(len(toks) - ngram + 1))
    starts = {g[0] for g in fam_grams}
    prefixes = tuple("maildir/" + p.strip().rstrip("/") + "/" for p in CONSULTED.read_text().splitlines() if p.strip())
    header_caps, all_caps = set(), set()
    gram_hits, scanned, consulted = collections.Counter(), 0, 0
    with tarfile.open(TARBALL, "r:gz") as archive:
        for member in archive:
            if not member.isfile():
                continue
            handle = archive.extractfile(member)
            if handle is None:
                continue
            raw = handle.read().decode("latin-1")
            scanned += 1
            toks = [w.lower() for w in WORD.findall(raw)]
            for i in range(len(toks) - ngram + 1):
                if toks[i] in starts and tuple(toks[i:i + ngram]) in fam_grams:
                    gram_hits[" ".join(toks[i:i + ngram])] += 1
            if member.name.startswith(prefixes):
                consulted += 1
                head = raw.split("\n\n", 1)[0]
                header_caps.update(w for w in CAP.findall(head) if w in candidates)
                all_caps.update(w for w in CAP.findall(raw) if w in candidates)
    name_hits = sorted(header_caps)
    proper_hits = sorted(all_caps - header_caps)
    return {"checked_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "family_events": len(events), "family_capitalized": len(caps), "family_proper_candidates": len(candidates),
            "family_ngrams": len(fam_grams), "ngram": ngram,
            "enron_messages_scanned": scanned, "enron_consulted_messages": consulted, "consulted_folders": len(prefixes),
            "swedish_common_excluded": sorted(SWEDISH_COMMON & caps),
            "name_hits": name_hits, "proper_noun_hits": proper_hits, "ngram_hits": sorted(gram_hits),
            "note": "专名候选：成品里的大写词，去掉普通英文词与成品里也以小写出现的词。name_hits：候选同时出现在参考邮件的信头里；"
                    "proper_noun_hits：候选出现在参考邮件全文的其他位置；ngram_hits：成品与整个 Enron 语料任一封邮件全文重合的 8 词序列。"
                    "只列成品一侧的词。"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("command", choices=("render", "check"))
    parser.add_argument("--ngram", type=int, default=8)
    args = parser.parse_args()
    if args.command == "render":
        events = write_render()
        print(f"渲染 {len(events)} 条 → {MESSAGES.relative_to(ROOT)}、{BEATS_MD.relative_to(ROOT)}", file=sys.stderr)
    else:
        result = check(args.ngram)
        CHECK.write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(json.dumps({k: v for k, v in result.items() if k != "note"}, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
