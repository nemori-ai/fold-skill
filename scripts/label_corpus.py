"""从真实的后续行为推出每帧的弱标注：哪些输入应被忽略、哪些应合成同一事项、哪些事项当时值得关注。

输入：build_corpus.py 生成的 corpus/<source>/frames.json，以及 fetch_corpus.py 抓到的窗口后行为（raw/）。
输出：corpus/<source>/labels.json（入库，只含 ID、档位与依据）。规则、覆盖与局限见 corpus/<source>/LABELS.md。

用法：
  python3 scripts/label_corpus.py curl-bagder
  python3 scripts/label_corpus.py curl-bagder --audit 30         # 另打印 30 条随机抽样，供人工核对
  python3 scripts/label_corpus.py enron-steffes-j --high-per-frame 2

事项按线程划分：GitHub issue/PR/讨论、邮件列表线程、Mastodon 帖子下的对话、博客文章、邮件主题。
档位来自本人与团队在 7 天内的行动，不来自文本内容；不手写任何整帧批次。只用标准库。
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import random
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_corpus import (  # noqa: E402
    GH_REF, ROOT, SENT_FOLDERS, VIEW_FOLDERS, core_text, enron_id, enron_thread, info_class, load, log, parse_time,
    save,
)

TIER_ORDER = ("engaged", "later", "delegated", "untouched", "noise")
# 作出决定的行动：投入度额外加一。
DECISIONS = {"closed", "merged", "labeled", "milestoned", "review_approved", "review_changes_requested",
             "marked_as_duplicate", "answer_chosen", "forward"}
# 一条输入后来的去向，足以单独判定它该被忽略。
FATE_REASON = {"superseded_by_success": "ci_turned_green_within_24h", "deleted": "deleted_by_self",
               "subscription": "subscription_default"}
FAILED = ("failure", "timed_out", "startup_failure")


def labels(source: str, audit: int, high_per_frame: int) -> dict:
    base = ROOT / "corpus" / source
    corpus = load(base / "frames.json")
    meta = load(base / "raw" / "meta.json")
    raw = {path.stem: load(path) for path in (base / "raw").glob("*.json") if path.stem != "meta"}
    builder = enron_actions if source.startswith("enron-") else curl_actions
    actions, links, outcome, direct = builder(raw, meta)
    out_frames, totals = label_frames(corpus, actions, links, outcome, direct, high_per_frame)
    result = {
        "source": source, "window": meta["window"],
        "method": {
            "horizon_days": 7, "high_per_frame": high_per_frame,
            "tiers": {"engaged": "本人在输入到达后、帧结束 24 小时内对同一事项有行动",
                      "later": "本人在 7 天内才有行动", "delegated": "只有团队其他人在 7 天内有行动",
                      "untouched": "7 天内无人行动，但有实质内容",
                      "noise": "7 天内无人行动，且全是低信息量输入，或全被本人删除、被后续成功的 CI 覆盖"},
            "high": "engaged 中投入度（24 小时内本人行动次数，作出决定再加一）至少为 2、在本帧排前几位的事项",
            "fold_weights": {"high": "critical / high", "engaged": "normal 以上", "later": "normal / low",
                             "delegated": "low / trace", "untouched": "trace 或不纳入", "noise": "不纳入"},
            "doc": "corpus/" + source + "/LABELS.md"},
        "summary": {**dict(sorted(totals.items())), "frames": len(out_frames),
                    "frames_with_items": sum(1 for f in out_frames if f["items"]),
                    "frames_with_high": sum(1 for f in out_frames if any(i["high"] for i in f["items"]))},
        "frames": out_frames,
    }
    save(base / "labels.json", result, lines=True)
    log(f"写入 {base / 'labels.json'}：{result['summary']}")
    if audit:
        print_audit(corpus, result, audit)
    return result


def label_frames(corpus: dict, actions: dict, links: dict, outcome: dict, direct: dict,
                 high_per_frame: int) -> tuple[list[dict], collections.Counter]:
    """逐帧、逐事项推出弱档位、应忽略的输入与合并组；各来源只需给出行动、关系、结局与直接去向。"""
    horizon, soon = dt.timedelta(days=7), dt.timedelta(hours=24)
    out_frames, totals = [], collections.Counter()
    for frame in corpus["frames"]:
        at = parse_time(frame["at"])
        events = frame["events"]
        for e in events:
            e["_core"] = core_text(e.get("text"))
            e["_info"] = info_class(e)
        by_thread = collections.defaultdict(list)
        for e in events:
            by_thread[e.get("thread") or e["id"]].append(e)
        items, ignore = [], []
        for thread, group in by_thread.items():
            inputs = [e for e in group if e["author_kind"] != "self"]
            if not inputs:
                totals["self_only_threads"] += 1
                continue
            first = min(parse_time(e["at"]) for e in inputs)
            later = [a for a in actions.get(thread, []) if first < a["at"] <= at + horizon]
            self_soon = [a for a in later if a["who"] == "self" and a["at"] <= at + soon]
            self_late = [a for a in later if a["who"] == "self" and a["at"] > at + soon]
            team = [a for a in later if a["who"] == "team"]
            noisy = all(e["_info"] for e in inputs)
            fates = {e["id"]: direct.get(e["id"]) or direct.get(e.get("message_id") or "") for e in inputs}
            decided = [FATE_REASON[f] for f in fates.values() if f in FATE_REASON]
            if self_soon:
                tier, basis = "engaged", ["self_acted_within_24h"]
            elif self_late:
                tier, basis = "later", ["self_acted_within_7d"]
            elif team:
                tier, basis = "delegated", ["team_acted_within_7d"]
            elif len(decided) == len(inputs):
                tier, basis = "noise", sorted(set(decided)) + ["no_action_7d"]
            elif noisy:
                tier, basis = "noise", ["low_info_inputs", "no_action_7d"]
            else:
                tier, basis = "untouched", ["no_action_7d"]
            shown = self_soon or self_late or team
            item = {"thread": thread, "tier": tier, "high": False, "events": [e["id"] for e in inputs],
                    "basis": basis, "evidence": [
                        {"at": a["at"].isoformat().replace("+00:00", "Z"), "who": a["who"], "action": a["action"],
                         "ref": a.get("ref")} for a in shown[:4]]}
            if self_soon:
                # 投入度：24 小时内本人的行动次数，作出决定（关闭、合并、打标签、批准）再加一。
                item["engagement"] = len(self_soon) + any(a["action"] in DECISIONS for a in self_soon)
                item["response_hours"] = round((min(a["at"] for a in self_soon) - first).total_seconds() / 3600, 1)
            if outcome.get(thread):
                item["outcome"] = outcome[thread]
            items.append(item)
            totals[f"tier_{tier}"] += 1
            # 逐条：被后来的结果覆盖、被本人删除，或低信息量且所在事项无人跟进的输入，应被忽略。
            for e in inputs:
                fate = fates[e["id"]]
                reasons = [f"low_info:{e['_info']}"] if e["_info"] else []
                if fate in FATE_REASON:
                    reasons.append(FATE_REASON[fate])
                if fate in FATE_REASON or (reasons and fate != "self_replied"
                                           and tier in ("noise", "untouched", "delegated")):
                    ignore.append({"event": e["id"], "basis": reasons})
                elif reasons and fate != "self_replied":
                    # 事项本身有人跟进，但这一条低信息量、也没被直接回应：依据较弱，单独标出。
                    ignore.append({"event": e["id"], "basis": reasons + ["in_active_item", "no_direct_response"]})
        # 当时应在高档位：本帧投入度最高的几件（至少两次行动），数量受 64 份预算约束，默认 3 件。
        engaged = sorted((i for i in items if i["tier"] == "engaged" and i["engagement"] >= 2),
                         key=lambda i: (-i["engagement"], i["response_hours"], i["thread"]))
        for item in engaged[:high_per_frame]:
            item["high"] = True
            totals["high"] += 1
        groups = merge_groups(by_thread, links, events)
        by_item = {i["thread"]: i for i in items}
        for group in groups:  # 跨事项合并的组，档位取成员中最高的一个
            members = [by_item[t] for t in group["threads"] if t in by_item]
            if len(group["threads"]) > 1 and members:
                group["tier"] = min((m["tier"] for m in members), key=TIER_ORDER.index)
                group["high"] = any(m["high"] for m in members)
        totals["ignore_events"] += len(ignore)
        totals["ignore_events_weak"] += sum(1 for i in ignore if "in_active_item" in i["basis"])
        totals["groups"] += len(groups)
        totals["cross_thread_groups"] += sum(1 for g in groups if len(g["threads"]) > 1)
        totals["events"] += len(events)
        totals["input_events"] += sum(1 for e in events if e["author_kind"] != "self")
        out_frames.append({"frame": frame["id"], "at": frame["at"], "ignore": ignore, "groups": groups,
                           "items": sorted(items, key=lambda i: (not i["high"], TIER_ORDER.index(i["tier"]),
                                                                 -i.get("engagement", 0)))})
    return out_frames, totals


def merge_groups(by_thread: dict, links: dict, events: list[dict]) -> list[dict]:
    """同一线程的多条输入为一组；线程之间有引用、重复或修复关系时并成一组。"""
    parent = {t: t for t in by_thread}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        a, b = find(a), find(b)
        if a != b:
            parent[a] = b

    reasons = collections.defaultdict(set)
    for thread in by_thread:
        for other, why in links.get(thread, []):
            if other in parent and other != thread:
                union(thread, other)
                reasons[thread].add(why)
                reasons[other].add(why)
    for e in events:  # 非 GitHub 渠道里直接链接到本帧另一个 GitHub 线程
        for repo, number in GH_REF.findall(e.get("text") or ""):
            other = f"gh:{repo}#{number}"
            thread = e.get("thread") or e["id"]
            if other in parent and other != thread and not thread.startswith("gh:"):
                union(thread, other)
                reasons[thread].add("links_to")
    clusters = collections.defaultdict(list)
    for thread in by_thread:
        clusters[find(thread)].append(thread)
    groups = []
    for members in clusters.values():
        ids = [e["id"] for t in members for e in by_thread[t]]
        if len(ids) < 2:
            continue
        basis = ["same_thread"]
        if len(members) > 1:
            basis = sorted({"same_thread"} | {r for t in members for r in reasons[t]})
        groups.append({"threads": sorted(members), "events": ids, "basis": basis})
    return groups


def thread_root(item: dict, by_key: dict, key: str, parent_key: str) -> dict:
    root, seen = item, set()
    while root.get(parent_key) in by_key and root[key] not in seen:
        seen.add(root[key])
        root = by_key[root[parent_key]]
    return root


def curl_actions(raw: dict, meta: dict):
    """返回 (线程 → 行动列表, 线程 → 关联线程, 线程 → 结局, 输入 id → 直接去向)。"""
    me = meta["self"]["github"]
    names = set(meta["self"].get("names", []))
    users = {u["author"]: u for u in raw.get("github-users", [])}
    bots = {login for login, u in users.items() if u.get("author_is_bot") or u.get("type") == "Bot"
            or u.get("profile_says_bot")}
    threads = {(t["repo"], t["number"]): t for t in raw.get("github-threads", [])}
    # 团队：在别人开的线程上打过标签、关闭、指派、加里程碑或请求评审的人（不含本人与机器人）。
    team = set()
    for e in raw.get("github-timeline", []):
        thread = threads.get((e["repo"], e["number"]))
        if e["event"] in ("labeled", "closed", "milestoned", "assigned", "review_requested", "merged") and thread \
                and e["author"] not in (me, thread["author"]) and e["author"] not in bots and e["author"]:
            team.add(e["author"])
    actions = collections.defaultdict(list)

    def add(thread: str, login: str | None, at: str, action: str, ref: str | None) -> None:
        role = "self" if login == me else "team" if login in team else None
        if role:
            actions[thread].append({"at": parse_time(at), "who": role, "action": action, "ref": ref})

    for c in raw.get("github-comments", []):
        add(f"gh:{c['repo']}#{c['number']}", c["author"], c["at"], "comment", c["id"])
    for r in raw.get("github-reviews", []):
        add(f"gh:{r['repo']}#{r['number']}", r["author"], r["at"], f"review_{(r.get('state') or '').lower()}", r["id"])
    for c in raw.get("github-review-comments", []):
        add(f"gh:{c['repo']}#{c['number']}", c["author"], c["at"], "review_comment", c["id"])
    for e in raw.get("github-timeline", []):
        if e["event"] in ("closed", "reopened", "merged", "labeled", "unlabeled", "milestoned", "assigned",
                          "review_requested", "marked_as_duplicate", "locked", "ready_for_review",
                          "head_ref_force_pushed"):
            add(f"gh:{e['repo']}#{e['number']}", e["author"], e["at"], e["event"], e["id"])
    for d in raw.get("github-discussions", []):
        key = f"ghd:{d['repo']}#{d['number']}"
        if d.get("kind") == "discussion_comment":
            add(key, d["author"], d["at"], "comment", d["id"])
        if d.get("answer_chosen_at"):
            add(key, d.get("answer_chosen_by"), d["answer_chosen_at"], "answer_chosen", d["id"])
    # 邮件列表、Mastodon、博客：本人在同一线程里的发言；直接回复的那一条记为已回应。
    direct: dict[str, str] = {}
    posts = raw.get("lists", [])
    by_mid = {p.get("message_id"): p for p in posts}
    for p in posts:
        if p["author"] not in names:
            continue
        root = thread_root(p, by_mid, "message_id", "in_reply_to")
        actions[f"ml:{p['list']}:{root['id']}"].append(
            {"at": parse_time(p["at"]), "who": "self", "action": "list_reply", "ref": p["id"]})
        parent = by_mid.get(p.get("in_reply_to"))
        if parent:
            direct[parent["id"]] = "self_replied"
    statuses = raw.get("mastodon", [])
    by_sid = {s["status_id"]: s for s in statuses}
    for s in statuses:
        if not s["is_self"]:
            continue
        root = thread_root(s, by_sid, "status_id", "in_reply_to_id")
        verb = "mastodon_reply" if s.get("in_reply_to_id") else "mastodon_post"
        actions[f"md:{root['status_id']}"].append({"at": parse_time(s["at"]), "who": "self", "action": verb,
                                                   "ref": s["id"]})
        parent = by_sid.get(s.get("in_reply_to_id"))
        if parent and not parent["is_self"]:
            direct[parent["id"]] = "self_replied"
    for c in raw.get("blog", []):
        if c.get("is_self"):
            actions[f"blog:{c['post']}"].append({"at": parse_time(c["at"]), "who": "self", "action": "blog_reply",
                                                "ref": c["id"]})
            if c.get("parent"):
                direct[f"blog:{c['parent']}"] = "self_replied"
    # 行内评论并入所属评审成为一条输入；本人回复其中任一条，就算直接回应了那次评审。
    review_of = {int(c["id"].split(":")[1]): c.get("review_id") for c in raw.get("github-review-comments", [])}
    for c in raw.get("github-review-comments", []):
        if c["author"] == me and c.get("in_reply_to") in review_of:
            direct[f"gh-r:{review_of[c['in_reply_to']]}"] = "self_replied"
            direct[f"gh-rc:{c['in_reply_to']}"] = "self_replied"
    # CI：同一工作流、同一分支在 24 小时内有成功运行，失败通知就被后来的结果覆盖了。
    runs = collections.defaultdict(list)
    for r in raw.get("github-runs", []):
        runs[(r.get("workflow"), r.get("branch"))].append(r)
    for group in runs.values():
        group.sort(key=lambda r: r["at"])
        for i, r in enumerate(group):
            if r.get("conclusion") not in FAILED:
                continue
            failed_at = parse_time(r["at"])
            if any(o.get("conclusion") == "success"
                   and failed_at < parse_time(o["at"]) <= failed_at + dt.timedelta(hours=24) for o in group[i + 1:]):
                direct[r["id"]] = "superseded_by_success"
    # 线程之间的关系：交叉引用、标为重复、PR 正文里的 Fixes/Closes/Replaces。
    links = collections.defaultdict(list)

    def link(a: str, b: str, why: str) -> None:
        links[a].append((b, why))
        links[b].append((a, why))

    for e in raw.get("github-timeline", []):
        here = f"gh:{e['repo']}#{e['number']}"
        if e["event"] == "cross-referenced" and e.get("source_number"):
            link(here, f"gh:{e.get('source_repo') or e['repo']}#{e['source_number']}", "cross_referenced")
        if e["event"] == "marked_as_duplicate" and e.get("source_number"):
            link(here, f"gh:{e['repo']}#{e['source_number']}", "duplicate")
    for t in raw.get("github-threads", []):
        for number in re.findall(r"(?i)\b(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?|replaces|supersedes)\s+#(\d+)",
                                 t.get("text") or ""):
            link(f"gh:{t['repo']}#{t['number']}", f"gh:{t['repo']}#{number}", "fixes_or_replaces")
    outcome = {}
    for (repo, number), t in threads.items():
        key = f"gh:{repo}#{number}"
        outcome[key] = ({"state": "closed", "reason": t.get("state_reason"), "closed_at": t.get("closed_at"),
                         "merged": bool(t.get("merged_at"))} if t.get("state") == "closed" else {"state": "open"})
        if t.get("labels"):
            outcome[key]["labels"] = t["labels"]
    return actions, links, outcome, direct


def enron_actions(raw: dict, meta: dict):
    """Enron：已发送里同一主题的回复与转发是行动；来信最后所在的文件夹写入结局，删除记为直接去向。"""
    mails = raw.get("enron", [])
    actions = collections.defaultdict(list)
    outcome: dict[str, dict] = {}
    own = collections.Counter(m["author"] for m in mails if m.get("folder") in SENT_FOLDERS and m.get("author"))
    me = {address for address, _ in own.most_common(2)}
    direct: dict[str, str] = {}
    for m in mails:
        subject = (m.get("subject") or "").strip()
        thread = enron_thread(m)
        if m.get("author") in me and m.get("folder") in SENT_FOLDERS:
            verb = ("forward" if re.match(r"(?i)^\s*(fw|fwd)\s*:", subject)
                    else "reply" if re.match(r"(?i)^\s*re\s*:", subject) else "send")
            actions[thread].append({"at": parse_time(m["at"]), "who": "self", "action": verb, "ref": enron_id(m)})
        elif m.get("folder") not in VIEW_FOLDERS:
            folders = outcome.setdefault(thread, {"folders": []})["folders"]
            if m["folder"] not in folders:
                folders.append(m["folder"])
            if "deleted" in m["folder"]:
                direct[m.get("message_id") or m["id"]] = "deleted"
    return actions, {}, outcome, direct


def print_audit(corpus: dict, result: dict, size: int) -> None:
    """随机抽取若干条（帧，事项）标注及其输入原文，供人工核对；原文只打印到终端，不写文件。"""
    events = {e["id"]: e for f in corpus["frames"] for e in f["events"]}
    pool = [(f["frame"], item) for f in result["frames"] for item in f["items"]]
    rng = random.Random(20261015)
    for frame, item in rng.sample(pool, min(size, len(pool))):
        print(f"\n=== {frame} {item['thread']} → {item['tier']}{' HIGH' if item['high'] else ''} {item['basis']} "
              f"投入 {item.get('engagement')} {item.get('outcome', '')}")
        for event_id in item["events"][:4]:
            e = events[event_id]
            print(f"  [{e['at']}] {e.get('kind')} {e['from']} ({e['author_kind']}) {e.get('subject') or ''}")
            print("    " + re.sub(r"\s+", " ", e["text"])[:300])
        for a in item["evidence"][:2]:
            print(f"  → {a}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("source")
    parser.add_argument("--audit", type=int, default=0, help="打印 N 条随机抽样供人工核对")
    parser.add_argument("--high-per-frame", type=int, default=3, help="每帧最多标几件高档位事项")
    args = parser.parse_args()
    labels(args.source, args.audit, args.high_per_frame)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
