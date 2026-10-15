"""抓取 Fold 真实语料的原始记录：只取公开数据，不清洗、不去重、不删机器人。

来源（见 corpus/README.md 的调查与选择）：
  curl-bagder   主来源。Daniel Stenberg（GitHub: bagder）在同一时间窗里可从公开渠道重建的输入：
                curl/curl 等仓库的 issue、PR、评论、review、讨论、状态变化，他本人触发的 CI 运行，
                curl 邮件列表，Mastodon 上回复或提到他的帖子，以及他博客上的评论。
  enron-<user>  对照来源。CMU 公布的 Enron 邮件语料里某个邮箱同一窗口内的全部邮件（含已发送）。
  composite     混合人物的非工作流：iNaturalist 公开论坛的帖子、Stack Exchange 生活问答站的问题与回答评论、
                Substack 公开 newsletter、SMHI 天气观测。挑选与化名改写由 compose_corpus.py 完成。

用法：
  python3 scripts/fetch_corpus.py curl-bagder                         # 默认窗口 2026-08-03..2026-08-17
  python3 scripts/fetch_corpus.py curl-bagder --only github,lists     # 只重抓部分流
  python3 scripts/fetch_corpus.py enron-steffes-j                     # 默认窗口 2001-10-22..2001-11-05
  python3 scripts/fetch_corpus.py composite --only qa                 # 只重抓生活问答

时间窗 [start, end) 按来源时区的日期解释。为了让 build_corpus.py 推出弱标注，抓取范围是
[start - 1 天, end + followup 天]：窗口外的记录只作上下文与“后来发生了什么”的证据，不进入帧。

输出 corpus/<source>/raw/<stream>.json，每条记录至少含 id、stream、author、author_is_bot、at（UTC）、
text（原文）与 url，其余为该渠道的原始字段。原文不改写；唯一的处理是把电话号码样式替换为
[phone]，并在记录的 redacted 字段计数（不存邮箱地址以外的个人联系方式）。raw/ 不入库。

只用标准库：GitHub 通过 `gh api` 子进程（需已登录），其余走 HTTPS。每个来源顺序请求并限速，
遵守 robots.txt；GitHub 遇到限额会等到重置时间。
"""

from __future__ import annotations

import argparse
import datetime as dt
import email
import gzip
import email.parser
import email.policy
import email.utils
import html
import json
import re
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
USER_AGENT = "fold-corpus-fetch/0.1 (+https://github.com/nemori-ai/fold-skill; research corpus, rate-limited)"
UTC = dt.timezone.utc

SOURCES = {
    "curl-bagder": {
        "description": "Daniel Stenberg（curl 创始人与首席维护者）两周内的公开输入",
        "timezone": "Europe/Stockholm",
        "window": ("2026-08-03", "2026-08-17"),
        "followup_days": 30,
        "streams": ("github", "lists", "mastodon", "blog"),
        "self": {"github": "bagder", "mastodon_id": "39207", "names": ["Daniel Stenberg"]},
        "github_repos": ["curl/curl", "curl/curl-www", "curl/everything-curl"],
        "ci_repos": ["curl/curl"],
        # (list name, archive prefix on curl.se/mail/)
        "lists": [("curl-library", "lib"), ("curl-users", "archive"), ("curl-distros", "distros")],
        "mastodon": "https://mastodon.social",
        "blog": "https://daniel.haxx.se/blog",
    },
    # 混合人物的非工作流；工作流读 curl-bagder/raw，家庭与促销邮件由 compose_corpus.py 从 Enron 压缩包挑选。
    "composite": {
        "description": "混合人物两周的生活：工作、家庭、社区爱好与订阅噪音（化名改写）",
        "timezone": "Europe/Stockholm",
        "window": ("2026-08-03", "2026-08-17"),
        "followup_days": 30,
        "streams": ("forum", "qa", "newsletters", "weather"),
        "forum": "https://forum.inaturalist.org",
        # 生活问答：房屋维修、育儿、个人理财、烹饪、旅行、自行车、宠物、园艺
        "qa_sites": ["diy", "parenting", "money", "cooking", "travel", "bicycles", "pets", "gardening"],
        # Substack 托管的公开 newsletter：烹饪、科学随笔、技术、产品、经济、AI、建筑与住房
        "newsletters": ["smittenkitchen.substack.com", "dinneralovestory.substack.com",
                        "www.experimental-history.com", "newsletter.pragmaticengineer.com",
                        "www.lennysnewsletter.com", "www.noahpinion.blog", "www.understandingai.org",
                        "www.interconnects.ai", "www.construction-physics.com", "blog.bytebytego.com",
                        "www.astralcodexten.com"],
        # SMHI 开放数据（CC BY 4.0）：斯德哥尔摩天文台站的气温与降水，图灵厄站的阵风
        "weather": [(1, 98230), (7, 98230), (21, 97100)],
    },
}
ENRON_TARBALL = "https://www.cs.cmu.edu/~enron/enron_mail_20150507.tar.gz"
ENRON_DEFAULT = {
    "description": "CMU Enron 邮件语料中一个邮箱的同一窗口（对照来源）",
    "timezone": "America/Chicago",
    "window": ("2001-10-22", "2001-11-05"),
    "followup_days": 14,
    "streams": ("enron",),
}

# 电话号码样式：北美带分隔符的十位号码、带国家码的国际号码、显式“Phone/Tel/Fax/Cell”后的号码。
PHONE_PATTERNS = [
    re.compile(r"(?<![\w.])\(?\d{3}\)?[ .-]\d{3}[.-]\d{4}(?![\w.])"),
    re.compile(r"(?<![\w+])\+\d{1,3}[ .-]\(?\d{1,4}\)?[ .-]\d{2,4}[ .-]?\d{2,4}(?:[ .-]?\d{2,4})?(?![\w.])"),
    re.compile(r"(?i)\b(?:phone|tel|fax|cell|mobile|pager)\b\s*(?:#|no\.?|number)?\s*[:.]?\s*\(?\d[\d ().-]{6,}\d"),
]


def redact(text: str | None) -> tuple[str, int]:
    if not text:
        return text or "", 0
    count = 0
    for pattern in PHONE_PATTERNS:
        text, n = pattern.subn("[phone]", text)
        count += n
    return text, count


def iso(value: dt.datetime) -> str:
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_time(value: str) -> dt.datetime:
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


def record(id_: str, stream: str, author: str | None, author_is_bot: bool, at: str, text: str | None,
           url: str | None, **meta) -> dict:
    clean, redacted = redact(text)
    item = {"id": id_, "stream": stream, "author": author, "author_is_bot": author_is_bot, "at": at,
            "text": clean, "url": url}
    if redacted:
        item["redacted"] = redacted
    for key, value in meta.items():
        if isinstance(value, str) and key in ("title", "subject", "body"):
            value, n = redact(value)
            if n:
                item["redacted"] = item.get("redacted", 0) + n
        item[key] = value
    return item


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


# ---------- HTTP（非 GitHub） ----------

class Http:
    def __init__(self, delay: float):
        self.delay = delay
        self.last = 0.0
        self.robots: dict[str, list[str]] = {}

    def allowed(self, url: str) -> bool:
        parts = urllib.parse.urlsplit(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        if origin not in self.robots:
            rules: list[str] = []
            try:
                text = self._get(origin + "/robots.txt").decode("utf-8", "replace")
                applies = False
                for line in text.splitlines():
                    line = line.split("#", 1)[0].strip()
                    if ":" not in line:
                        continue
                    key, value = (s.strip() for s in line.split(":", 1))
                    if key.lower() == "user-agent":
                        applies = value == "*"
                    elif key.lower() == "disallow" and applies and value:
                        rules.append(value)
            except urllib.error.HTTPError:
                pass  # 没有 robots.txt：不限制
            self.robots[origin] = rules
        return not any(parts.path.startswith(rule) for rule in self.robots[origin])

    def _get(self, url: str) -> bytes:
        wait = self.delay - (time.monotonic() - self.last)
        if wait > 0:
            time.sleep(wait)
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        for attempt in range(4):
            try:
                with urllib.request.urlopen(request, timeout=60) as response:
                    self.last = time.monotonic()
                    return response.read()
            except urllib.error.HTTPError as error:
                self.last = time.monotonic()
                if error.code == 429 or error.code >= 500:
                    retry = int(error.headers.get("Retry-After") or 0) or 10 * (attempt + 1)
                    log(f"  {error.code}，{retry}s 后重试：{url}")
                    time.sleep(retry)
                    continue
                raise
            except urllib.error.URLError as error:
                log(f"  网络错误 {error}，重试：{url}")
                time.sleep(5 * (attempt + 1))
        raise RuntimeError(f"多次失败：{url}")

    def get(self, url: str) -> bytes:
        if not self.allowed(url):
            raise PermissionError(f"robots.txt 不允许：{url}")
        return self._get(url)

    def json(self, url: str):
        return json.loads(self.get(url))


def html_to_text(fragment: str) -> str:
    fragment = re.sub(r"(?i)<br\s*/?>", "\n", fragment)
    fragment = re.sub(r"(?i)</p>\s*<p[^>]*>", "\n\n", fragment)
    fragment = re.sub(r"(?i)</?(p|div|li|pre|blockquote)[^>]*>", "\n", fragment)
    fragment = re.sub(r"<[^>]+>", "", fragment)
    text = html.unescape(fragment)
    text = re.sub(r"[ \t]+\n", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


# ---------- GitHub ----------

def gh(args: list[str]) -> str:
    for attempt in range(6):
        proc = subprocess.run(["gh", "api", *args], capture_output=True, text=True)
        if proc.returncode == 0:
            return proc.stdout
        message = proc.stderr
        if "rate limit" in message.lower() or "HTTP 429" in message:
            limits = subprocess.run(["gh", "api", "rate_limit", "--jq", ".resources.core | [.remaining, .reset] | @tsv"],
                                    capture_output=True, text=True).stdout.split()
            remaining, reset = (int(limits[0]), int(limits[1])) if len(limits) == 2 else (0, 0)
            # 主限额用尽时等到重置；否则是次级限额，按次数退避。
            wait = reset - int(time.time()) + 5 if remaining == 0 and reset else 60 * (attempt + 1)
            log(f"  GitHub 限额，等待 {wait}s")
            time.sleep(min(max(wait, 30), 3700))
            continue
        if "HTTP 5" in message or "timeout" in message.lower():
            time.sleep(10 * (attempt + 1))
            continue
        if "HTTP 404" in message or "HTTP 410" in message:
            return ""
        if attempt < 2:  # 偶发的连接中断或截断响应
            time.sleep(5 * (attempt + 1))
            continue
        raise RuntimeError(f"gh api {' '.join(args)} 失败：{message[:400]}")
    raise RuntimeError(f"gh api {' '.join(args)} 多次失败")


def gh_items(path: str, jq: str = ".[]", paginate: bool = True) -> list[dict]:
    args = ["-H", "Accept: application/vnd.github+json"]
    if paginate:
        args.append("--paginate")
    out = gh([*args, path, "--jq", jq])
    return [json.loads(line) for line in out.splitlines() if line.strip()]


def gh_pages_while(path: str, keep) -> list[dict]:
    """按页读取一个按时间倒序的列表，遇到第一条 keep() 为假的记录就停，免得翻完整个历史。"""
    page, out = 1, []
    while True:
        items = gh_items(f"{path}&page={page}", paginate=False)
        for item in items:
            if not keep(item):
                return out
            out.append(item)
        if len(items) < 100:
            return out
        page += 1


def gh_graphql(query: str, variables: dict) -> dict:
    args = ["graphql", "-f", f"query={query}"]
    for key, value in variables.items():
        args += ["-F" if isinstance(value, int) else "-f", f"{key}={value}"]
    return json.loads(gh(args))


def user_fields(user: dict | None) -> tuple[str | None, bool]:
    if not user:
        return None, False
    login = user.get("login")
    return login, user.get("type") == "Bot" or str(login).endswith("[bot]")


def reactions(value: dict | None) -> int:
    return (value or {}).get("total_count", 0)


DISCUSSIONS_QUERY = """
query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    discussions(first: 25, after: $cursor, orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id databaseId number title body url createdAt updatedAt closed closedAt stateReason
        author { login __typename } category { name } answerChosenAt answerChosenBy { login }
        labels(first: 10) { nodes { name } }
        comments(first: 100) {
          nodes {
            id databaseId body url createdAt updatedAt isMinimized minimizedReason isAnswer
            author { login __typename }
            replies(first: 100) {
              nodes { id databaseId body url createdAt updatedAt isMinimized minimizedReason
                      author { login __typename } replyTo { id } }
            }
          }
        }
      }
    }
  }
}
"""

TIMELINE_KEEP = {"closed", "reopened", "merged", "labeled", "unlabeled", "milestoned", "demilestoned",
                 "assigned", "unassigned", "review_requested", "review_request_removed", "cross-referenced",
                 "referenced", "marked_as_duplicate", "unmarked_as_duplicate", "renamed", "locked", "unlocked",
                 "convert_to_draft", "ready_for_review", "head_ref_force_pushed", "head_ref_deleted",
                 "committed", "connected", "disconnected", "pinned", "transferred"}


def fetch_github(config: dict, lo: dt.datetime, hi: dt.datetime, window: tuple[dt.datetime, dt.datetime]) -> dict:
    """返回 {stream 名: 记录列表}。lo/hi 是抓取范围，window 是评测窗口（决定哪些线程要取时间线）。"""
    since = iso(lo)
    out: dict[str, list] = {"github-threads": [], "github-comments": [], "github-reviews": [],
                            "github-review-comments": [], "github-timeline": [], "github-discussions": [],
                            "github-runs": [], "github-releases": [], "github-users": []}
    authors: set[str] = set()
    for repo in config["github_repos"]:
        log(f"GitHub {repo}：线程")
        threads = gh_items(f"repos/{repo}/issues?state=all&since={since}&sort=updated&direction=asc&per_page=100")
        for t in threads:
            login, bot = user_fields(t.get("user"))
            authors.add(login or "")
            is_pr = "pull_request" in t
            out["github-threads"].append(record(
                f"gh-t:{repo}#{t['number']}", "github-threads", login, bot, t["created_at"], t.get("body"),
                t["html_url"], repo=repo, number=t["number"], is_pr=is_pr, title=t["title"],
                state=t["state"], state_reason=t.get("state_reason"), closed_at=t.get("closed_at"),
                updated_at=t["updated_at"], labels=[l["name"] for l in t.get("labels", [])],
                milestone=(t.get("milestone") or {}).get("title"), comments=t.get("comments"),
                author_association=t.get("author_association"), reactions=reactions(t.get("reactions")),
                locked=t.get("locked"), draft=t.get("draft"),
                merged_at=(t.get("pull_request") or {}).get("merged_at"),
                via_app=(t.get("performed_via_github_app") or {}).get("slug")))
        # PR 的来源分支：CI 运行只带分支名，靠它把失败通知归到对应的 PR。
        heads = {p["number"]: p for p in gh_pages_while(
            f"repos/{repo}/pulls?state=all&sort=updated&direction=desc&per_page=100",
            lambda p: parse_time(p["updated_at"]) >= lo)}
        for t in out["github-threads"]:
            pull = heads.get(t["number"]) if t["repo"] == repo and t["is_pr"] else None
            if pull:
                t["head_ref"] = pull["head"]["ref"]
                t["head_repo"] = ((pull["head"] or {}).get("repo") or {}).get("full_name")
        log(f"GitHub {repo}：评论")
        for c in gh_items(f"repos/{repo}/issues/comments?since={since}&sort=created&direction=asc&per_page=100"):
            if not (lo <= parse_time(c["created_at"]) <= hi):
                continue
            login, bot = user_fields(c.get("user"))
            authors.add(login or "")
            number = int(c["issue_url"].rsplit("/", 1)[1])
            out["github-comments"].append(record(
                f"gh-c:{c['id']}", "github-comments", login, bot, c["created_at"], c.get("body"), c["html_url"],
                repo=repo, number=number, updated_at=c.get("updated_at"),
                author_association=c.get("author_association"), reactions=reactions(c.get("reactions")),
                minimized=c.get("minimized"), via_app=(c.get("performed_via_github_app") or {}).get("slug")))
        log(f"GitHub {repo}：行内评审评论")
        for c in gh_items(f"repos/{repo}/pulls/comments?since={since}&sort=created&direction=asc&per_page=100"):
            if not (lo <= parse_time(c["created_at"]) <= hi):
                continue
            login, bot = user_fields(c.get("user"))
            authors.add(login or "")
            number = int(c["pull_request_url"].rsplit("/", 1)[1])
            out["github-review-comments"].append(record(
                f"gh-rc:{c['id']}", "github-review-comments", login, bot, c["created_at"], c.get("body"),
                c["html_url"], repo=repo, number=number, review_id=c.get("pull_request_review_id"),
                in_reply_to=c.get("in_reply_to_id"), path=c.get("path"), line=c.get("line") or c.get("original_line"),
                updated_at=c.get("updated_at"), author_association=c.get("author_association"),
                reactions=reactions(c.get("reactions"))))
        # 窗口里有动静的线程：取 review 与时间线（弱标注的证据）。只有 review 或状态变化的 PR，
        # 用“窗口内或窗口后三天内更新过”近似，宁多取几个。
        def in_window(value: str | None) -> bool:
            return bool(value) and window[0] <= parse_time(value) < window[1]
        touched = {c["number"] for stream in ("github-comments", "github-review-comments")
                   for c in out[stream] if c["repo"] == repo and in_window(c["at"])}
        active = sorted(t["number"] for t in out["github-threads"] if t["repo"] == repo and (
            in_window(t["at"]) or in_window(t.get("closed_at")) or t["number"] in touched or (
                t["is_pr"] and parse_time(t["at"]) < window[1]
                and window[0] <= parse_time(t["updated_at"]) < window[1] + dt.timedelta(days=3))))
        log(f"GitHub {repo}：{len(active)} 个线程的 review 与时间线")
        for index, number in enumerate(active, 1):
            thread = next(t for t in out["github-threads"] if t["repo"] == repo and t["number"] == number)
            if thread["is_pr"]:
                for r in gh_items(f"repos/{repo}/pulls/{number}/reviews?per_page=100"):
                    if not r.get("submitted_at"):
                        continue
                    login, bot = user_fields(r.get("user"))
                    authors.add(login or "")
                    out["github-reviews"].append(record(
                        f"gh-r:{r['id']}", "github-reviews", login, bot, r["submitted_at"], r.get("body"),
                        r.get("html_url"), repo=repo, number=number, state=r.get("state"),
                        author_association=r.get("author_association"), commit_id=r.get("commit_id")))
            for e in gh_items(f"repos/{repo}/issues/{number}/timeline?per_page=100"):
                kind = e.get("event")
                if kind not in TIMELINE_KEEP:
                    continue
                actor = e.get("actor") or e.get("author") or {}
                at = e.get("created_at") or (e.get("committer") or {}).get("date") or (e.get("author") or {}).get("date")
                if not at:
                    continue
                login, bot = user_fields(actor) if "login" in actor else (actor.get("name"), False)
                source = (e.get("source") or {}).get("issue") or {}
                source_number = ((e.get("source") or {}).get("issue") or {}).get("number")
                event_id = e.get("id") or e.get("sha") or e.get("node_id") or f"{kind}-{at}-{source_number}"
                out["github-timeline"].append(record(
                    f"gh-e:{repo}#{number}:{event_id}", "github-timeline",
                    login, bot, at.replace(".000", ""), e.get("message"), e.get("html_url") or thread["url"],
                    repo=repo, number=number, event=kind, commit_id=e.get("commit_id") or e.get("sha"),
                    label=(e.get("label") or {}).get("name"), milestone=(e.get("milestone") or {}).get("title"),
                    state_reason=e.get("state_reason"),
                    assignee=(e.get("assignee") or {}).get("login"),
                    requested_reviewer=(e.get("requested_reviewer") or {}).get("login"),
                    source_repo=(source.get("repository") or {}).get("full_name") or (
                        source.get("repository_url", "").split("repos/")[-1] if source else None),
                    source_number=source.get("number"), source_is_pr="pull_request" in source if source else None,
                    rename=e.get("rename")))
            if index % 50 == 0:
                log(f"  {index}/{len(active)}")
        log(f"GitHub {repo}：讨论")
        owner, name = repo.split("/")
        cursor = None
        while True:
            data = gh_graphql(DISCUSSIONS_QUERY, {"owner": owner, "name": name, **({"cursor": cursor} if cursor else {})})
            block = data["data"]["repository"]["discussions"]
            stop = False
            for d in block["nodes"]:
                if parse_time(d["updatedAt"]) < lo:
                    stop = True
                    break
                login = (d.get("author") or {}).get("login")
                bot = (d.get("author") or {}).get("__typename") == "Bot"
                authors.add(login or "")
                comments = []
                for c in d["comments"]["nodes"]:
                    for node in [c, *c["replies"]["nodes"]]:
                        node_login = (node.get("author") or {}).get("login")
                        authors.add(node_login or "")
                        if not (lo <= parse_time(node["createdAt"]) <= hi):
                            continue
                        comments.append(record(
                            f"gh-dc:{node['databaseId']}", "github-discussions", node_login,
                            (node.get("author") or {}).get("__typename") == "Bot", node["createdAt"], node.get("body"),
                            node["url"], repo=repo, number=d["number"], kind="discussion_comment",
                            reply_to=(node.get("replyTo") or {}).get("id"), node_id=node["id"],
                            parent_comment=c["id"] if node is not c else None, is_answer=node.get("isAnswer"),
                            minimized=node.get("minimizedReason") if node.get("isMinimized") else None,
                            updated_at=node.get("updatedAt")))
                out["github-discussions"].append(record(
                    f"gh-d:{repo}#{d['number']}", "github-discussions", login, bot, d["createdAt"], d.get("body"),
                    d["url"], repo=repo, number=d["number"], kind="discussion", title=d["title"],
                    category=(d.get("category") or {}).get("name"), closed=d.get("closed"), closed_at=d.get("closedAt"),
                    state_reason=d.get("stateReason"), answer_chosen_at=d.get("answerChosenAt"),
                    answer_chosen_by=(d.get("answerChosenBy") or {}).get("login"),
                    labels=[l["name"] for l in d["labels"]["nodes"]], updated_at=d["updatedAt"]))
                out["github-discussions"].extend(comments)
            if stop or not block["pageInfo"]["hasNextPage"]:
                break
            cursor = block["pageInfo"]["endCursor"]
        log(f"GitHub {repo}：发布")
        for r in gh_items(f"repos/{repo}/releases?per_page=30", paginate=False):
            published = r.get("published_at")
            if published and lo <= parse_time(published) <= hi:
                login, bot = user_fields(r.get("author"))
                out["github-releases"].append(record(
                    f"gh-rel:{r['id']}", "github-releases", login, bot, published, r.get("body"), r["html_url"],
                    repo=repo, title=r.get("name") or r.get("tag_name"), tag=r.get("tag_name"),
                    prerelease=r.get("prerelease")))
    me = config["self"]["github"]
    for repo in config.get("ci_repos", []):
        log(f"GitHub {repo}：{me} 触发的工作流运行（按天分段，避开 1000 条上限）")
        day = lo.replace(hour=0, minute=0, second=0)
        runs_hi = min(hi, window[1] + dt.timedelta(days=3))  # 判断“后来是否转绿”只需要窗口后几天
        while day <= runs_hi:
            stamp = day.strftime("%Y-%m-%d")
            for r in gh_items(f"repos/{repo}/actions/runs?actor={me}&created={stamp}&per_page=100",
                              jq=".workflow_runs[]"):
                login, bot = user_fields(r.get("triggering_actor") or r.get("actor"))
                text = f"{r.get('name')} · {r.get('display_title')} · {r.get('conclusion') or r.get('status')}"
                out["github-runs"].append(record(
                    f"gh-run:{r['id']}", "github-runs", login, bot, r["created_at"], text, r["html_url"],
                    repo=repo, workflow=r.get("name"), workflow_id=r.get("workflow_id"), title=r.get("display_title"),
                    event=r.get("event"), status=r.get("status"), conclusion=r.get("conclusion"),
                    branch=r.get("head_branch"), head_sha=r.get("head_sha"), run_attempt=r.get("run_attempt"),
                    updated_at=r.get("updated_at"),
                    # API 也会列出别的仓库里以同名分支为来源的 PR，只保留以本仓库为目标的。
                    pull_requests=[p["number"] for p in r.get("pull_requests") or []
                                   if ((p.get("base") or {}).get("repo") or {}).get("url", "").endswith(f"/repos/{repo}")]))
            day += dt.timedelta(days=1)
    log(f"GitHub：{len(authors)} 位作者的公开资料（只保留类型与是否自称机器人）")
    for login in sorted(a for a in authors if a):
        try:
            profile = gh_items(f"users/{login}", jq=".", paginate=False)
        except RuntimeError as error:
            log(f"  跳过 {login}：{error}")
            continue
        if not profile:
            continue
        p = profile[0]
        words = f"{p.get('name') or ''} {p.get('bio') or ''}".lower()
        out["github-users"].append({
            "id": f"gh-u:{login}", "stream": "github-users", "author": login,
            "author_is_bot": p.get("type") == "Bot" or login.endswith("[bot]"), "at": p.get("created_at"),
            "text": None, "url": p.get("html_url"), "type": p.get("type"),
            "profile_says_bot": bool(re.search(r"\b(ro)?bot\b|automat", words))})
    return out


# ---------- 邮件列表（curl.se 上的 hypermail 存档） ----------

def months_between(lo: dt.datetime, hi: dt.datetime) -> list[str]:
    months, cursor = [], dt.date(lo.year, lo.month, 1)
    while cursor <= hi.date():
        months.append(cursor.strftime("%Y-%m"))
        cursor = dt.date(cursor.year + (cursor.month == 12), cursor.month % 12 + 1, 1)
    return months


def hypermail_comment(page: str, key: str) -> str | None:
    match = re.search(rf'<!-- {key}="(.*?)" -->', page)
    return html.unescape(match.group(1)) if match else None


def fetch_lists(config: dict, lo: dt.datetime, hi: dt.datetime, http: Http) -> dict:
    posts = []
    for name, prefix in config["lists"]:
        for month in months_between(lo, hi):
            index_url = f"https://curl.se/mail/{prefix}-{month}/date.html"
            try:
                index = http.get(index_url).decode("utf-8", "replace")
            except urllib.error.HTTPError as error:
                log(f"邮件列表 {name} {month}：{error.code}，跳过")
                continue
            pages = sorted(set(re.findall(r'href="(\d{4}\.html)"', index)))
            log(f"邮件列表 {name} {month}：{len(pages)} 封")
            for page_name in pages:
                url = f"https://curl.se/mail/{prefix}-{month}/{page_name}"
                page = http.get(url).decode("utf-8", "replace")
                sent = hypermail_comment(page, "isosent")
                if not sent:
                    continue
                at = dt.datetime.strptime(sent, "%Y%m%d%H%M%S").replace(tzinfo=UTC)
                if not (lo <= at <= hi):
                    continue
                body_match = re.search(r'<a name="start"[^>]*></a>(.*?)<span id="received">', page, re.S)
                body = html_to_text(body_match.group(1)) if body_match else ""
                author = (hypermail_comment(page, "name") or "").replace(f" via {name}", "").strip()
                posts.append(record(
                    f"ml:{name}/{month}/{page_name[:4]}", "lists", author, False, iso(at), body, url,
                    list=name, subject=hypermail_comment(page, "subject"),
                    message_id=hypermail_comment(page, "id"), in_reply_to=hypermail_comment(page, "inreplyto")))
    return {"lists": posts}


# ---------- Mastodon ----------

def status_record(status: dict, self_id: str) -> dict:
    account = status["account"]
    mentions = [m["acct"] for m in status.get("mentions", [])]
    card = status.get("card") or {}
    return record(
        f"md:{status['id']}", "mastodon", account["acct"], bool(account.get("bot")), status["created_at"].replace(".000", ""),
        html_to_text(status.get("content") or ""), status.get("url") or status.get("uri"),
        status_id=status["id"], in_reply_to_id=status.get("in_reply_to_id"),
        in_reply_to_account_id=status.get("in_reply_to_account_id"), account_id=account["id"],
        is_self=account["id"] == self_id, mentions=mentions, visibility=status.get("visibility"),
        spoiler=status.get("spoiler_text") or None, media=len(status.get("media_attachments") or []),
        card_url=card.get("url"), replies_count=status.get("replies_count"),
        reblogs_count=status.get("reblogs_count"), favourites_count=status.get("favourites_count"),
        language=status.get("language"), edited_at=status.get("edited_at"))


def snowflake(value: dt.datetime) -> int:
    return int(value.timestamp() * 1000) << 16


def fetch_mastodon(config: dict, lo: dt.datetime, hi: dt.datetime, http: Http) -> dict:
    base, self_id = config["mastodon"], config["self"]["mastodon_id"]
    own, max_id = [], snowflake(hi)
    while True:
        page = http.json(f"{base}/api/v1/accounts/{self_id}/statuses?limit=40&exclude_reblogs=true&max_id={max_id}")
        page = [s for s in page if parse_time(s["created_at"]) >= lo]
        if not page:
            break
        own.extend(page)
        max_id = page[-1]["id"]
    log(f"Mastodon：自己的帖子 {len(own)} 条，逐条取上下文")
    seen: dict[str, dict] = {}
    for index, status in enumerate(own, 1):
        seen[status["id"]] = status_record(status, self_id)
        context = http.json(f"{base}/api/v1/statuses/{status['id']}/context")
        for other in context.get("ancestors", []) + context.get("descendants", []):
            if other.get("visibility") not in ("public", "unlisted"):
                continue
            if not (lo <= parse_time(other["created_at"]) <= hi):
                continue
            seen.setdefault(other["id"], status_record(other, self_id))
        if index % 40 == 0:
            log(f"  {index}/{len(own)}")
    statuses = sorted(seen.values(), key=lambda s: s["at"])
    return {"mastodon": statuses}


# ---------- 博客评论（WordPress REST API） ----------

def fetch_blog(config: dict, lo: dt.datetime, hi: dt.datetime, http: Http) -> dict:
    base = config["blog"]
    comments, page = [], 1
    while True:
        query = urllib.parse.urlencode({"after": iso(lo).rstrip("Z"), "before": iso(hi).rstrip("Z"), "per_page": 100,
                                        "page": page, "orderby": "date", "order": "asc"})
        try:
            batch = http.json(f"{base}/wp-json/wp/v2/comments?{query}")
        except urllib.error.HTTPError as error:
            if error.code == 400:
                break
            raise
        if not batch:
            break
        comments.extend(batch)
        page += 1
    titles: dict[int, str] = {}
    for post in sorted({c["post"] for c in comments}):
        data = http.json(f"{base}/wp-json/wp/v2/posts/{post}?_fields=id,title,link")
        titles[post] = html.unescape(data["title"]["rendered"])
    names = set(config["self"]["names"])
    out = []
    for c in comments:
        at = c.get("date_gmt") + "Z"
        out.append(record(
            f"blog:{c['id']}", "blog", c.get("author_name"), False, at,
            html_to_text(c["content"]["rendered"]), c.get("link"), post=c["post"], title=titles.get(c["post"]),
            parent=c.get("parent") or None, is_self=bool(c.get("author")) or c.get("author_name") in names))
    log(f"博客评论：{len(out)} 条")
    return {"blog": out}


# ---------- 社区论坛（Discourse 公开 JSON） ----------

def fetch_forum(config: dict, lo: dt.datetime, hi: dt.datetime, http: Http) -> dict:
    """沿全站最新帖子列表向前翻页，留下抓取范围内的全部帖子；谁的帖子算本人由 compose_corpus.py 决定。"""
    base = config["forum"]
    categories = {c["id"]: c["name"] for c in http.json(f"{base}/categories.json")["category_list"]["categories"]}
    posts, before = [], None
    while True:
        page = http.json(f"{base}/posts.json" + (f"?before={before}" if before else ""))["latest_posts"]
        if not page:
            break
        for post in page:
            at = parse_time(post["created_at"])
            if lo <= at <= hi:
                posts.append(record(
                    f"forum:{post['id']}", "forum", post["username"], False, iso(at), post.get("raw") or "",
                    f"{base}/t/{post['topic_slug']}/{post['topic_id']}/{post['post_number']}",
                    name=post.get("name") or None, topic_id=post["topic_id"], title=post.get("topic_title"),
                    category=categories.get(post.get("category_id"), post.get("category_id")),
                    post_number=post["post_number"], reply_to_post_number=post.get("reply_to_post_number"),
                    reply_to_user=(post.get("reply_to_user") or {}).get("username"), edited=post.get("version", 1) > 1,
                    hidden=post.get("hidden"), staff=post.get("staff"), trust_level=post.get("trust_level"),
                    post_type=post.get("post_type"), reads=post.get("reads"), reply_count=post.get("reply_count")))
        oldest = parse_time(page[-1]["created_at"])
        if oldest < lo:
            break
        before = page[-1]["id"]
        if len(posts) % 500 < 50:
            log(f"  论坛：已到 {oldest:%Y-%m-%d}，{len(posts)} 条")
    posts.sort(key=lambda p: p["at"])
    log(f"论坛：{len(posts)} 条帖子")
    return {"forum": posts}


# ---------- 订阅 newsletter（Substack 公开归档） ----------

def fetch_newsletters(config: dict, lo: dt.datetime, hi: dt.datetime, http: Http) -> dict:
    out = []
    for host in config["newsletters"]:
        base, offset, posts = f"https://{host}", 0, []
        while True:
            page = http.json(f"{base}/api/v1/archive?sort=new&offset={offset}&limit=12")
            if not page:
                break
            posts.extend(p for p in page if lo <= parse_time(p["post_date"]) <= hi)
            if parse_time(page[-1]["post_date"]) < lo:
                break
            offset += len(page)
        for post in sorted(posts, key=lambda p: p["post_date"]):
            # 付费文章只有公开预览；正文取公开可见的部分，与订阅者收到的免费预览一致。
            detail = http.json(f"{base}/api/v1/posts/{post['slug']}")
            body = html_to_text(detail.get("body_html") or "") or detail.get("truncated_body_text") or ""
            author = (detail.get("publishedBylines") or [{}])[0].get("name")
            publication = (detail.get("publication") or {}).get("name") or host
            out.append(record(
                f"nl:{host}:{post['id']}", "newsletter", publication, False, iso(parse_time(post["post_date"])),
                body, post.get("canonical_url"), title=post.get("title"), subtitle=post.get("subtitle"),
                audience=post.get("audience"), host=host, byline=author, wordcount=detail.get("wordcount")))
        log(f"newsletter {host}：{len(posts)} 篇")
    out.sort(key=lambda r: r["at"])
    return {"newsletters": out}


# ---------- 生活问答（Stack Exchange 公开 API，内容按 CC BY-SA 发布） ----------

def fetch_stackexchange(config: dict, lo: dt.datetime, hi: dt.datetime, window: tuple[dt.datetime, dt.datetime],
                        http: Http) -> dict:
    """窗口内提出的问题，以及它们在抓取范围内收到的回答与评论。"""
    api = "https://api.stackexchange.com/2.3"

    def pages(path: str, params: dict) -> list[dict]:
        items, page = [], 1
        while True:
            query = urllib.parse.urlencode({**params, "page": page, "pagesize": 100, "filter": "withbody"})
            body = http.get(f"{api}/{path}?{query}")
            data = json.loads(gzip.decompress(body) if body[:2] == b"\x1f\x8b" else body)
            items.extend(data.get("items", []))
            if data.get("backoff"):
                time.sleep(int(data["backoff"]) + 1)
            if not data.get("has_more"):
                return items
            page += 1

    def stamp(value: int) -> str:
        return iso(dt.datetime.fromtimestamp(value, UTC))

    out = []
    for site in config["qa_sites"]:
        questions = pages("questions", {"site": site, "fromdate": int(lo.timestamp()),
                                        "todate": int(window[1].timestamp()), "sort": "creation", "order": "asc"})
        ids = [str(q["question_id"]) for q in questions]
        answers, comments = [], []
        for start in range(0, len(ids), 100):
            chunk = ";".join(ids[start:start + 100])
            answers += pages(f"questions/{chunk}/answers", {"site": site})
            comments += pages(f"questions/{chunk}/comments", {"site": site})
        answer_ids = [str(a["answer_id"]) for a in answers]
        for start in range(0, len(answer_ids), 100):
            comments += pages(f"answers/{';'.join(answer_ids[start:start + 100])}/comments", {"site": site})
        answer_question = {a["answer_id"]: a["question_id"] for a in answers}
        titles = {q["question_id"]: html.unescape(q["title"]) for q in questions}

        def owner(item: dict) -> tuple[str | None, int | None]:
            user = item.get("owner") or {}
            return (html.unescape(user["display_name"]) if user.get("display_name") else None), user.get("user_id")

        for q in questions:
            name, uid = owner(q)
            out.append(record(f"se:{site}:q{q['question_id']}", "qa", name, False, stamp(q["creation_date"]),
                              html_to_text(q.get("body") or ""), q.get("link"), site=site, kind="question",
                              question_id=q["question_id"], title=titles[q["question_id"]], user_id=uid,
                              tags=q.get("tags"), score=q.get("score"), accepted_answer_id=q.get("accepted_answer_id"),
                              closed_reason=q.get("closed_reason"), edited=bool(q.get("last_edit_date"))))
        for a in answers:
            if stamp(a["creation_date"]) > iso(hi):
                continue
            name, uid = owner(a)
            out.append(record(f"se:{site}:a{a['answer_id']}", "qa", name, False, stamp(a["creation_date"]),
                              html_to_text(a.get("body") or ""), f"https://{site}.stackexchange.com/a/{a['answer_id']}",
                              site=site, kind="answer", question_id=a["question_id"],
                              title=titles.get(a["question_id"]), user_id=uid, score=a.get("score"),
                              is_accepted=a.get("is_accepted"), edited=bool(a.get("last_edit_date"))))
        for c in comments:
            if stamp(c["creation_date"]) > iso(hi):
                continue
            name, uid = owner(c)
            question = c["post_id"] if c["post_id"] in titles else answer_question.get(c["post_id"])
            reply = (c.get("reply_to_user") or {}).get("user_id")
            out.append(record(f"se:{site}:c{c['comment_id']}", "qa", name, False, stamp(c["creation_date"]),
                              html_to_text(c.get("body") or ""), f"https://{site}.stackexchange.com/q/{question}",
                              site=site, kind="comment", question_id=question, post_id=c["post_id"],
                              title=titles.get(question), user_id=uid, reply_to_user_id=reply, score=c.get("score"),
                              edited=bool(c.get("edited"))))
        log(f"Stack Exchange {site}：问题 {len(questions)}、回答 {len(answers)}、评论 {len(comments)}")
    out.sort(key=lambda r: (r["at"], r["id"]))
    return {"qa": out}


# ---------- 天气（SMHI 开放数据，观测值） ----------

def fetch_weather(config: dict, lo: dt.datetime, hi: dt.datetime, http: Http) -> dict:
    out = []
    for parameter, station in config["weather"]:
        url = (f"https://opendata-download-metobs.smhi.se/api/version/1.0/parameter/{parameter}/station/{station}"
               "/period/latest-months/data.json")
        data = http.json(url)
        for value in data.get("value") or []:
            at = dt.datetime.fromtimestamp(value["date"] / 1000, UTC)
            if lo <= at <= hi:
                out.append(record(
                    f"smhi:{parameter}:{station}:{value['date']}", "weather", "SMHI", True, iso(at), value["value"],
                    url, parameter=parameter, parameter_name=data["parameter"]["name"],
                    unit=data["parameter"].get("unit"), station=station, station_name=data["station"]["name"],
                    quality=value.get("quality")))
    out.sort(key=lambda r: (r["at"], r["id"]))
    log(f"天气观测：{len(out)} 个值")
    return {"weather": out}


# ---------- Enron（CMU 2015-05-07 版） ----------

def fetch_enron(user: str, lo: dt.datetime, hi: dt.datetime, cache: Path, http: Http) -> dict:
    tarball = cache / "enron_mail_20150507.tar.gz"
    if not tarball.exists():
        cache.mkdir(parents=True, exist_ok=True)
        log(f"下载 {ENRON_TARBALL}（约 423 MB）到 {tarball}")
        partial = tarball.with_suffix(".part")
        with urllib.request.urlopen(urllib.request.Request(ENRON_TARBALL, headers={"User-Agent": USER_AGENT}),
                                    timeout=120) as response, partial.open("wb") as handle:
            while chunk := response.read(1 << 20):
                handle.write(chunk)
        partial.rename(tarball)
    prefix = f"maildir/{user}/"
    out = []
    parser = email.parser.BytesParser(policy=email.policy.compat32)
    log(f"Enron：读取 {prefix}")
    with tarfile.open(tarball, "r:gz") as archive:
        for member in archive:
            if not member.isfile() or not member.name.startswith(prefix):
                continue
            handle = archive.extractfile(member)
            if handle is None:
                continue
            message = parser.parse(handle)
            try:
                when = email.utils.parsedate_to_datetime(message["Date"]).astimezone(UTC)
            except (TypeError, ValueError):
                continue
            if not (lo <= when <= hi):
                continue
            parts = [p for p in message.walk() if not p.is_multipart() and p.get_content_type() == "text/plain"]
            chunks = []
            for part in parts or [message]:
                body = part.get_payload(decode=True) or b""
                charset = part.get_content_charset() or "latin-1"
                try:
                    chunks.append(body.decode(charset, "replace"))
                except LookupError:
                    chunks.append(body.decode("latin-1", "replace"))
            text = "\n".join(chunks)
            folder = member.name[len(prefix):].rsplit("/", 1)[0]
            out.append(record(
                f"en:{member.name[len('maildir/'):]}", "enron", message.get("From"), False, iso(when), text,
                None, message_id=message.get("Message-ID"), subject=message.get("Subject"), folder=folder,
                to=message.get("To"), cc=message.get("Cc"), x_from=message.get("X-From"), x_to=message.get("X-To"),
                x_folder=message.get("X-Folder")))
    out.sort(key=lambda r: r["at"])
    log(f"Enron：{len(out)} 封")
    return {"enron": out}


# ---------- 入口 ----------

def resolve_source(name: str) -> dict:
    if name in SOURCES:
        return SOURCES[name]
    if name.startswith("enron-"):
        return {**ENRON_DEFAULT, "enron_user": name[len("enron-"):]}
    raise SystemExit(f"未知来源：{name}。可用：{', '.join(SOURCES)}，或 enron-<邮箱目录名>")


def local_midnight(day: str, zone: ZoneInfo) -> dt.datetime:
    return dt.datetime.combine(dt.date.fromisoformat(day), dt.time(0), zone).astimezone(UTC)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("source", help="curl-bagder、composite 或 enron-<user>")
    parser.add_argument("--start", help="窗口起始日期（来源时区，含）")
    parser.add_argument("--end", help="窗口结束日期（来源时区，不含）")
    parser.add_argument("--followup-days", type=int, help="窗口后继续抓取的天数，用于弱标注")
    parser.add_argument("--only", help="只抓这些流，逗号分隔（github,lists,mastodon,blog,enron,forum,qa,newsletters,weather）")
    parser.add_argument("--out", help="输出目录，默认 corpus/<source>/raw")
    parser.add_argument("--delay", type=float, default=1.0, help="非 GitHub 请求之间的最少间隔秒数")
    parser.add_argument("--cache", default=str(ROOT / ".local" / "cache" / "enron"), help="Enron 压缩包缓存目录")
    args = parser.parse_args()

    config = resolve_source(args.source)
    zone = ZoneInfo(config["timezone"])
    start = args.start or config["window"][0]
    end = args.end or config["window"][1]
    followup = config["followup_days"] if args.followup_days is None else args.followup_days
    window = (local_midnight(start, zone), local_midnight(end, zone))
    lo = window[0] - dt.timedelta(days=1)
    hi = min(window[1] + dt.timedelta(days=followup), dt.datetime.now(UTC))
    streams = args.only.split(",") if args.only else list(config["streams"])
    out_dir = Path(args.out) if args.out else ROOT / "corpus" / args.source / "raw"
    out_dir.mkdir(parents=True, exist_ok=True)
    http = Http(args.delay)

    results: dict[str, list] = {}
    for stream in streams:
        if stream == "github":
            results.update(fetch_github(config, lo, hi, window))
        elif stream == "lists":
            results.update(fetch_lists(config, lo, hi, http))
        elif stream == "mastodon":
            results.update(fetch_mastodon(config, lo, hi, http))
        elif stream == "blog":
            results.update(fetch_blog(config, lo, hi, http))
        elif stream == "enron":
            results.update(fetch_enron(config["enron_user"], lo, hi, Path(args.cache), http))
        elif stream == "forum":
            results.update(fetch_forum(config, lo, hi, http))
        elif stream == "qa":
            results.update(fetch_stackexchange(config, lo, hi, window, http))
        elif stream == "newsletters":
            results.update(fetch_newsletters(config, lo, hi, http))
        elif stream == "weather":
            results.update(fetch_weather(config, lo, hi, http))
        else:
            raise SystemExit(f"未知流：{stream}")

    meta_path = out_dir / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {"streams": {}}
    for name, items in results.items():
        (out_dir / f"{name}.json").write_text(json.dumps(items, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        meta["streams"][name] = {"count": len(items), "fetched_at": iso(dt.datetime.now(UTC)),
                                 "redacted_phone_like": sum(i.get("redacted", 0) for i in items)}
        log(f"写入 {name}.json：{len(items)} 条")
    meta.update({"source": args.source, "description": config["description"], "timezone": config["timezone"],
                 "window": {"start": start, "end": end, "from": iso(window[0]), "to": iso(window[1])},
                 "fetch_range": {"from": iso(lo), "to": iso(hi)}, "followup_days": followup,
                 "self": config.get("self") or {"enron_user": config.get("enron_user")}})
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
