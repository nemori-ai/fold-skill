"""把 fetch_corpus.py 抓到的原始记录转成帧序列，并量化噪音。

子命令：
  frames  raw/ → corpus/<source>/frames.json（不入库）与 ids.json（入库）。按来源时区的钟面时间切帧，
          默认每 12 小时一帧。不清洗、不去重、不删机器人；原文只做格式转换，超长截断并记录原长。
          已有 ids.json 时只对照并报告差异，--write-ids 才覆盖。
  noise   统计 frames.json 的噪音指标，并对 prototype/data/story/scenario.mjs（手写情境）计算同样指标 → noise.json（入库），
          同时打印并排的 Markdown 表。
  all     依次运行以上两步。

用法：
  python3 scripts/build_corpus.py all curl-bagder
  python3 scripts/build_corpus.py frames curl-bagder --frame-hours 6 --write-ids

帧与 scripts/export-scenario.mjs 的导出同形：顶层 persona / startAt / endAt / timeZone / frames，
每帧 id / at / events / batch / signal。真实语料没有作者批次，batch 为 null；事件在 scenario 的
id / channel / from / at / text 之外，多出 kind、subject、thread、url、author_kind、text_length 等字段。
只用标准库；noise 子命令另需 node 导出原型情境。
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import hashlib
import json
import re
import statistics
import subprocess
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
UTC = dt.timezone.utc
TEXT_LIMIT = 2000
NOISE_KINDS = ("bot", "template", "empty", "ack")  # 低信息量的四种来源，见 noise()


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def save(path: Path, value, lines: bool = False) -> None:
    """lines=True 时，短记录一行一条，便于入库后逐条比较差异。"""
    text = dump_lines(value) if lines else json.dumps(value, ensure_ascii=False, indent=1)
    path.write_text(text + "\n", encoding="utf-8")


def dump_lines(value, pad: str = "") -> str:
    if isinstance(value, dict) and value:
        body = ",\n".join(f"{pad} {json.dumps(k, ensure_ascii=False)}: {dump_lines(v, pad + ' ')}" for k, v in value.items())
        return "{\n" + body + "\n" + pad + "}"
    if isinstance(value, list) and value and all(isinstance(v, dict) for v in value):
        compact = [json.dumps(v, ensure_ascii=False) for v in value]
        rows = compact if max(map(len, compact)) <= 2000 else [dump_lines(v, pad + "  ") for v in value]
        return "[\n" + ",\n".join(pad + "  " + row for row in rows) + "\n" + pad + " ]"
    return json.dumps(value, ensure_ascii=False)


def parse_time(value: str) -> dt.datetime:
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


# ---------- 文本的“核心”：去掉引用、签名、链接与提及之后剩下的话 ----------

QUOTE_HEADER = re.compile(r"^On .{5,120} wrote:\s*$")
REPLY_CUT = re.compile(r"^-{2,}\s*Original Message\s*-{2,}|^_{5,}\s*$|^From:\s.+\s+Sent:\s", re.I)
FILE_LINE = re.compile(r"^[\w./+-]+:(\d+|None)$")
ATTACHMENT_NOTE = re.compile(r"^\[\d+ 个附件\]$")
ACK = re.compile(
    r"^(\+1|\+100|thanks?( you)?( (a lot|so much|again|everyone|all))?|thx|ty|tyvm|lgtm|ok(ay)?|great|nice|cool|"
    r"agreed|done|merged|fixed|same( here)?|me too|ping|bump|any (update|news|progress)s?( on this)?|"
    r"thank you( very much)?|awesome|perfect|excellent|yes|no|indeed|wow|congrats|congratulations|"
    r"good (catch|point|idea)|makes sense|sounds good|sgtm|wfm|ack|noted|closing|addressed|applied|updated|rebased|"
    r"谢谢|收到|好的|好|嗯|在看了|同上|"
    r"tack( så mycket| snälla)?|tusen tack|ok(ej)?|japp|ja|nej|toppen|kanon|perfekt|absolut|precis|skönt|puh|ha(ha)+)"
    r"( [!.?]*)?[!.?~:)( ]*$")


def core_text(text: str | None) -> str:
    lines = []
    for line in (text or "").splitlines():
        stripped = line.strip()
        if stripped in ("--", "-- ") or REPLY_CUT.match(stripped):
            break  # 签名，或 Outlook 式回复下方引用的原信
        if stripped.startswith(">") or QUOTE_HEADER.match(stripped) or FILE_LINE.match(stripped) \
                or ATTACHMENT_NOTE.match(stripped):
            continue  # 引用、行内评审的“文件:行号”前缀、附件计数都不是正文
        lines.append(line)
    core = "\n".join(lines)
    core = re.sub(r"https?://\S+", " ", core)
    core = re.sub(r"(?<![\w])@[\w.-]+(@[\w.-]+)?", " ", core)
    return re.sub(r"\s+", " ", core).strip().lower()


def info_class(event: dict) -> str | None:
    """低信息量分类：bot / template / empty / ack；有实质内容返回 None。"""
    if event["author_kind"] in ("bot", "automation"):
        return "bot"
    if event.get("text_origin") == "template" and event.get("kind") in ("state_closed", "state_merged", "state_reopened"):
        return "template"  # 只说明状态变了；请求评审、批准等模板通知仍有信息量
    core = event.get("_core", core_text(event.get("text")))
    if not re.sub(r"[\W_]+", "", core):
        return "empty"
    if len(core) <= 40 and ACK.match(core):
        return "ack"
    return None


# ---------- curl-bagder：原始流 → 事件 ----------

def gh_subject(repo: str, thread: dict | None, number: int, prefix: str = "") -> str:
    kind = "PR" if thread and thread.get("is_pr") else "Issue"
    title = thread["title"] if thread else "?"
    return f"{prefix}[{repo}] {title} ({kind} #{number})"


def curl_events(raw: dict, meta: dict) -> tuple[list[dict], dict]:
    me = meta["self"]["github"]
    names = set(meta["self"].get("names", []))
    users = {u["author"]: u for u in raw.get("github-users", [])}
    threads = {(t["repo"], t["number"]): t for t in raw.get("github-threads", [])}
    discussions = {(d["repo"], d["number"]): d for d in raw.get("github-discussions", []) if d.get("kind") == "discussion"}

    def gh_kind(login: str | None, is_bot: bool) -> str:
        if login == me:
            return "self"
        profile = users.get(login or "", {})
        if is_bot or profile.get("type") == "Bot":
            return "bot"
        if profile.get("profile_says_bot"):
            return "automation"
        return "human"

    events: list[dict] = []

    def add(**fields) -> None:
        events.append(fields)

    for t in raw.get("github-threads", []):
        kind = "pr_opened" if t["is_pr"] else "issue_opened"
        add(id=t["id"], channel=f"GitHub · {t['repo']}", kind=kind, author=t["author"],
            author_kind=gh_kind(t["author"], t["author_is_bot"]), at=t["at"], text=t["text"],
            subject=gh_subject(t["repo"], t, t["number"]), thread=f"gh:{t['repo']}#{t['number']}", url=t["url"])
    for c in raw.get("github-comments", []):
        thread = threads.get((c["repo"], c["number"]))
        add(id=c["id"], channel=f"GitHub · {c['repo']}", kind="comment", author=c["author"],
            author_kind=gh_kind(c["author"], c["author_is_bot"]), at=c["at"], text=c["text"],
            subject=gh_subject(c["repo"], thread, c["number"], "Re: "), thread=f"gh:{c['repo']}#{c['number']}",
            url=c["url"], minimized=c.get("minimized"), edited=_edited(c))
    # review 与它的行内评论合成一条通知，和 GitHub 邮件通知的粒度一致。
    inline = collections.defaultdict(list)
    for c in raw.get("github-review-comments", []):
        inline[c.get("review_id")].append(c)
    review_ids = set()
    for r in raw.get("github-reviews", []):
        review_ids.add(int(r["id"].split(":")[1]))
        parts = [r["text"]] if r.get("text") else []
        for c in sorted(inline.get(int(r["id"].split(":")[1]), []), key=lambda c: c["at"]):
            parts.append(f"{c.get('path')}:{c.get('line')}\n{c['text']}")
        thread = threads.get((r["repo"], r["number"]))
        text = "\n\n".join(parts)
        add(id=r["id"], channel=f"GitHub · {r['repo']}", kind="review", author=r["author"],
            author_kind=gh_kind(r["author"], r["author_is_bot"]), at=r["at"],
            text=text or f"{r['author']} {REVIEW_VERB.get(r.get('state'), 'reviewed')} this pull request.",
            text_origin=None if text else "template", review_state=r.get("state"),
            subject=gh_subject(r["repo"], thread, r["number"], "Re: "), thread=f"gh:{r['repo']}#{r['number']}",
            url=r["url"], inline_comments=len(inline.get(int(r["id"].split(":")[1]), [])))
    for review_id, comments in inline.items():  # 找不到所属 review 的行内评论单独成条
        if review_id in review_ids:
            continue
        for c in comments:
            thread = threads.get((c["repo"], c["number"]))
            add(id=c["id"], channel=f"GitHub · {c['repo']}", kind="review_comment", author=c["author"],
                author_kind=gh_kind(c["author"], c["author_is_bot"]), at=c["at"],
                text=f"{c.get('path')}:{c.get('line')}\n{c['text']}", subject=gh_subject(c["repo"], thread, c["number"], "Re: "),
                thread=f"gh:{c['repo']}#{c['number']}", url=c["url"])
    # 关闭、重开、合并会通知关注者；请求本人 review 或指派给本人也会通知。
    for e in raw.get("github-timeline", []):
        event = e["event"]
        if event not in ("closed", "reopened", "merged", "review_requested", "assigned"):
            continue
        if event == "review_requested" and e.get("requested_reviewer") != me:
            continue
        if event == "assigned" and e.get("assignee") != me:
            continue
        thread = threads.get((e["repo"], e["number"]))
        if event == "closed":
            how = f"in {e['commit_id'][:10]}" if e.get("commit_id") else f"as {e.get('state_reason') or 'closed'}"
            text = f"{e['author']} closed this {how}."
        elif event == "review_requested":
            text = f"{e['author']} requested your review on this pull request."
        elif event == "assigned":
            text = f"{e['author']} assigned this to you."
        else:
            text = f"{e['author']} {event} this."
        add(id=e["id"], channel=f"GitHub · {e['repo']}", kind=f"state_{event}", author=e["author"],
            author_kind=gh_kind(e["author"], e["author_is_bot"]), at=e["at"], text=text, text_origin="template",
            subject=gh_subject(e["repo"], thread, e["number"], "Re: "), thread=f"gh:{e['repo']}#{e['number']}",
            url=e["url"])
    for d in raw.get("github-discussions", []):
        key = (d["repo"], d["number"])
        parent = discussions.get(key)
        subject = f"[{d['repo']}] {parent['title'] if parent else '?'} (Discussion #{d['number']})"
        add(id=d["id"], channel=f"GitHub · {d['repo']}", kind="discussion_opened" if d.get("kind") == "discussion"
            else "discussion_comment", author=d["author"], author_kind=gh_kind(d["author"], d["author_is_bot"]),
            at=d["at"], text=d["text"], subject=subject if d.get("kind") == "discussion" else "Re: " + subject,
            thread=f"ghd:{d['repo']}#{d['number']}", url=d["url"], minimized=d.get("minimized"))
    branch_pr = {(t["repo"], t["head_ref"]): t["number"] for t in sorted(raw.get("github-threads", []), key=lambda t: t["at"])
                 if t.get("head_ref") and t.get("head_repo") == t["repo"]}
    for r in raw.get("github-runs", []):
        if r.get("conclusion") not in ("failure", "timed_out", "startup_failure"):
            continue
        prs = r.get("pull_requests") or []
        ref = re.fullmatch(r"refs/pull/(\d+)/(?:head|merge)", r.get("branch") or "")
        pr = prs[0] if prs else int(ref.group(1)) if ref else branch_pr.get((r["repo"], r.get("branch")))
        thread = f"gh:{r['repo']}#{pr}" if pr else f"ci:{r['repo']}@{r.get('branch')}"
        add(id=r["id"], channel=f"CI · {r['repo']}", kind="ci_failure", author="github-actions", author_kind="bot",
            at=r.get("updated_at") or r["at"], text=f"{r.get('workflow')}: {r.get('conclusion')} — {r.get('title')}",
            text_origin="template",
            subject=f"[{r['repo']}] Run failed: {r.get('workflow')} - {r.get('branch')} ({(r.get('head_sha') or '')[:7]})",
            thread=thread, url=r["url"], workflow=r.get("workflow"), branch=r.get("branch"))
    for r in raw.get("github-releases", []):
        add(id=r["id"], channel=f"GitHub · {r['repo']}", kind="release", author=r["author"],
            author_kind=gh_kind(r["author"], r["author_is_bot"]), at=r["at"], text=r["text"],
            subject=f"[{r['repo']}] Release {r.get('title')}", thread=f"rel:{r['repo']}", url=r["url"])
    # 邮件列表：按 In-Reply-To 找到线程根。
    posts = raw.get("lists", [])
    by_mid = {p.get("message_id"): p for p in posts}
    for p in posts:
        root, seen = p, set()
        while root.get("in_reply_to") in by_mid and root["message_id"] not in seen:
            seen.add(root["message_id"])
            root = by_mid[root["in_reply_to"]]
        parent = by_mid.get(p.get("in_reply_to"))
        add(id=p["id"], channel=f"邮件列表 · {p['list']}", kind="list_post", author=p["author"],
            author_kind="self" if p["author"] in names else "human", at=p["at"], text=p["text"],
            subject=p.get("subject"), thread=f"ml:{p['list']}:{root['id']}", url=p["url"],
            reply_to=parent["id"] if parent else None)
    # Mastodon：只收回复本人或提到本人的帖子（通知的口径），加上本人自己的帖子。
    statuses = raw.get("mastodon", [])
    by_sid = {s["status_id"]: s for s in statuses}
    self_id = meta["self"].get("mastodon_id")
    for s in statuses:
        addressed = s.get("in_reply_to_account_id") == self_id or me in (s.get("mentions") or [])
        if not (s["is_self"] or addressed):
            continue
        root, seen = s, set()
        while root.get("in_reply_to_id") in by_sid and root["status_id"] not in seen:
            seen.add(root["status_id"])
            root = by_sid[root["in_reply_to_id"]]
        parent = by_sid.get(s.get("in_reply_to_id"))
        kind = "mastodon_post" if s["is_self"] else ("mastodon_reply" if s.get("in_reply_to_account_id") == self_id
                                                       else "mastodon_mention")
        excerpt = re.sub(r"\s+", " ", parent["text"])[:80] if parent else None
        add(id=s["id"], channel="Mastodon", kind=kind, author=s["author"],
            author_kind="self" if s["is_self"] else ("bot" if s["author_is_bot"] else "human"), at=s["at"],
            text=s["text"] + (f"\n[{s['media']} 个附件]" if s.get("media") else ""),
            subject=f"Re: {excerpt}" if excerpt else None, subject_origin="parent_excerpt" if excerpt else None,
            thread=f"md:{root['status_id']}", url=s["url"], reply_to=parent["id"] if parent else None,
            edited=bool(s.get("edited_at")))
    for c in raw.get("blog", []):
        add(id=c["id"], channel="博客评论 · daniel.haxx.se", kind="blog_comment", author=c["author"],
            author_kind="self" if c.get("is_self") else "human", at=c["at"], text=c["text"],
            subject=c.get("title"), thread=f"blog:{c['post']}", url=c["url"],
            reply_to=f"blog:{c['parent']}" if c.get("parent") else None)
    persona = {
        "name": "Daniel Stenberg",
        "role": "curl 创始人与首席维护者（瑞典），公开身份",
        "context": ("每天处理 curl 的 issue、PR 与评审，维护邮件列表，在 Mastodon 与博客上和社区交流。"
                    "输入按公开渠道重建：GitHub 关注者通知、他触发的 CI 失败、邮件列表、回复或提到他的 Mastodon 帖子、"
                    "博客评论；私信、HackerOne 安全报告与 IRC 不在其中。"),
        "accounts": {"github": me, "mastodon": "@bagder@mastodon.social"},
    }
    return events, persona


REVIEW_VERB = {"APPROVED": "approved", "CHANGES_REQUESTED": "requested changes on", "COMMENTED": "reviewed",
               "DISMISSED": "had a dismissed review on"}


def _edited(item: dict) -> bool:
    if not item.get("updated_at"):
        return False
    return (parse_time(item["updated_at"]) - parse_time(item["at"])).total_seconds() > 300


# ---------- Enron：邮箱 → 事件 ----------

SENT_FOLDERS = ("sent", "sent_items", "_sent_mail")
# Lotus Notes 时代导出的视图文件夹，同一封信会在其中重复出现；它们不是新的收件。
VIEW_FOLDERS = ("all_documents", "discussion_threads")
AUTOMATED_SENDER = re.compile(r"(announce|no\.address|noreply|no-reply|mailer|newsletter|arsystem|outlook\.team|"
                              r"enron\.announcements|webmaster|administrator|postmaster|news@|alert|digest|"
                              r"listserv|bounce|calendar|itsupport|helpdesk|@news\.|concur|_update@|online@)", re.I)


AUTOMATED_SUBJECT = re.compile(r"out of (the )?office|automatic reply|auto-?reply|undeliverable|delivery status", re.I)


def enron_id(mail: dict) -> str:
    """文件路径含文件夹名（如 deleted_items），那是后来的处理结果；对外的 id 用 Message-ID 的摘要。"""
    return "en:" + hashlib.sha1((mail.get("message_id") or mail["id"]).encode()).hexdigest()[:16]


def enron_thread(mail: dict) -> str:
    """按去掉 RE:/FW: 的主题归并；入库的标注里只出现主题的摘要，空主题各自成一项。"""
    root = re.sub(r"^((re|fw|fwd)\s*:\s*)+", "", (mail.get("subject") or "").strip(), flags=re.I).strip().lower()
    return "mail:" + hashlib.sha1(root.encode()).hexdigest()[:12] if root else "mail:" + enron_id(mail)[3:]


def enron_events(raw: dict, meta: dict) -> tuple[list[dict], dict]:
    mails = raw.get("enron", [])
    user = meta["self"]["enron_user"]
    own = collections.Counter(m["author"] for m in mails if m.get("folder") in SENT_FOLDERS and m.get("author"))
    me = {address for address, _ in own.most_common(2)}
    events, seen = [], {}
    # 同一 Message-ID 在多个文件夹出现，是导出格式造成的副本，合为一条收件并记下副本数。
    for m in mails:
        key = m.get("message_id") or m["id"]
        if key in seen:
            seen[key]["copies"] += 1
            continue
        is_self = m.get("author") in me
        sender = m.get("author") or ""
        subject = (m.get("subject") or "").strip()
        automated = AUTOMATED_SENDER.search(sender) or AUTOMATED_SUBJECT.search(subject)
        kind = "self" if is_self else ("automation" if automated else "human")
        event = {"id": enron_id(m), "channel": "邮件", "kind": "email_sent" if is_self else "email", "author": sender,
                 "author_kind": kind, "at": m["at"], "text": m["text"], "subject": subject or None,
                 "thread": enron_thread(m), "url": None, "copies": 1, "message_id": m.get("message_id")}
        seen[key] = event
        events.append(event)
    persona = {"name": user, "role": "Enron 员工（CMU Enron 邮件语料中的公开邮箱）",
               "context": "2001 年前后的企业邮箱：工作邮件、内部公告、系统通知与私人往来混在一起。语料由 FERC 调查公开。",
               "accounts": {"email": sorted(me)}}
    return events, persona


# ---------- 切帧 ----------

def frame_bounds(meta: dict, hours: int) -> list[tuple[dt.datetime, dt.datetime]]:
    """按来源时区的钟面时间切帧（跨夏令时也对齐当地零点与正午）。"""
    zone = ZoneInfo(meta["timezone"])
    start = parse_time(meta["window"]["from"]).astimezone(zone).replace(tzinfo=None)
    end = parse_time(meta["window"]["to"]).astimezone(zone).replace(tzinfo=None)
    bounds, cursor = [], start
    while cursor < end:
        nxt = min(cursor + dt.timedelta(hours=hours), end)
        bounds.append((cursor.replace(tzinfo=zone).astimezone(UTC), nxt.replace(tzinfo=zone).astimezone(UTC)))
        cursor = nxt
    return bounds


def local_iso(value: dt.datetime, zone: ZoneInfo) -> str:
    return value.astimezone(zone).replace(microsecond=0).isoformat()


def finish_event(event: dict, zone: ZoneInfo) -> dict:
    text = event.get("text") or ""
    out = {"id": event["id"], "channel": event["channel"], "from": event["author"],
           "at": local_iso(parse_time(event["at"]), zone), "text": text[:TEXT_LIMIT]}
    for key in ("kind", "subject", "thread", "url", "author_kind", "reply_to", "text_origin", "subject_origin",
                "review_state", "inline_comments", "minimized", "edited", "copies", "workflow", "branch",
                "message_id"):
        if event.get(key) not in (None, False):
            out[key] = event[key]
    out["text_length"] = len(text)
    if len(text) > TEXT_LIMIT:
        out["truncated"] = True
    return out


def build_frames(source: str, hours: int, write_ids: bool) -> dict:
    base = ROOT / "corpus" / source
    meta = load(base / "raw" / "meta.json")
    raw = {path.stem: load(path) for path in (base / "raw").glob("*.json") if path.stem != "meta"}
    zone = ZoneInfo(meta["timezone"])
    events, persona = (enron_events if source.startswith("enron-") else curl_events)(raw, meta)
    bounds = frame_bounds(meta, hours)
    window = (bounds[0][0], bounds[-1][1])
    events = [e for e in events if window[0] <= parse_time(e["at"]) < window[1]]
    events.sort(key=lambda e: (parse_time(e["at"]), e["id"]))
    frames, cursor = [], 0
    for index, (lo, hi) in enumerate(bounds, 1):
        chunk = []
        while cursor < len(events) and parse_time(events[cursor]["at"]) < hi:
            chunk.append(finish_event(events[cursor], zone))
            cursor += 1
        frames.append({
            "id": f"f{index:02d}", "at": local_iso(hi, zone),
            "title": f"{hi.astimezone(zone):%m-%d %H:%M} 前 {hours} 小时 · {len(chunk)} 条输入",
            "events": chunk, "batch": None,
            "signal": {"type": "events", "reason": f"每 {hours} 小时定时整理", "received": len(chunk),
                       "window": {"from": local_iso(lo, zone), "to": local_iso(hi, zone)}}})
    scenario = {
        "id": f"{source}-{meta['window']['start']}", "title": meta["description"],
        "subtitle": f"{meta['window']['start']} 至 {meta['window']['end']}（不含）· {len(events)} 条真实输入 · {len(frames)} 帧",
        "persona": persona, "startAt": frames[0]["at"], "endAt": frames[-1]["at"], "timeZone": meta["timezone"],
        "feedback": None,
        "source": {"name": source, "window": meta["window"], "fetch_range": meta["fetch_range"],
                   "frame_hours": hours, "text_limit": TEXT_LIMIT,
                   "streams": {name: info["count"] for name, info in meta["streams"].items()}},
        "frames": frames,
    }
    save(base / "frames.json", scenario)
    ids = {"source": source, "window": meta["window"], "frame_hours": hours, "events": [
        {"id": e["id"], "frame": f["id"], "kind": e.get("kind"), "at": e["at"], "author_kind": e.get("author_kind"),
         "thread": e.get("thread"), "url": e.get("url"), "text_length": e["text_length"],
         "text_sha1": hashlib.sha1(e["text"].encode()).hexdigest()[:12]}
        for f in frames for e in f["events"]]}
    log(f"{source}：{len(events)} 条输入，{len(frames)} 帧 → frames.json")
    ids_path = base / "ids.json"
    if ids_path.exists() and not write_ids:
        compare_ids(load(ids_path), ids)
    else:
        save(ids_path, ids, lines=True)
        log("已写入 ids.json")
    return scenario


def compare_ids(old: dict, new: dict) -> None:
    before = {e["id"]: e for e in old["events"]}
    after = {e["id"]: e for e in new["events"]}
    missing = sorted(set(before) - set(after))
    added = sorted(set(after) - set(before))
    changed = sorted(i for i in set(before) & set(after) if before[i]["text_sha1"] != after[i]["text_sha1"])
    moved = sorted(i for i in set(before) & set(after) if before[i]["frame"] != after[i]["frame"])
    if missing or added or changed or moved:
        log(f"与入库的 ids.json 不一致：缺 {len(missing)}、多 {len(added)}、原文变化 {len(changed)}、换帧 {len(moved)}。"
            "原文可能被删除或编辑；用 --write-ids 接受新的清单。")
        for label, values in (("缺", missing), ("多", added), ("变", changed)):
            if values:
                log(f"  {label}：{', '.join(values[:8])}{' …' if len(values) > 8 else ''}")
    else:
        log("与入库的 ids.json 一致。")


# ---------- 噪音指标 ----------

def percentile(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    k = (len(ordered) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo)


def shingles(text: str, n: int = 4) -> set[str]:
    return {text[i:i + n] for i in range(max(len(text) - n + 1, 1))}


def scenario_events() -> tuple[list[dict], dict]:
    out = subprocess.run(["node", str(ROOT / "scripts" / "export-scenario.mjs")], check=True, capture_output=True,
                         text=True, cwd=ROOT).stdout
    scenario = json.loads(out)
    me = scenario["persona"]["name"]
    events = []
    for frame in scenario["frames"]:
        for e in frame["events"]:
            sender = e["from"]
            # 与真实语料同一口径：程序发出的是 bot，群发的资讯与营销是 automation。
            kind = ("self" if sender == me or e["channel"] in ("用户消息", "反馈") else
                    "bot" if re.search(r"机器人|宿主|日历", sender) else
                    "automation" if re.search(r"周报|周刊|通讯|营销|卖场", sender) else "human")
            related = e.get("relatedIds") or []
            events.append({**e, "author": sender, "author_kind": kind, "frame": frame["id"],
                           "thread": f"item:{related[0]}" if related else None, "text_length": len(e["text"])})
    return events, scenario


def metrics(events: list[dict], frames: list[dict], zone: ZoneInfo) -> dict:
    n = len(events)
    for e in events:
        e["_core"] = core_text(e.get("text"))
        e["_info"] = info_class(e)
    by_kind = collections.Counter(e["author_kind"] for e in events)
    authors = collections.Counter(e["author"] for e in events)
    channels = collections.Counter(e["channel"].split(" · ")[0] for e in events)
    info = collections.Counter(e["_info"] for e in events if e["_info"])
    others = [e for e in events if e["author_kind"] != "self"]
    # 重复：完全相同的核心文本；近重复：≥30 字的核心文本 4-gram Jaccard ≥ 0.6，与 7 天内更早的输入比较。
    seen_exact: dict[str, int] = {}
    exact = exact_long = 0
    for e in events:
        key = e["_core"]
        if key and key in seen_exact:
            exact += 1
            exact_long += len(key) >= 30
        seen_exact.setdefault(key, 1)
    near = 0
    long_events = [(parse_time(e["at"]), shingles(e["_core"]), e) for e in events if len(e["_core"]) >= 30]
    for i, (at, grams, e) in enumerate(long_events):
        for j in range(i - 1, -1, -1):
            other_at, other_grams, other = long_events[j]
            if (at - other_at).days >= 7:
                break
            if other["_core"] == e["_core"]:
                near += 1
                break
            union = len(grams | other_grams)
            if union and len(grams & other_grams) / union >= 0.6:
                near += 1
                break
    threads = collections.Counter(e.get("thread") for e in events if e.get("thread"))
    thread_channels = collections.defaultdict(set)
    for e in events:
        if e.get("thread"):
            thread_channels[e["thread"]].add(e["channel"])
    mentions = cross_channel_mentions(events)
    lengths = [e["text_length"] for e in events]
    times = sorted(parse_time(e["at"]) for e in events)
    gaps = [(b - a).total_seconds() / 60 for a, b in zip(times, times[1:])]
    hours = collections.Counter(t.astimezone(zone).hour for t in times)
    per_frame = [len(f["events"]) for f in frames]
    frame_chars = [sum(min(len(e.get("text") or ""), TEXT_LIMIT) for e in f["events"]) for f in frames]
    edited = sum(1 for e in events if e.get("edited"))
    return {
        "inputs": n, "frames": len(frames),
        "per_frame": {"mean": round(statistics.mean(per_frame), 1) if per_frame else 0,
                      "median": percentile(per_frame, 0.5), "max": max(per_frame, default=0),
                      "empty_frames": sum(1 for c in per_frame if c == 0),
                      "text_chars_p50": percentile(frame_chars, 0.5), "text_chars_max": max(frame_chars, default=0)},
        "channels": dict(channels.most_common()),
        "author_kinds": dict(by_kind.most_common()),
        "distinct_authors": len(authors),
        "top_authors_share": round(sum(c for _, c in authors.most_common(5)) / n, 3) if n else 0,
        "low_info": {"by_class": {k: info.get(k, 0) for k in NOISE_KINDS},
                     "total": sum(info.values()), "share": round(sum(info.values()) / n, 3) if n else 0,
                     "share_of_non_self": round(sum(1 for e in others if e["_info"]) / len(others), 3) if others else 0},
        "duplicates": {"exact_core_text": exact, "exact_core_text_30plus": exact_long, "near_30plus": near,
                       "share_exact": round(exact / n, 3) if n else 0, "share_near": round(near / n, 3) if n else 0},
        "threads": {"distinct": len(threads), "single_input": sum(1 for c in threads.values() if c == 1),
                    "inputs_per_thread_p50": percentile(list(threads.values()), 0.5),
                    "inputs_per_thread_p90": percentile(list(threads.values()), 0.9),
                    "inputs_per_thread_max": max(threads.values(), default=0),
                    "multi_channel_threads": sum(1 for c in thread_channels.values() if len(c) > 1),
                    "cross_channel_mentions": mentions},
        "length_chars": {"p10": percentile(lengths, 0.1), "p50": percentile(lengths, 0.5),
                         "p90": percentile(lengths, 0.9), "max": max(lengths, default=0),
                         "over_limit": sum(1 for v in lengths if v > TEXT_LIMIT),
                         "under_20": sum(1 for v in lengths if v < 20)},
        "gaps_minutes": {"p10": round(percentile(gaps, 0.1), 1), "p50": round(percentile(gaps, 0.5), 1),
                         "p90": round(percentile(gaps, 0.9), 1), "max": round(max(gaps, default=0), 1),
                         "same_minute": sum(1 for g in gaps if g < 1)},
        "local_hours": {"night_00_07": sum(hours[h] for h in range(0, 7)), "by_hour": [hours[h] for h in range(24)]},
        "edited_after_post": edited,
    }


GH_REF = re.compile(r"github\.com/([\w.-]+/[\w.-]+)/(?:issues|pull|discussions)/(\d+)")


def cross_channel_mentions(events: list[dict]) -> int:
    """非 GitHub 渠道里直接链接到 GitHub 线程的输入条数。"""
    return sum(1 for e in events if not e["channel"].startswith(("GitHub", "CI")) and GH_REF.search(e.get("text") or ""))


def noise(source: str) -> dict:
    base = ROOT / "corpus" / source
    corpus = load(base / "frames.json")
    zone = ZoneInfo(corpus["timeZone"])
    events = [{**e, "author": e["from"], "frame": f["id"]} for f in corpus["frames"] for e in f["events"]]
    result = {"source": source, "corpus": metrics(events, corpus["frames"], zone)}
    result["corpus"]["stale"] = stale_inputs(source, events)
    s_events, scenario = scenario_events()
    result["scenario"] = metrics(s_events, scenario["frames"], ZoneInfo(scenario["timeZone"]))
    result["scenario"]["author_dispositions"] = dict(collections.Counter(e["disposition"] for e in s_events))
    save(base / "noise.json", result)
    log(f"写入 {base / 'noise.json'}")
    print(markdown_table(result))
    return result


def markdown_table(result: dict) -> str:
    """并排打印真实语料与手写情境的主要指标，供 NOISE.md 使用。"""
    return metric_table([result["corpus"], result["scenario"]], ["真实语料", "手写情境"])


def metric_table(ms: list[dict], headers: list[str]) -> str:
    """把几份 metrics() 的结果并排成一张 Markdown 表，每份一列。"""

    def pct(part, whole):
        return f"{part}（{part / whole:.0%}）" if whole else "0"

    def kinds(m):
        k = m["author_kinds"]
        return " / ".join(f"{name} {k.get(name, 0)}" for name in ("human", "self", "bot", "automation"))

    rows = [
        ("输入条数", *(m["inputs"] for m in ms)),
        ("帧数；每帧均值 / 中位 / 最多；空帧", *(f"{m['frames']}；{m['per_frame']['mean']} / {m['per_frame']['median']:g} / "
                                     f"{m['per_frame']['max']}；{m['per_frame']['empty_frames']}" for m in ms)),
        ("每帧原文字符 中位 / 最多（截断后）", *(f"{m['per_frame']['text_chars_p50']:,.0f} / {m['per_frame']['text_chars_max']:,}"
                                         for m in ms)),
        ("渠道数（前缀归并）", *(len(m["channels"]) for m in ms)),
        ("作者：他人 / 本人 / 机器人 / 自动化账号", *(kinds(m) for m in ms)),
        ("不同作者；前 5 位占比", *(f"{m['distinct_authors']}；{m['top_authors_share']:.0%}" for m in ms)),
        ("低信息量合计（占全部；占他人发来）", *(f"{pct(m['low_info']['total'], m['inputs'])}；{m['low_info']['share_of_non_self']:.0%}" for m in ms)),
        ("　其中机器人 / 模板通知 / 空内容 / 致谢附和", *(" / ".join(str(m["low_info"]["by_class"][k]) for k in NOISE_KINDS)
                                          for m in ms)),
        ("核心文本完全重复（≥30 字）", *(f"{m['duplicates']['exact_core_text']}（{m['duplicates']['exact_core_text_30plus']}）"
                                    for m in ms)),
        ("近重复（≥30 字，7 天内 4-gram Jaccard ≥ 0.6）", *(pct(m["duplicates"]["near_30plus"], m["inputs"]) for m in ms)),
        ("事项/线程数；只出现一次的", *(f"{m['threads']['distinct']}；{m['threads']['single_input']}" for m in ms)),
        ("每事项输入数 中位 / P90 / 最多", *(f"{m['threads']['inputs_per_thread_p50']:g} / {m['threads']['inputs_per_thread_p90']:g} / "
                                       f"{m['threads']['inputs_per_thread_max']}" for m in ms)),
        ("跨渠道出现的事项（真实语料含 CI 失败归入 PR）", *(m["threads"]["multi_channel_threads"] for m in ms)),
        ("非 GitHub 渠道里直接链接 GitHub 线程的输入", *(m["threads"]["cross_channel_mentions"] for m in ms)),
        ("长度（字符）P10 / 中位 / P90 / 最长", *(f"{m['length_chars']['p10']:g} / {m['length_chars']['p50']:g} / "
                                          f"{m['length_chars']['p90']:g} / {m['length_chars']['max']}" for m in ms)),
        (f"超过 {TEXT_LIMIT} 字被截断；短于 20 字", *(f"{m['length_chars']['over_limit']}；{m['length_chars']['under_20']}"
                                                 for m in ms)),
        ("到达间隔（分钟）P10 / 中位 / P90 / 最长", *(f"{m['gaps_minutes']['p10']:g} / {m['gaps_minutes']['p50']:g} / "
                                             f"{m['gaps_minutes']['p90']:g} / {m['gaps_minutes']['max']:g}" for m in ms)),
        ("同一分钟内连续到达", *(m["gaps_minutes"]["same_minute"] for m in ms)),
        ("当地 0–7 点到达", *(pct(m["local_hours"]["night_00_07"], m["inputs"]) for m in ms)),
        ("发出后被编辑过（看到的是改后版本）", *(m["edited_after_post"] for m in ms)),
    ]
    lines = ["| 指标 | " + " | ".join(headers) + " |", "| --- |" + " --- |" * len(headers)]
    lines += ["| " + " | ".join(str(cell) for cell in row) + " |" for row in rows]
    return "\n".join(lines)


def stale_inputs(source: str, events: list[dict]) -> dict:
    """到达时已经过时的输入：评论落在已关闭的线程上；邮件列表回复的原信早于 7 天。"""
    if source.startswith("enron-"):
        return {}
    raw = ROOT / "corpus" / source / "raw"
    threads = {f"gh:{t['repo']}#{t['number']}": t for t in load(raw / "github-threads.json")}
    timeline = collections.defaultdict(list)
    for e in load(raw / "github-timeline.json"):
        if e["event"] in ("closed", "reopened"):
            timeline[f"gh:{e['repo']}#{e['number']}"].append((parse_time(e["at"]), e["event"]))
    on_closed = 0
    for e in events:
        if e.get("kind") not in ("comment", "review") or e["author_kind"] == "self":
            continue
        states = sorted(t for t in timeline.get(e.get("thread"), []) if t[0] < parse_time(e["at"]))
        if states and states[-1][1] == "closed":
            on_closed += 1
    by_id = {e["id"]: e for e in events}
    old_reply = 0
    for e in events:
        parent = by_id.get(e.get("reply_to") or "")
        if parent and (parse_time(e["at"]) - parse_time(parent["at"])).days >= 7:
            old_reply += 1
    return {"comments_on_closed_threads": on_closed, "replies_to_7d_old": old_reply,
            "threads_known": len(threads)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("command", choices=("frames", "noise", "all"))
    parser.add_argument("source")
    parser.add_argument("--frame-hours", type=int, default=12, help="每帧覆盖的小时数，按来源时区的零点对齐")
    parser.add_argument("--write-ids", action="store_true", help="用本次结果覆盖入库的 ids.json")
    args = parser.parse_args()
    if args.command in ("frames", "all"):
        build_frames(args.source, args.frame_hours, args.write_ids)
    if args.command in ("noise", "all"):
        noise(args.source)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
