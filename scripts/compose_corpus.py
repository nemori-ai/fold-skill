"""把几个真实来源拼成一个化名人物的两周：corpus/composite/。

  工作流    curl-bagder 的全部输入，一致化名改写（项目、仓库、账号、人名、邮件列表、域名、编号）
  社区流    一个公开自然观察论坛（Discourse）：本人参与的话题、回复与提到本人的帖子、关注分类的全部帖子
  生活流    Stack Exchange 生活问答站：本人提出的问题收到的回答与评论（内容按 CC BY-SA 发布）
  订阅流    Substack 公开 newsletter、Enron 语料里的商业群发（整周平移）、由 SMHI 观测值生成的天气提醒（模板）
  家庭流    作者编写的原创文本（corpus/composite/family/beats.json），由 family 子命令追加，不来自任何真实的人

用法：
  python3 scripts/compose_corpus.py build              # 生成 frames.json 与 ids.json
  python3 scripts/compose_corpus.py labels             # 生成 labels.json（弱标注）
  python3 scripts/compose_corpus.py noise              # 生成 noise.json，并排打印 curl-bagder / composite / 手写情境
  python3 scripts/compose_corpus.py audit --sample 30  # 抽样打印改写后的输入，并扫描残留的真实名字
  python3 scripts/compose_corpus.py family             # 把家庭流追加进现有 frames.json，更新 ids/noise/labels

前置：curl-bagder 与 composite 的 raw/ 已由 fetch_corpus.py 抓好；Enron 压缩包已在 .local/cache/enron/。
化名表、随机盐与各流的挑选只存本机 .local/composite/mapping.json：首次运行自动生成，之后的人工修补也写在
那里，不入库。改写只用规则替换与人工修补，不用模型生成或改写文本。家庭流例外：它是作者写的原创文本，
不经过化名表，`family` 只需要现有的 frames.json 与入库的节拍表，`build` 重建前四条流后要再运行一次 `family`。
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import email.parser
import email.policy
import email.utils
import hashlib
import hmac
import json
import random
import re
import secrets
import sys
import tarfile
import unicodedata
import urllib.parse
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_corpus import (  # noqa: E402
    ROOT, TEXT_LIMIT, curl_events, finish_event, frame_bounds, load, local_iso, log, metric_table, metrics, parse_time,
    save,
)
from label_corpus import curl_actions, label_frames  # noqa: E402

UTC = dt.timezone.utc
BASE = ROOT / "corpus" / "composite"
MAPPING = ROOT / ".local" / "composite" / "mapping.json"
ZONE = ZoneInfo("Europe/Stockholm")
STREAMS = ("work", "community", "life", "subscription", "family")

# 化名词表：只用来生成新名字，不含任何真实名字与化名的对应。
ADJ = ("amber", "brisk", "calm", "dusky", "early", "fern", "gentle", "hazel", "ivory", "jolly", "keen", "lunar",
       "mellow", "noble", "olive", "pale", "quiet", "rapid", "silver", "tidal", "umber", "vivid", "windy", "young",
       "zesty", "bright", "coral", "dawn", "ember", "frost", "golden", "humble", "indigo", "jade", "kind", "lucky",
       "misty", "nimble", "opal", "plain", "rosy", "sandy", "teal", "urban", "velvet", "wild", "azure", "bold",
       "crisp", "dry", "eager", "fair", "grey", "hardy", "icy", "just", "lively", "merry", "north", "odd", "proud")
NOUN = ("otter", "birch", "comet", "delta", "egret", "finch", "gecko", "heron", "iris", "juniper", "kestrel", "lynx",
        "maple", "newt", "orca", "pine", "quail", "raven", "spruce", "thistle", "urchin", "vole", "wren", "yarrow",
        "aspen", "badger", "cedar", "dune", "elk", "fjord", "grouse", "harbor", "inlet", "jay", "kelp", "lichen",
        "moss", "nettle", "oak", "pebble", "reed", "sedge", "tern", "valley", "willow", "alder", "brook", "cliff",
        "drift", "ember", "flint", "glade", "heath", "isle", "knoll", "lark", "marsh", "nook", "orchid", "plover")
FIRST = ("Alva", "Bruno", "Cecilia", "Dario", "Edith", "Felix", "Greta", "Hugo", "Ines", "Joel", "Klara", "Linus",
         "Maja", "Nils", "Olga", "Pavel", "Rosa", "Sami", "Tilda", "Ugo", "Vera", "Wilma", "Yusuf", "Zora", "Aron",
         "Britt", "Casper", "Dagny", "Emil", "Frida", "Gustav", "Hedda", "Ivar", "Jonna", "Kasper", "Lova", "Mirek",
         "Nadia", "Oskar", "Petra", "Ruben", "Saga", "Tobias", "Ulla", "Viggo", "Agnes", "Bertil", "Corinna", "Dmitri",
         "Elin", "Fabio", "Gerda", "Hjalmar", "Ilse", "Jarl", "Kerstin", "Leif", "Marit", "Noor", "Otto", "Pia",
         "Rune", "Signe", "Teodor", "Ylva", "Arvid", "Bodil", "Cyrus", "Doris", "Einar", "Fanny", "Gilbert", "Hanna",
         "Ingmar", "Josefin", "Konrad", "Liv", "Mats", "Nora", "Osvald", "Pernilla", "Rasmus", "Selma", "Tage")
LAST = ("Alder", "Bergqvist", "Castellan", "Dahlgren", "Ekman", "Falk", "Granqvist", "Holmer", "Isaksen", "Jansky",
        "Kovacs", "Lindqvist", "Moreau", "Nyberg", "Oduya", "Petrov", "Quist", "Rasku", "Sandell", "Tamm",
        "Ulvaeus", "Varga", "Wikström", "Yilmaz", "Zeller", "Ahlberg", "Brandt", "Corvino", "Dufva", "Engel",
        "Forsell", "Gauthier", "Hedlund", "Ilves", "Juhl", "Kaskinen", "Lomholt", "Mazur", "Nordahl", "Ortega",
        "Palm", "Rydberg", "Strand", "Toivonen", "Ulfsdotter", "Vesterlund", "Wahl", "Åberg", "Östlund", "Berglöf",
        "Cederholm", "Dorsch", "Elfving", "Frisk", "Grahn", "Hallin", "Ivarsson", "Karlén", "Lundmark", "Moberg")
PUB_WORDS = ("Ledger", "Dispatch", "Notes", "Almanac", "Bulletin", "Letter", "Digest", "Gazette", "Journal", "Post")
KEEP_HANDLES = {"github", "web-flow", "ghost", "actions", "copilot", "github-actions","github-actions[bot]", "copilot-pull-request-reviewer[bot]", "Copilot",
                "dependabot[bot]", "renovate[bot]", "codeql", "github-advanced-security[bot]", "system", "discobot"}
URL_RE = re.compile(r"https?://[^\s<>\"'`()\[\]{}|\\^]+")
EMAIL_RE = re.compile(r"(?<![\w.@/+-])([\w.+-]+)@([\w-]+(?:\.[\w-]+)+)")
MASTO_RE = re.compile(r"(?<![\w/])@([\w.]{1,30})@([\w-]+(?:\.[\w-]+)+)")
MENTION_RE = re.compile(r"(?<![\w@/.`-])@([A-Za-z0-9][\w-]{0,38})")
CVE_RE = re.compile(r"CVE-(\d{4})-(\d{4,7})")
ISSUE_RE = re.compile(r"(?<![\w/&#])#(\d{5})\b")
SHA_RE = re.compile(r"(?<![\w/-])([0-9a-f]{7,40})(?![\w-])")
DOMAIN_RE = re.compile(r"(?<![\w@/.-])(?:[a-z0-9-]+\.)+(?:se|com|org|net|dev|io|nu)(?![\w-])", re.I)
PERSONAL_MAIL = {"gmail.com", "googlemail.com", "hotmail.com", "outlook.com", "live.com", "yahoo.com", "icloud.com",
                 "me.com", "gmx.de", "gmx.net", "web.de", "protonmail.com", "proton.me", "fastmail.com", "posteo.de",
                 "mailbox.org", "aol.com", "msn.com", "mail.com", "hey.com", "pm.me", "tutanota.com", "yandex.ru"}
NAME_WORD = re.compile(r"[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ'’-]{2,}")
ROLE_LOCAL = re.compile(r"(info|deals?|news|newsletters?|support|help|noreply|no-reply|donotreply|service|"
                        r"customerservice|specials|offers|mail|email|webmaster|postmaster|abuse|security|"
                        r"announce|listmaster|admin|sales|contact|feedback|privacy|unsubscribe)[\w.-]*", re.I)
MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December")


def hx(salt: str, value: str, n: int = 16) -> str:
    return hmac.new(salt.encode(), value.encode(), hashlib.sha1).hexdigest()[:n]


def case_like(source: str, target: str) -> str:
    if source.isupper() and len(source) > 1:
        return target.upper()
    if source[:1].isupper():
        return target[:1].upper() + target[1:]
    return target.lower()


def load_words() -> tuple[set[str], set[str]]:
    """系统词典（macOS 与多数 Linux 自带）：判断一个大写词是不是普通英文词、是不是常见人名。缺失时返回空集。"""
    words, names = set(), set()
    for path, target in ((Path("/usr/share/dict/words"), words), (Path("/usr/share/dict/propernames"), names)):
        if path.exists():
            for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
                line = line.strip()
                if line:
                    target.add(line if target is names else line.lower())
    return {w for w in words}, names


# ---------- 化名表 ----------

class Rewriter:
    """一张稳定的化名表：同一个真实账号、名字、编号在所有流里都换成同一个化名。"""

    def __init__(self, mapping: dict):
        self.m = mapping
        self.salt = mapping["salt"]
        for key in ("handles", "people", "first_names", "last_names", "publications"):
            mapping.setdefault(key, {})
        self.words, self.propernames = load_words()
        self.used = set(mapping["handles"].values()) | set(mapping["people"].values())
        self._compiled = None
        self.discovered = collections.Counter()
        self.issues: set[int] = set()  # 只在改写工作流时填入：项目仓库已知的 issue/PR 编号，正文里裸写的也平移

    # 生成
    def _pick(self, pool: tuple, key: str, salt_tag: str) -> str:
        """名与姓可以多对一（不同的人可能同名），只要同一个真实名字总是换成同一个化名。"""
        return random.Random(hx(self.salt, salt_tag + key, 16)).choice(pool)

    def initial(self, real: str) -> str:
        letter = "ABCDEFGHIJKLMNOPRSTVW"[int(hx(self.salt, "i:" + real, 8), 16) % 21]
        return letter + ("." if real.endswith(".") else "")

    def handle(self, real: str | None) -> str | None:
        if not real or real in KEEP_HANDLES or real.endswith("[bot]"):
            return real
        key = real.lower()
        if key == self.m["persona"]["real"]["github"].lower():
            return self.m["persona"]["github"]
        if key not in self.m["handles"]:
            rng = random.Random(hx(self.salt, "h:" + key, 16))
            for _ in range(500):
                adj, noun = rng.choice(ADJ), rng.choice(NOUN)
                style = rng.randrange(4)
                candidate = [f"{adj}{noun}", f"{adj}-{noun}", f"{noun}{rng.randint(2, 99)}", f"{adj}_{noun}"][style]
                if real.endswith("[bot]"):
                    candidate += "[bot]"
                if candidate not in self.used:
                    break
            self.m["handles"][key] = candidate
            self.used.add(candidate)
            self._compiled = None
        return self.m["handles"][key]

    def first(self, real: str) -> str:
        if not NAME_WORD.fullmatch(real):
            return self.initial(real)
        if real not in self.m["first_names"]:
            self.m["first_names"][real] = self._pick(FIRST, real, "f:")
            self._compiled = None
        return self.m["first_names"][real]

    def last(self, real: str) -> str:
        if not NAME_WORD.fullmatch(real):
            return self.initial(real)
        if real not in self.m["last_names"]:
            self.m["last_names"][real] = self._pick(LAST, real, "l:")
            self._compiled = None
        return self.m["last_names"][real]

    def person(self, real: str | None) -> str | None:
        """真实全名或显示名 → 化名；像账号的显示名（无空格、含数字）当作账号处理。"""
        if not real:
            return real
        real = real.strip()
        persona = self.m["persona"]
        if real in persona["real"]["names"]:
            return persona["name"]
        if real in self.m["people"]:
            return self.m["people"][real]
        parts = real.split()
        if len(parts) >= 2 and all(re.fullmatch(r"[A-ZÀ-ÖØ-Þ][\w'’.-]*", p) for p in parts[:2]):
            pseudo = f"{self.first(parts[0])} {self.last(parts[-1])}"
            if len(parts) > 2:
                for middle in parts[1:-1]:
                    self.first(middle)
        elif len(parts) == 1 and re.fullmatch(r"[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ]+", real):
            pseudo = self.first(real)
        else:
            pseudo = self.handle(real.replace(" ", "")) or real
        self.m["people"][real] = pseudo
        self._compiled = None
        return pseudo

    def number(self, tag: str, value: str | int) -> str:
        text = str(value)
        digits = int(hx(self.salt, f"n:{tag}:{text}", 15), 16)
        out = str(digits % (9 * 10 ** (len(text) - 1)) + 10 ** (len(text) - 1)) if len(text) > 1 else text
        return out

    @staticmethod
    def issue(n: int) -> int:
        """项目仓库的 issue/PR 编号：整体平移，保持先后与引用关系。"""
        return n - 9000 if n >= 10000 else n + 21000

    # 文本
    def _patterns(self):
        if self._compiled is not None:
            return self._compiled
        m = self.m
        names = {}
        for real, pseudo in m["people"].items():
            if (" " in real or real in m["first_names"]) and len(real) >= 3 and re.search(r"[A-Za-z]{2}", real):
                names[real] = pseudo
        for real, pseudo in m["first_names"].items():
            if real.lower() not in self.words or real in m.get("force_names", []):
                names.setdefault(real, pseudo)
        for real, pseudo in m["last_names"].items():
            if real.lower() not in self.words:
                names.setdefault(real, pseudo)
        for real in m["persona"]["real"]["names"]:
            names[real] = m["persona"]["name"]
            first, *_, last = real.split()
            names[first] = m["persona"]["first"]
            names[last] = m["persona"]["last"]
        names.update(m.get("replace", {}))
        bare = {}
        for real, pseudo in m["handles"].items():
            if len(real) >= 5 and real not in self.words and not real.endswith("[bot]"):
                bare[real] = pseudo
        bare[m["persona"]["real"]["github"].lower()] = m["persona"]["github"]
        for real, pseudo in m["publications"].items():
            names[real] = pseudo
        self._compiled = {
            "names": self._alternation(names, flags=0),
            "handles": self._alternation(bare, flags=re.I),
            "tokens": [(re.compile(rule["pattern"], re.I if rule.get("ignore_case", True) else 0), rule["to"],
                        rule.get("exact", False)) for rule in m["tokens"]],
        }
        return self._compiled

    @staticmethod
    def _alternation(table: dict, flags: int):
        if not table:
            return None, table
        keys = sorted(table, key=len, reverse=True)
        pattern = re.compile(r"(?<![\w/.-])(" + "|".join(re.escape(k) for k in keys) + r")(?![\w-])", flags)
        lookup = {k.lower(): v for k, v in table.items()} if flags & re.I else table
        return pattern, lookup

    def tokens(self, text: str) -> str:
        for pattern, target, exact in self._patterns()["tokens"]:
            text = pattern.sub(lambda m, t=target, x=exact: t if x else case_like(m.group(0), t), text)
        return text

    def domains_in_text(self, text: str) -> str:
        return DOMAIN_RE.sub(lambda m: self.host(m.group(0)) if self.host(m.group(0)) != m.group(0).lower()
                             else m.group(0), text)

    def known(self, value: str, min_len: int = 5, strict: bool = True) -> bool:
        """是不是语料里出现过的个人账号（够长、不是普通英文词），才在路径与主机名里替换。"""
        key = value.lower()
        if key == self.m["persona"]["real"]["github"].lower():
            return True
        return (len(key) >= min_len and key in self.m.get("participants", {}) and not (strict and key in self.words)
                and key not in KEEP_HANDLES)

    def host(self, host: str) -> str:
        host = host.lower()
        mapped = self.m["domains"].get(host)
        if mapped:
            return mapped
        for real, pseudo in sorted(self.m["domains"].items(), key=lambda kv: -len(kv[0])):
            if host.endswith("." + real):
                prefix = [re.sub(r"[^a-z0-9-]", "-", self.handle(label)) if self.known(label) else label
                          for label in host[: -len(real) - 1].split(".")]
                return ".".join(prefix + [pseudo])
        labels = host.split(".")
        renamed = [re.sub(r"[^a-z0-9-]", "-", self.handle(label)) if i < len(labels) - 1 and self.known(label)
                   else label for i, label in enumerate(labels)]
        rewritten = self.tokens(".".join(renamed))
        if rewritten != host:
            labels = rewritten.split(".")
            return ".".join(labels[:-1] + ["example"])
        return host

    def url(self, url: str) -> str:
        trail = ""
        while url and url[-1] in ".,;:!?*_":
            trail = url[-1] + trail
            url = url[:-1]
        match = re.match(r"(https?://)([^/?#]+)([^?#]*)(\?[^#]*)?(#.*)?$", url)
        if not match:
            return url + trail
        scheme, host, path, query, frag = match.groups()
        lower = host.lower()
        segs = path.split("/")
        persona = self.m["persona"]
        project_orgs = {o.lower() for o in self.m.get("project_orgs", [])}
        if lower in ("github.com", "www.github.com", "api.github.com", "redirect.github.com", "gist.github.com"):
            if len(segs) > 1 and segs[1]:
                owner = segs[1]
                project = owner.lower() in project_orgs
                if lower == "redirect.github.com" and len(segs) == 2:
                    self.m.setdefault("participants", {})[owner.lower()] = 1  # 依赖更新说明里致谢的上游贡献者
                owner_new = (self.tokens(owner) if project else self.handle(owner) if self.known(owner, 2, strict=False)
                             else owner)
                if len(segs) > 2 and segs[2]:
                    segs[2] = self.tokens(segs[2])
                if len(segs) > 4 and segs[3] in ("issues", "pull", "discussions") and segs[4].isdigit() and project:
                    segs[4] = str(self.issue(int(segs[4])))
                elif len(segs) > 4 and segs[3] in ("commit", "commits"):
                    segs[4] = self.sha(segs[4])
                elif len(segs) > 5 and segs[3] == "actions" and segs[4] in ("runs", "jobs") and segs[5].isdigit():
                    segs[5] = self.number("id", segs[5])
                    if len(segs) > 7 and segs[6] == "job" and segs[7].isdigit():
                        segs[7] = self.number("id", segs[7])
                elif len(segs) > 4 and segs[3] in ("tree", "blob", "compare"):
                    segs[4] = self.text(segs[4], urls=False)
                segs[1] = owner_new or owner
            path = self.tokens("/".join(segs))
        elif lower in self.m.get("mastodon_hosts", []) or re.match(r"^/@[\w.]+", path or ""):
            path = re.sub(r"/@([\w.]+)(@[\w.-]+)?", lambda m: "/@" + self.handle(m.group(1))
                          + (("@" + self.host(m.group(2)[1:])) if m.group(2) else ""), path)
            path = re.sub(r"/(\d{15,20})", lambda m: "/" + self.number("id", m.group(1)), path)
            host = self.host(host)
        elif lower.endswith("hackerone.com"):
            path = re.sub(r"/(\d+)", lambda m: "/" + self.number("h1", m.group(1)), path)
        elif lower.endswith("stackexchange.com") or lower.endswith("stackoverflow.com"):
            path = re.sub(r"/(q|a|questions|answers|users|posts)/(\d+)",
                          lambda m: f"/{m.group(1)}/{self.number('se', m.group(2))}", path)
            path = re.sub(r"(/users/\d+/)([^/?#]+)", lambda m: m.group(1) + self.handle(m.group(2)), path)
        elif any(lower == h or lower.endswith("." + h) for h in self.m.get("community_hosts", [])):
            path = re.sub(r"/t/([^/]+)/(\d+)", lambda m: f"/t/{m.group(1)}/{self.number('forum-t', m.group(2))}", path)
            path = re.sub(r"/t/(\d+)", lambda m: f"/t/{self.number('forum-t', m.group(1))}", path)
            path = re.sub(r"/(u|people|journal|users|calendar)/([\w.-]+)",
                          lambda m: f"/{m.group(1)}/" + (self.number("obs", m.group(2)) if m.group(2).isdigit()
                                                         else self.handle(m.group(2))), path)
            path = re.sub(r"/observations/(\d+)", lambda m: "/observations/" + self.number("obs", m.group(1)), path)
            path = self.tokens(path)
            host = self.host(host)
        else:
            path = self.tokens(path)
            path = re.sub(r"/~([\w.-]+)", lambda m: "/~" + self.handle(m.group(1)), path)
            path = "/".join(self.handle(seg) if self.known(seg) else seg for seg in path.split("/"))
            host = self.host(host)
        query = self._query(query) if query else ""
        if frag:  # 评论、评审、讨论回复与博客评论的锚点：与这些输入的化名 ID 用同一映射
            frag = re.sub(r"^#(issuecomment-|pullrequestreview-|discussioncomment-|discussion_r|event-|comment-)(\d{5,})$",
                          lambda m: "#" + m.group(1) + self.number("id", m.group(2)), frag)
        return f"{scheme}{host}{path}{query}{frag or ''}{trail}"

    def _query(self, query: str) -> str:
        query = EMAIL_RE.sub(lambda m: self.email(m.group(1), m.group(2)), query)
        query = re.sub(r"%40", "@", query)
        query = EMAIL_RE.sub(lambda m: self.email(m.group(1), m.group(2)), query)
        query = re.sub(r"\bpr=(\d{5})\b", lambda m: f"pr={self.issue(int(m.group(1)))}", query)
        query = self.encoded_issues(query)
        query = re.sub(r"\b(u|user|user_id|ident_user_id|not_user_id|login|username)=([\w.-]+)",
                       lambda m: f"{m.group(1)}=" + (self.handle(m.group(2)) if self.known(m.group(2), 3, strict=False)
                                                    else m.group(2)), query)
        return self.tokens(query)

    def encoded_issues(self, text: str) -> str:
        """百分号编码的项目链接（如新建 issue 的预填正文里的 <org>%2F<repo>%2Fpull%2FN）里的编号也平移。"""
        orgs = "|".join(re.escape(o) for o in self.m.get("project_orgs", []))
        if not orgs:
            return text
        return re.sub(rf"(?i)((?:{orgs})%2F[\w.-]+%2F(?:pull|issues|discussions)%2F)(\d{{4,5}})(?!\d)",
                      lambda m: m.group(1) + str(self.issue(int(m.group(2)))), text)

    def sha(self, value: str) -> str:
        """按前 7 位映射，长短不同的同一个提交缩写换成同一个化名的前缀。"""
        if not re.fullmatch(r"[0-9a-f]{7,40}", value):
            return value
        return hx(self.salt, "sha:" + value[:7], 40)[: len(value)]

    def email(self, local: str, domain: str) -> str:
        persona = self.m["persona"]
        address = f"{local}@{domain}".lower()
        if address in [a.lower() for a in persona["real"].get("emails", [])]:
            return persona["email"]
        mapped = self.host(domain)
        personal_domain = domain.lower() in PERSONAL_MAIL or domain.lower().endswith(".enron.com") \
            or domain.lower() == "enron.com"
        personal_local = local.lower() in self.m.get("participants", {}) or "." in local or \
            (personal_domain and not ROLE_LOCAL.fullmatch(local))
        if ROLE_LOCAL.fullmatch(local) or not personal_local:
            return f"{self.tokens(local)}@{mapped}"
        return f"{self.handle(local) or local}@{mapped if mapped != domain.lower() else 'mail.example'}"

    def text(self, text: str | None, urls: bool = True) -> str | None:
        if not text:
            return text
        saved: list[str] = []

        def keep(value: str) -> str:
            saved.append(value)
            return f"\x00{len(saved) - 1}\x00"

        if urls:
            text = URL_RE.sub(lambda m: keep(self.url(m.group(0))), text)
        text = MASTO_RE.sub(lambda m: keep("@" + self.handle(m.group(1)) + "@" + self.host(m.group(2))), text)
        text = EMAIL_RE.sub(lambda m: keep(self.email(m.group(1), m.group(2))), text)
        known = self.m.get("participants", {})
        text = MENTION_RE.sub(lambda m: keep("@" + self.handle(m.group(1))) if m.group(1).lower() in known
                              or m.group(1).lower() == self.m["persona"]["real"]["github"].lower() else m.group(0),
                              text)
        text = re.sub(r'\[quote="([^",]+)', lambda m: keep('[quote="' + (self.handle(m.group(1)) or m.group(1))),
                      text)
        # Discourse 引用头里的话题号（topic:N）与链接里的话题号同一映射。
        text = re.sub(r"(?<=, )topic:(\d+)", lambda m: keep("topic:" + self.number("forum-t", m.group(1))), text)
        text = re.sub(r"(?<=\()/u/([\w.-]+)", lambda m: keep("/u/" + self.handle(m.group(1))), text)
        text = re.sub(r"@&#8203;([\w-]+)", lambda m: keep("@&#8203;" + self.handle(m.group(1))), text)
        pattern, lookup = self._patterns()["handles"]
        if pattern:
            text = pattern.sub(lambda m: keep(lookup.get(m.group(1).lower(), m.group(1))), text)
        pattern, lookup = self._patterns()["names"]
        if pattern:
            text = pattern.sub(lambda m: keep(lookup.get(m.group(1), m.group(1))), text)
        orgs = {o.lower() for o in self.m.get("project_orgs", [])}
        text = re.sub(r"(?<![\w.-])([\w.-]+)/([\w.-]+)#(\d{4,5})\b", lambda m: keep(
            self.tokens(f"{m.group(1)}/{m.group(2)}") + "#" + str(self.issue(int(m.group(3)))))
            if m.group(1).lower() in orgs else m.group(0), text)
        text = self.encoded_issues(text)
        if self.issues:  # 裸写的编号（refs/pull/N/head、issue-N、“在 N 里”），只换已知的项目编号
            text = re.sub(r"(?:(?<=%2F)|(?<![0-9A-Za-z]))(\d{5})(?![0-9A-Za-z])", lambda m: keep(
                str(self.issue(int(m.group(1))))) if int(m.group(1)) in self.issues else m.group(0), text)
        text = CVE_RE.sub(lambda m: f"CVE-{m.group(1)}-{self.number('cve', m.group(2))}", text)
        text = ISSUE_RE.sub(lambda m: "#" + str(self.issue(int(m.group(1)))) if 10000 <= int(m.group(1)) < 40000
                            else m.group(0), text)
        text = SHA_RE.sub(lambda m: self.sha(m.group(1)) if re.search(r"\d", m.group(1))
                          and re.search(r"[a-f]", m.group(1)) else m.group(0), text)
        text = self.domains_in_text(text)
        text = self.tokens(text)
        return re.sub(r"\x00(\d+)\x00", lambda m: saved[int(m.group(1))], text)

    def ref(self, value: str | None) -> str | None:
        """事件与线程 ID：项目名换成化名，项目编号平移，其他长数字换成等长的稳定化名。"""
        if not value:
            return value
        value = self.tokens(value)
        value = re.sub(r"#(\d+)", lambda m: "#" + str(self.issue(int(m.group(1)))), value)
        value = re.sub(r"(?<![\d])(\d{6,})", lambda m: self.number("id", m.group(1)), value)
        value = re.sub(r"^blog:(\d{1,5})$", lambda m: "blog:" + self.number("id", m.group(1)), value)
        value = re.sub(r"@([\w./-]+)$", lambda m: "@" + self.text(m.group(1), urls=False), value)
        return value

    def discover_names(self, texts: list[str]) -> None:
        """在文本里找常见人名（系统人名表里、又不是普通英文词的大写词），以及其后的姓。"""
        for text in texts:
            for match in re.finditer(r"\b([A-Z][a-z]{2,})(?:\s+([A-Z][a-z]{2,}))?\b", text or ""):
                first, last = match.group(1), match.group(2)
                if first in self.propernames and first.lower() not in self.words:
                    self.discovered[first] += 1
                    self.first(first)
                    if last and last.lower() not in self.words and last not in self.propernames:
                        self.last(last)


# ---------- 映射文件 ----------

def init_mapping() -> dict:
    """第一次运行时生成：随机盐、人物化名、项目化名，以及需要人工确认的挑选。"""
    sys.path.insert(0, str(ROOT / "scripts"))
    import fetch_corpus  # noqa: PLC0415

    curl = fetch_corpus.SOURCES["curl-bagder"]
    meta = load(ROOT / "corpus" / "curl-bagder" / "raw" / "meta.json")
    salt = secrets.token_hex(16)
    rng = random.Random(salt)
    project = rng.choice(("tolk", "skarv", "vrål", "lodda", "kvast", "flinga")).replace("å", "a")
    company = rng.choice(("Kvarnen", "Stensätt", "Lindbo", "Fyrväg"))
    first, last = rng.choice(FIRST), rng.choice(LAST)
    plain = unicodedata.normalize("NFKD", last).encode("ascii", "ignore").decode().lower()
    org = curl["github_repos"][0].split("/")[0]
    host = curl["blog"].split("/")[2]
    return {
        "salt": salt,
        "note": "本文件只在本机：真实名字与化名的对应、各流的挑选。不要提交。",
        "persona": {
            "name": f"{first} {last}", "first": first, "last": last,
            "github": (first[0].lower() + plain), "mastodon": (first.lower() + plain[0]),
            "email": f"{first.lower()}@{plain}.example", "forum": (first.lower() + plain[:2]),
            "qa": f"{first} {last[0]}.", "blog_host": f"{plain}.example",
            "real": {"github": meta["self"]["github"], "names": meta["self"].get("names", []),
                     "mastodon_id": meta["self"].get("mastodon_id"), "emails": []},
        },
        "project": project, "company": company,
        "project_orgs": [org],
        "tokens": [
            {"pattern": rf"{re.escape(org)}(?!y|ed\b|ing\b|ie)", "to": project},
        ],
        "domains": {host: f"{plain}.example"},
        "mastodon_hosts": [curl["mastodon"].split("/")[2]],
        "keep_email_domains": [],
        "selection": {"forum_self": None, "forum_watch": ["Nature Talk"], "qa_questions": {},
                      "promo_window": None, "promo_shift_days": None},
    }


def load_mapping() -> dict:
    if not MAPPING.exists():
        MAPPING.parent.mkdir(parents=True, exist_ok=True)
        mapping = init_mapping()
        MAPPING.write_text(json.dumps(mapping, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        log(f"已生成 {MAPPING}：请补充 selection 与人工修补后再运行 build")
        raise SystemExit(1)
    return json.loads(MAPPING.read_text(encoding="utf-8"))


def store_mapping(mapping: dict) -> None:
    MAPPING.write_text(json.dumps(mapping, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def origin(rw: Rewriter, value: str) -> str:
    """原始记录 ID 的加盐摘要：持有本机盐的人可以逐条核对，公开清单不能反查原始记录。"""
    return hx(rw.salt, "origin:" + value, 16)


# ---------- 各流 ----------

def work_stream(rw: Rewriter) -> tuple[list[dict], dict]:
    base = ROOT / "corpus" / "curl-bagder" / "raw"
    meta = load(base / "meta.json")
    raw = {p.stem: load(p) for p in base.glob("*.json") if p.stem != "meta"}
    participants = rw.m.setdefault("participants", {})
    for t in raw.get("github-threads", []):
        participants[(t.get("author") or "").lower()] = 1
    for key in ("github-comments", "github-reviews", "github-review-comments", "github-discussions",
                "github-timeline", "github-users"):
        for item in raw.get(key, []):
            if item.get("author"):
                participants[item["author"].lower()] = 1
    for s in raw.get("mastodon", []):
        participants[s["author"].split("@")[0].lower()] = 1
        for mention in s.get("mentions") or []:
            participants[mention.split("@")[0].lower()] = 1
    participants.pop("", None)
    for login in participants:
        rw.handle(login)
    for p in raw.get("lists", []) + raw.get("blog", []):
        rw.person(p.get("author"))
    events, _ = curl_events(raw, meta)
    rw.issues = {t["number"] for t in raw.get("github-threads", []) if t["number"] >= 10000}
    rw.issues |= {e["source_number"] for e in raw.get("github-timeline", []) if (e.get("source_number") or 0) >= 10000}
    rw.issues |= {pr for r in raw.get("github-runs", []) for pr in (r.get("pull_requests") or []) if isinstance(pr, int)}
    rw.discover_names([e.get("text") or "" for e in events] + [e.get("subject") or "" for e in events])
    out = []
    for e in events:
        channel = e["channel"]
        author = e["author"]
        if channel.startswith(("GitHub", "CI")):
            author = rw.handle(author)
        elif channel == "Mastodon":
            user, _, host = author.partition("@")
            author = rw.handle(user) + (("@" + rw.host(host)) if host else "")
        else:
            author = rw.person(author)
        new = {**e, "id": rw.ref(e["id"]), "author": author, "channel": rw.text(channel, urls=False),
               "text": rw.text(e.get("text")), "subject": rw.text(e.get("subject")), "thread": rw.ref(e.get("thread")),
               "url": rw.url(e["url"]) if e.get("url") else None, "reply_to": rw.ref(e.get("reply_to")),
               "workflow": rw.text(e.get("workflow")), "branch": rw.text(e.get("branch"), urls=False),
               "message_id": hx(rw.salt, "mid:" + e["message_id"], 20) + "@mail.example" if e.get("message_id")
               else None,
               "stream": "work", "origin": origin(rw, e["id"])}
        if channel == "Mastodon" and e.get("subject"):
            new["subject"] = rw.text(e["subject"])
        out.append(new)
    rw.issues = set()
    return out, meta


def forum_ids(rw: Rewriter, post: dict) -> tuple[str, str]:
    """论坛帖子的化名 ID 与所在话题的线程键。"""
    return (f"forum:{rw.number('forum-p', post['id'].split(':')[1])}",
            f"forum:t{rw.number('forum-t', post['topic_id'])}")


def qa_ids(rw: Rewriter, item: dict) -> tuple[str, str]:
    """问答条目（问题 q、回答 a、评论 c）的化名 ID 与所在问题的线程键。"""
    return (f"qa:{item['site']}:{item['kind'][0]}{rw.number('se', item['id'].split(':')[-1][1:])}",
            f"qa:{item['site']}:q{rw.number('se', item['question_id'])}")


def qa_time(item: dict, question: dict) -> dt.datetime:
    """夜里（斯德哥尔摩 0–7 点）提出的问题，整条线程按北美东部的钟面时间对齐：平移 −6 小时。"""
    at = parse_time(item["at"])
    if parse_time(question["at"]).astimezone(ZONE).hour < 7:
        at -= dt.timedelta(hours=6)
    return at


def forum_stream(rw: Rewriter, window: tuple[dt.datetime, dt.datetime]) -> list[dict]:
    posts = load(BASE / "raw" / "forum.json")
    sel = rw.m["selection"]
    me = sel.get("forum_self")
    if not me:
        me = pick_forum_self(posts, window)
        sel["forum_self"] = me
    participants = rw.m.setdefault("participants", {})
    for p in posts:
        participants[p["author"].lower()] = 1
        if p.get("reply_to_user"):
            participants[p["reply_to_user"].lower()] = 1
        if p.get("name") and p["name"] != p["author"]:
            rw.person(p["name"])
    rw.m["handles"][me.lower()] = rw.m["persona"]["forum"]
    rw._compiled = None
    watch = set(sel.get("forum_watch") or [])
    watch_first = set(sel.get("forum_watch_first") or [])
    in_window = [p for p in posts if window[0] <= parse_time(p["at"]) < window[1]]
    mine = [p for p in posts if p["author"] == me]
    joined: dict[int, dt.datetime] = {}
    for p in sorted(mine, key=lambda p: p["at"]):
        joined.setdefault(p["topic_id"], parse_time(p["at"]))
    by_topic_first = {p["topic_id"]: p for p in posts if p["post_number"] == 1}
    rw.discover_names([p["text"] for p in in_window])
    forum_name = rw.m.get("forum_name", "Forum")
    out = []
    for p in in_window:
        at = parse_time(p["at"])
        own = p["author"] == me
        addressed = p.get("reply_to_user") == me or re.search(rf"@{re.escape(me)}\b", p["text"] or "")
        watching = p.get("category") in watch or (p.get("category") in watch_first and p["post_number"] == 1)
        following = p["topic_id"] in joined and at >= joined[p["topic_id"]]
        created = by_topic_first.get(p["topic_id"], {}).get("author") == me
        if not (own or addressed or watching or following or created):
            continue
        kind = ("forum_post" if own else "forum_reply" if addressed else
                "forum_new_topic" if p["post_number"] == 1 else "forum_watch")
        author_kind = "self" if own else ("bot" if p["author"] in ("system", "discobot") else "human")
        post_id, thread = forum_ids(rw, p)
        title = rw.text(p.get("title"))
        out.append({
            "id": post_id, "channel": f"论坛 · {forum_name}",
            "kind": kind, "author": rw.handle(p["author"]), "author_kind": author_kind, "at": p["at"],
            "text": rw.text(p["text"]), "subject": f"[{forum_name}] [{rw.text(str(p.get('category')))}] {title}",
            "thread": thread, "url": rw.url(p["url"]),
            "reply_to": None, "edited": p.get("edited"), "stream": "community", "origin": origin(rw, p["id"]),
            "post_number": p["post_number"]})
    return out


def pick_forum_self(posts: list[dict], window: tuple[dt.datetime, dt.datetime]) -> str:
    """窗口内发帖 15–70 条、九成在欧洲白天（UTC 05–20 点）、关注分类里发帖最多的用户。"""
    by = collections.defaultdict(list)
    for p in posts:
        if window[0] <= parse_time(p["at"]) < window[1]:
            by[p["author"]].append(p)
    best = None
    for user, items in by.items():
        if not 15 <= len(items) <= 70:
            continue
        day = sum(1 for p in items if 5 <= parse_time(p["at"]).hour <= 20) / len(items)
        nature = sum(1 for p in items if p.get("category") == "Nature Talk")
        if day >= 0.9 and (best is None or nature > best[0]):
            best = (nature, user)
    if not best:
        raise SystemExit("论坛里没有符合条件的本人候选")
    return best[1]


QA_LABELS = {"diy": "Home Improvement", "parenting": "Parenting", "money": "Personal Finance & Money",
             "cooking": "Seasoned Advice", "travel": "Travel", "bicycles": "Bicycles", "pets": "Pets",
             "gardening": "Gardening & Landscaping"}


def qa_stream(rw: Rewriter, window: tuple[dt.datetime, dt.datetime]) -> list[dict]:
    items = load(BASE / "raw" / "qa.json")
    chosen = rw.m["selection"].get("qa_questions") or {}
    keys = {(site, int(q)) for site, ids in chosen.items() for q in ids}
    questions = {(r["site"], r["question_id"]): r for r in items if r["kind"] == "question"}
    askers = {key: questions[key].get("user_id") for key in keys if key in questions}
    # 34 个问题来自 34 位提问者：只在各自的问题下把提问者换成本人。在别的问题下出现时，他们和其他人一样用普通化名。
    asker_mention = {key: re.sub(r"\s+", "", questions[key].get("author") or "") for key in askers}
    self_mention = "@" + re.sub(r"\s+", "", rw.m["persona"]["qa"])
    # Stack Exchange 的评论用 @显示名（去空格）提到别人：让提到的名字与作者栏的化名一致。
    for r in items:
        if r.get("author") and (r["site"], r["question_id"]) in keys:
            mention = re.sub(r"\s+", "", r["author"]).lower()
            rw.m.setdefault("participants", {})[mention] = 1
            rw.m["handles"][mention] = re.sub(r"\s+", "", rw.person(r["author"]) or mention)
    rw._compiled = None
    out = []
    for r in items:
        key = (r["site"], r["question_id"])
        if key not in keys:
            continue
        at = qa_time(r, questions[key])
        if not window[0] <= at < window[1]:
            continue
        own = r.get("user_id") is not None and r.get("user_id") == askers.get(key)
        author = rw.m["persona"]["qa"] if own else rw.person(r.get("author") or "anonymous")
        site_label = QA_LABELS.get(r["site"], r["site"])
        title = rw.text(r.get("title"))
        verb = {"question": "", "answer": "New answer: ", "comment": "New comment: "}[r["kind"]]
        text = r["text"]
        if asker_mention.get(key):
            text = re.sub(rf"(?i)@{re.escape(asker_mention[key])}(?![\w])", self_mention, text)
        item_id, thread = qa_ids(rw, r)
        out.append({
            "id": item_id,
            "channel": f"问答 · {site_label}", "kind": f"qa_{r['kind']}", "author": author,
            "author_kind": "self" if own else "human", "at": at.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "text": rw.text(text), "subject": f"{verb}{title}", "thread": thread,
            "url": rw.url(r["url"]) if r.get("url") else None,
            "edited": r.get("edited"), "stream": "life", "origin": origin(rw, r["id"])})
    return out


def newsletter_stream(rw: Rewriter, window: tuple[dt.datetime, dt.datetime]) -> list[dict]:
    items = load(BASE / "raw" / "newsletters.json")
    pubs = rw.m["publications"]
    for r in items:
        if r["author"] not in pubs:
            rng = random.Random(hx(rw.salt, "pub:" + r["author"], 16))
            pubs[r["author"]] = f"The {rng.choice(ADJ).title()} {rng.choice(PUB_WORDS)}"
        if r.get("byline"):
            rw.person(r["byline"])
        slug = re.sub(r"[^a-z]+", "", pubs[r["author"]].lower().replace("the ", ""))
        for host in {r.get("host"), urllib.parse.urlsplit(r.get("url") or "").hostname}:
            if host:
                bare = host.removeprefix("www.")
                rw.m["domains"].setdefault(bare, f"{slug}.example")
                if bare.endswith(".substack.com"):
                    rw.m["domains"].setdefault(bare, f"{slug}.example")
    rw._compiled = None
    window_items = [r for r in items if window[0] <= parse_time(r["at"]) < window[1]]
    rw.discover_names([r["text"] for r in window_items])
    out = []
    for r in window_items:
        pub = pubs[r["author"]]
        out.append({
            "id": f"nl:{rw.number('nl', r['id'].split(':')[-1])}", "channel": "订阅邮件", "kind": "newsletter",
            "author": pub, "author_kind": "automation", "at": r["at"], "text": rw.text(r["text"]),
            "subject": rw.text(r.get("title")), "thread": f"nl:{rw.number('nl', r['id'].split(':')[-1])}",
            "url": rw.url(r["url"]) if r.get("url") else None, "stream": "subscription",
            "origin": origin(rw, r["id"]), "audience": r.get("audience")})
    return out


def weather_stream(rw: Rewriter, window: tuple[dt.datetime, dt.datetime]) -> list[dict]:
    """天气 App 式的提醒：每天 06:30 的当日概况，以及阵风或高温超过阈值时的提醒。数值来自 SMHI 观测（CC BY 4.0）。"""
    values = load(BASE / "raw" / "weather.json")
    days: dict[dt.date, dict[str, list]] = collections.defaultdict(lambda: collections.defaultdict(list))
    for v in values:
        at = parse_time(v["at"]).astimezone(ZONE)
        days[at.date()][str(v["parameter"])].append((at, float(v["text"])))
    out = []
    for day in sorted(days):
        start = dt.datetime.combine(day, dt.time(6, 30), ZONE)
        if not window[0] <= start < window[1]:
            continue
        temps = [x for _, x in days[day].get("1", [])]
        rain = sum(x for _, x in days[day].get("7", []))
        gusts = days[day].get("21", [])
        if not temps:
            continue
        top_gust = max(gusts, key=lambda g: g[1]) if gusts else None
        text = (f"Stockholm i dag: {min(temps):.0f}–{max(temps):.0f} °C, "
                f"{'uppehåll' if rain < 0.5 else f'{rain:.1f} mm nederbörd'}"
                + (f", byvind upp till {top_gust[1]:.0f} m/s" if top_gust else "") + ".")
        out.append({"id": f"wx:{day:%Y%m%d}:daily", "channel": "天气", "kind": "weather_daily", "author": "SMHI-väder",
                    "author_kind": "automation", "at": start.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "text": text, "subject": "Dagens väder", "thread": f"wx:{day:%Y%m%d}", "url": None,
                    "text_origin": "template", "stream": "subscription", "origin": origin(rw, f"wx:{day}")})
        hot = [(at, x) for at, x in days[day].get("1", []) if x >= 26]
        if hot:
            at, x = hot[0]
            out.append({"id": f"wx:{day:%Y%m%d}:heat", "channel": "天气", "kind": "weather_alert",
                        "author": "SMHI-väder", "author_kind": "automation",
                        "at": at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
                        "text": f"Höga temperaturer: {x:.1f} °C uppmätt i Stockholm kl {at:%H}. Drick mycket vatten.",
                        "subject": "Värme", "thread": f"wx:{day:%Y%m%d}", "url": None, "text_origin": "template",
                        "stream": "subscription", "origin": origin(rw, f"wx:{day}:heat")})
        windy = [(at, x) for at, x in gusts if x >= 14]
        if windy:
            at, x = windy[0]
            out.append({"id": f"wx:{day:%Y%m%d}:wind", "channel": "天气", "kind": "weather_alert",
                        "author": "SMHI-väder", "author_kind": "automation",
                        "at": at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
                        "text": f"Hårda vindbyar: upp till {x:.0f} m/s söder om Stockholm kl {at:%H}.",
                        "subject": "Blåsigt", "thread": f"wx:{day:%Y%m%d}", "url": None, "text_origin": "template",
                        "stream": "subscription", "origin": origin(rw, f"wx:{day}:wind")})
    return out


PROMO_SENDER = re.compile(r"@([\w-]+\.)*(amazon|travelocity|expedia|ebay|continental|southwest|delta|priceline|"
                          r"orbitz|cheaptickets|hotwire|lowestfare|cdnow|bn)\.(com|net)", re.I)
# 交易类邮件（订单、注册、出票、账户）含收件人的姓名、住址与账号，不用；只留营销群发。
GENERIC_GREETING = re.compile(r"(?i)valued|customer|customers|member|members|friend|friends|traveler|travelers|"
                              r"shopper|subscriber|sir|madam|all|there|everyone|guest|reader|fan|fans")
TRANSACTIONAL = re.compile(r"\b(order|orders|confirm\w*|registration|printed|password|account|receipt|itinerary|"
                           r"reservation)\b", re.I)


def owner_names(x_to: str) -> list[str]:
    """X-To 里的收件人姓名；Lotus Notes 的“姓, 名”改成“名 姓”。"""
    value = re.sub(r"<[^>]*>", "", x_to or "").replace('"', "").strip()
    parts = [p.strip() for p in value.split(",") if p.strip()]
    if len(parts) == 2 and len(parts[0].split()) == 1 and 1 <= len(parts[1].split()) <= 2:
        parts = [f"{parts[1]} {parts[0]}"]
    return [p for p in parts if re.search(r"[A-Za-z]{2}", p) and "@" not in p
            and not any(GENERIC_GREETING.fullmatch(word) for word in p.split())]


def promo_stream(rw: Rewriter, window: tuple[dt.datetime, dt.datetime]) -> list[dict]:
    """Enron 语料里的商业群发：源窗口内各邮箱收到的零售、航空与旅行营销邮件，同一期只留一封，整周平移到目标窗口。"""
    sel = rw.m["selection"]
    if not sel.get("promo_window"):
        return []
    start = dt.date.fromisoformat(sel["promo_window"])
    shift = dt.timedelta(days=sel["promo_shift_days"])
    cache = ROOT / ".local" / "composite" / "promo.json"
    if cache.exists():
        mails = load(cache)
    else:
        mails = read_promos(start)
        save(cache, mails)
    chicago = ZoneInfo("America/Chicago")
    persona = rw.m["persona"]
    issues: dict[tuple, dict] = {}
    for m in sorted(mails, key=lambda m: email.utils.parsedate_to_datetime(m["date"])):
        if TRANSACTIONAL.search(m["subject"] or ""):
            continue
        names = owner_names(m.get("x_to") or "")
        subject = m["subject"] or ""
        addressed = re.search(r"\bFOR\s+([A-Za-z][A-Za-z .'-]+)$", subject, re.I)  # “… SPECIALS FOR 收件人”
        if addressed:
            names.append(addressed.group(1).strip())
            subject = subject[: addressed.start()]
        for name in names:
            subject = re.sub(re.escape(name), "", subject, flags=re.I)
        base = re.sub(r"[\d.]+|_\d+$", "", m["from"].lower().split("@")[0]) + "@" + m["from"].lower().split("@")[-1]
        key = (base, re.sub(r"\s+", " ", subject).strip().lower())
        if key not in issues:
            issues[key] = {**m, "names": names}
    out = []
    for m in issues.values():
        sent = email.utils.parsedate_to_datetime(m["date"]).astimezone(chicago)
        local = (sent.replace(tzinfo=None) + shift).replace(tzinfo=ZONE)
        if not window[0] <= local < window[1]:
            continue
        # 收件人换成本人：全名（含大小写变体）、名与姓分别对应。
        for name in m["names"]:
            parts = name.split()
            for variant in {name, name.lower(), name.title(), name.upper()}:
                rw.m["people"][variant] = persona["name"]
            if len(parts) >= 2:
                for variant in {parts[0], parts[0].title()}:
                    rw.m.setdefault("replace", {})[variant] = persona["first"]
                for variant in {parts[-1], parts[-1].title()}:
                    rw.m.setdefault("replace", {})[variant] = persona["last"]
        for _, address in email.utils.getaddresses([m.get("to") or ""]):
            if address and address.lower() not in persona["real"]["emails"]:
                persona["real"]["emails"].append(address.lower())
        rw._compiled = None
        text = re.sub(r"\b\d{8,}\b", lambda d: rw.number("promo-digits", d.group(0)), rw.text(m["body"]))
        # 营销邮件的称呼（Dear MATHEW、Hello Mr Smith）换成本人；全大写的保持全大写。
        text = re.sub(r"\b(Dear|Hello|Hi|Greetings)(,?\s+)(Mr\.?\s+|Mrs\.?\s+|Ms\.?\s+)?([A-Z][A-Za-z'-]+)\b"
                      r"(?!\s+(?:Customer|Member|Traveler|Shopper|Subscriber|Fan|Flyer)s?\b)",
                      lambda g: g.group(0) if GENERIC_GREETING.fullmatch(g.group(4)) else
                      g.group(1) + g.group(2) + (g.group(3) or "") + case_like(
                          g.group(4), persona["last"] if g.group(3) else persona["first"]), text)
        text = URL_RE.sub(lambda u: mask_tokens(rw, u.group(0), 10), shift_dates(text, shift))
        subject = shift_dates(rw.text(m["subject"]), shift)
        sender = re.sub(r"\s*<[^>]+>", "", m["from"]).strip().strip('"') or m["from"]
        local_part, _, domain = sender.partition("@")
        sender = mask_tokens(rw, local_part, 6) + ("@" + domain if domain else "")
        out.append({"id": f"promo:{rw.number('promo', int(hx(rw.salt, m['message_id'], 12), 16))}",
                    "channel": "邮件", "kind": "promo_email", "author": sender, "author_kind": "automation",
                    "at": local.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"), "text": text, "subject": subject,
                    "thread": f"promo:{hx(rw.salt, sender + subject, 10)}", "url": None,
                    "stream": "subscription", "origin": origin(rw, m["message_id"])})
    return out


def mask_tokens(rw: Rewriter, value: str, min_len: int) -> str:
    """营销链接与退订地址里的跟踪串（字母数字混排）可能对应原收件人，换成等长的稳定化名。"""
    def swap(match):
        token = match.group(0)
        if not (re.search(r"\d", token) and re.search(r"[A-Za-z]", token)):
            return token
        return (hx(rw.salt, "tok:" + token, 40) + hx(rw.salt, "tok2:" + token, 40))[: len(token)]
    return re.sub(rf"(?<![A-Za-z0-9])[A-Za-z0-9]{{{min_len},64}}(?![A-Za-z0-9])", swap, value)


def read_promos(start: dt.date) -> list[dict]:
    """读出源窗口内所有邮箱收到的营销邮件（每份副本都留下，去重在 promo_stream 里做）。只在本机缓存。"""
    tarball = ROOT / ".local" / "cache" / "enron" / "enron_mail_20150507.tar.gz"
    lo = dt.datetime.combine(start, dt.time(0), ZoneInfo("America/Chicago"))
    hi = lo + dt.timedelta(days=14)
    parser = email.parser.BytesParser(policy=email.policy.compat32)
    out = []
    log(f"读取 Enron 商业群发（{start} 起两周）")
    with tarfile.open(tarball, "r:gz") as archive:
        for member in archive:
            if not member.isfile() or not member.name.startswith("maildir/"):
                continue
            folder = member.name.split("/", 2)[2].rsplit("/", 1)[0]
            if folder.startswith(("all_documents", "discussion_threads", "notes_inbox")):
                continue
            message = parser.parse(archive.extractfile(member))
            sender = str(message.get("From") or "")
            if not PROMO_SENDER.search(sender):
                continue
            try:
                when = email.utils.parsedate_to_datetime(str(message.get("Date")))
            except (TypeError, ValueError):
                continue
            if not lo <= when < hi:
                continue
            body = ""
            for part in [p for p in message.walk() if not p.is_multipart() and p.get_content_type() == "text/plain"] \
                    or [message]:
                payload = part.get_payload(decode=True) or b""
                try:
                    body += payload.decode(part.get_content_charset() or "latin-1", "replace")
                except LookupError:
                    body += payload.decode("latin-1", "replace")
            out.append({"message_id": str(message.get("Message-ID")), "date": str(message.get("Date")),
                        "from": sender, "subject": str(message.get("Subject") or ""), "body": body,
                        "x_to": str(message.get("X-To") or ""), "to": str(message.get("To") or "")})
    log(f"商业群发：{len(out)} 封副本")
    return out


def shift_dates(text: str | None, shift: dt.timedelta) -> str | None:
    """把源窗口的年份与月日平移到目标窗口（整周平移，星期几不变）。"""
    if not text:
        return text

    def month_day(match):
        month = MONTHS.index(match.group(1).capitalize()) + 1
        day, year = int(match.group(2)), int(match.group(3)) if match.group(3) else 2001
        try:
            moved = dt.date(year, month, day) + shift
        except ValueError:
            return match.group(0)
        name = MONTHS[moved.month - 1]
        name = name.upper() if match.group(1).isupper() else name
        return f"{name} {moved.day}" + (f", {moved.year}" if match.group(3) else "")

    text = re.sub(r"\b(" + "|".join(MONTHS) + r")\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*(\d{4}))?", month_day, text,
                  flags=re.I)

    def numeric(match):
        month, day, year = int(match.group(1)), int(match.group(2)), int(match.group(3))
        year = year + 2000 if year < 100 else year
        try:
            moved = dt.date(year, month, day) + shift
        except ValueError:
            return match.group(0)
        return f"{moved.month}/{moved.day}/{moved.year if len(match.group(3)) == 4 else moved.year % 100:02d}"

    text = re.sub(r"\b(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})\b", numeric, text)
    return re.sub(r"\b(2000|2001|2002)\b", lambda m: str(int(m.group(1)) + round(shift.days / 365.25)), text)


# ---------- 跨流的事 ----------

# 靠挑选时间重合（或话题重合）的真实线程得到，不手写任何输入。选择器按流、类型、主题或正文匹配，
# 不依赖化名后的 ID，换一套盐重建也能找回同一组输入。
CROSS_STREAM = [
    {"key": "heatwave-ac", "title": "热浪里的空调与喝水",
     "why": "8 月 13–15 日斯德哥尔摩连续三天超过 26 °C；8 月 15 日上午本人在问答站问空调超出温控范围怎么办，"
            "两天前工作流的 Mastodon 对话里刚聊到一台分体空调的控制面板，月初还问过宠物在热天里狂喝水。",
     "select": [{"kind": "weather_alert", "subject": r"^Värme$"},
                {"kind": "qa_question", "subject": r"^Regulate AC above temperature range"},
                {"stream": "work", "channel": "^Mastodon$", "text": r"air condition"},
                {"kind": "qa_question", "subject": r"^Excessive Water Drinking"}]},
    {"key": "flight-on-busiest-day", "title": "航班变更撞上最忙的工作日",
     "why": "8 月 6 日中午本人发现直飞改成转机、换乘时间极紧，这一帧是两周里工作输入最多的一帧；"
            "前两天刚收到几封航空公司的特价群发。",
     "select": [{"kind": "qa_question", "subject": r"^Direct flight becomes indirect"},
                {"kind": "promo_email", "subject": r"TRAVEL SPECIALS|Weekly Web Fares|Take Along Fares"},
                {"stream": "work", "author_kind": "self", "between": ("2026-08-06T11:30", "2026-08-06T13:30")}]},
    {"key": "pet-dose", "title": "宠物药量弄错，工作时段里的急事",
     "why": "8 月 11 日下午本人怀疑给猫喂了双倍剂量的抗生素，前后一小时工作流里有十几条输入在等；"
            "按内容它比同时段的常规评审更急，但提问者此后没有再跟进，行为标注只能给 untouched：内容判断与行为标注分歧的样本。",
     "select": [{"kind": "qa_question", "subject": r"double dose of enrofloxacin"},
                {"stream": "work", "author_kind": "human", "between": ("2026-08-11T15:10", "2026-08-11T17:10")}]},
    {"key": "saturday-leak", "title": "周六水管开裂，同一天还在合并 PR",
     "why": "8 月 15 日（周六）下午本人问铜水管裂口能不能补，当天上午刚批准并关闭两个 PR，天气提醒仍是高温。",
     "select": [{"kind": "qa_question", "subject": r"^Can a split copper water line"},
                {"stream": "work", "author_kind": "self", "date": "2026-08-15", "text": r"closed this|approved"}]},
    {"key": "ai-security", "title": "AI 找漏洞：订阅与工作的同一话题",
     "why": "8 月 3 日本人在 Mastodon 上说“现在没有 LLM 已经找不到这些漏洞了”；同一时段订阅的几份 newsletter 在讲"
            "LLM 安全威胁模型、前沿模型的攻击能力与“这些黑客事件的教训”，说法与工作里的讨论并不一致。",
     "select": [{"stream": "work", "channel": "^Mastodon$", "text": r"without LLMs anymore|AI-generated\?"},
                {"kind": "newsletter", "subject": r"LLM Security Basics|Lessons from the hacks|frontier models"}]},
    {"key": "kitchen", "title": "厨房：问答与美食 newsletter",
     "why": "本人 8 月 8 日问贝壳类高汤要不要把壳打碎、12 日问电磁炉锅具；同一周订阅的美食 newsletter 在写度假屋做饭与番茄。",
     "select": [{"kind": "qa_question", "subject": r"shellfish shells|induction cookware"},
                {"kind": "newsletter", "subject": r"vacation house cooking|tomatoes triumphant"}]},
]


def resolve_cross_stream(events: list[dict]) -> list[dict]:
    out = []
    for item in CROSS_STREAM:
        chosen = []
        for rule in item["select"]:
            for e in events:
                if rule.get("stream") and e["stream"] != rule["stream"]:
                    continue
                if rule.get("kind") and e.get("kind") != rule["kind"]:
                    continue
                if rule.get("author_kind") and e.get("author_kind") != rule["author_kind"]:
                    continue
                if rule.get("date") and not e["at"].startswith(rule["date"]):
                    continue
                if rule.get("between") and not rule["between"][0] <= e["at"][:16] < rule["between"][1]:
                    continue
                if rule.get("channel") and not re.search(rule["channel"], e["channel"]):
                    continue
                if rule.get("subject") and not re.search(rule["subject"], e.get("subject") or ""):
                    continue
                if rule.get("text") and not re.search(rule["text"], e.get("text") or ""):
                    continue
                chosen.append(e)
        ids = list(dict.fromkeys(e["id"] for e in chosen))
        streams = sorted({e["stream"] for e in chosen})
        out.append({"key": item["key"], "title": item["title"], "why": item["why"], "events": ids,
                    "streams": streams, "frames": sorted({e["frame"] for e in chosen if e.get("frame")})})
    return out


# ---------- 组装 ----------

def window_bounds() -> tuple[dict, list[tuple[dt.datetime, dt.datetime]]]:
    meta = load(ROOT / "corpus" / "curl-bagder" / "raw" / "meta.json")
    bounds = frame_bounds(meta, 12)
    return meta, bounds


def build(write_ids: bool) -> dict:
    mapping = load_mapping()
    rw = Rewriter(mapping)
    meta, bounds = window_bounds()
    window = (bounds[0][0], bounds[-1][1])
    def collect() -> dict:
        return {
            "work": work_stream(rw)[0],
            "community": forum_stream(rw, window),
            "life": qa_stream(rw, window),
            "subscription": newsletter_stream(rw, window) + weather_stream(rw, window) + promo_stream(rw, window),
        }

    collect()  # 第一遍只登记各流的账号与名字，第二遍用完整的化名表改写，免得先处理的流漏掉后登记的名字
    rw._compiled = None
    streams = collect()
    events = [e for items in streams.values() for e in items if window[0] <= parse_time(e["at"]) < window[1]]
    events.sort(key=lambda e: (parse_time(e["at"]), e["id"]))
    ids = collections.Counter(e["id"] for e in events)
    duplicates = [i for i, c in ids.items() if c > 1]
    if duplicates:
        raise SystemExit(f"化名后的 ID 冲突：{duplicates[:5]}")
    frames, cursor = [], 0
    for index, (lo, hi) in enumerate(bounds, 1):
        chunk = []
        while cursor < len(events) and parse_time(events[cursor]["at"]) < hi:
            event = events[cursor]
            out = finish_event(event, ZONE)
            out["stream"], out["origin"] = event["stream"], event["origin"]
            chunk.append(out)
            cursor += 1
        frames.append({
            "id": f"f{index:02d}", "at": local_iso(hi, ZONE),
            "title": f"{hi.astimezone(ZONE):%m-%d %H:%M} 前 12 小时 · {len(chunk)} 条输入",
            "events": chunk, "batch": None,
            "signal": {"type": "events", "reason": "每 12 小时定时整理", "received": len(chunk),
                       "window": {"from": local_iso(lo, ZONE), "to": local_iso(hi, ZONE)}}})
    persona = rw.m["persona"]
    counts = collections.Counter(e["stream"] for e in events)
    scenario = {
        "id": f"composite-{meta['window']['start']}",
        "title": "混合人物两周：工作、社区爱好、生活问答与订阅噪音（真实公开数据，化名改写）",
        "subtitle": f"{meta['window']['start']} 至 {meta['window']['end']}（不含）· {len(events)} 条真实输入 · {len(frames)} 帧",
        "persona": {
            "name": persona["name"],
            "role": f"开源网络传输库 {rw.m['project']} 的创始人与首席维护者，住在斯德哥尔摩（化名人物）",
            "context": (f"每天处理 {rw.m['project']} 的 issue、PR、评审与 CI，维护邮件列表，在 Mastodon 与博客上和社区交流；"
                        "业余在一个自然观察论坛上发帖、关注“自然闲谈”分类；家里有房子要修、孩子要带、自行车要修，"
                        "常在生活问答站上提问；订阅了几份 newsletter，手机上有天气提醒。"
                        "各流来自不同真实的人的公开数据，人名、账号、项目与链接均已化名。"),
            "accounts": {"github": persona["github"], "mastodon": f"@{persona['mastodon']}@mastodon.social",
                         "forum": persona["forum"], "qa": persona["qa"], "email": persona["email"]},
        },
        "startAt": frames[0]["at"], "endAt": frames[-1]["at"], "timeZone": "Europe/Stockholm", "feedback": None,
        "source": {"name": "composite", "window": meta["window"], "frame_hours": 12, "text_limit": TEXT_LIMIT,
                   "streams": dict(counts), "doc": "corpus/composite/MIX.md"},
        "frames": frames,
    }
    BASE.mkdir(parents=True, exist_ok=True)
    save(BASE / "frames.json", scenario)
    import hashlib as _h  # noqa: PLC0415
    ids_doc = {"source": "composite", "window": meta["window"], "frame_hours": 12, "events": [
        {"id": e["id"], "frame": f["id"], "stream": e["stream"], "kind": e.get("kind"), "at": e["at"],
         "author_kind": e.get("author_kind"), "thread": e.get("thread"), "text_length": e["text_length"],
         "text_sha1": _h.sha1(e["text"].encode()).hexdigest()[:12], "origin": e["origin"]}
        for f in frames for e in f["events"]]}
    ids_path = BASE / "ids.json"
    if ids_path.exists() and not write_ids:
        old = {e["id"]: e for e in load(ids_path)["events"]}
        new = {e["id"]: e for e in ids_doc["events"]}
        diff = (len(set(old) - set(new)), len(set(new) - set(old)),
                sum(1 for i in set(old) & set(new) if old[i]["text_sha1"] != new[i]["text_sha1"]))
        log("与入库的 ids.json 一致。" if not any(diff) else
            f"与入库的 ids.json 不一致：缺 {diff[0]}、多 {diff[1]}、正文变化 {diff[2]}；用 --write-ids 接受")
    else:
        save(ids_path, ids_doc, lines=True)
    store_mapping(rw.m)
    total = len(events)
    log(f"composite：{total} 条输入，{len(frames)} 帧 → frames.json；" +
        "，".join(f"{k} {counts[k]}（{counts[k] / total:.0%}）" for k in STREAMS))
    return scenario


def audit(sample: int, seed: int) -> None:
    """抽样打印改写后的输入；再把本机化名表里的真实名字逐个在全部文本里查一遍，报告残留。"""
    mapping = load_mapping()
    corpus = load(BASE / "frames.json")
    events = [e for f in corpus["frames"] for e in f["events"]]
    rng = random.Random(seed)
    for e in rng.sample(events, min(sample, len(events))):
        print(f"--- {e['id']} [{e['stream']}] {e['channel']} · {e['from']} · {e['at']}")
        print(f"    subject: {e.get('subject')}")
        print("    " + re.sub(r"\s+", " ", e["text"])[:600])
    haystack = "\n".join(" ".join(str(e.get(k) or "") for k in ("from", "text", "subject", "url", "thread", "channel"))
                         for e in events)
    words, _ = load_words()
    residue = collections.Counter()
    real_terms = set(mapping["persona"]["real"]["names"]) | {mapping["persona"]["real"]["github"]}
    real_terms |= {k for k in mapping["people"] if " " in k}
    real_terms |= {k for k in mapping["handles"] if len(k) >= 5 and k not in words}
    real_terms |= {k for k in mapping["last_names"] if k.lower() not in words}
    for term in sorted(real_terms):
        hits = len(re.findall(rf"(?<![\w-]){re.escape(term)}(?![\w-])", haystack, re.I if term.islower() else 0))
        if hits:
            residue[term] = hits
    print(f"\n残留检查：{len(real_terms)} 个真实名字与账号，{len(residue)} 个仍出现在文本里")
    for term, hits in residue.most_common(40):
        print(f"  {hits:4}  {term[:2]}…（{len(term)} 字）")


# ---------- 弱标注 ----------

def work_actions(rw: Rewriter) -> tuple[dict, dict, dict, dict]:
    """工作流沿用 curl-bagder 的规则（label_corpus.curl_actions），再把线程、输入与依据换成同一套化名。"""
    base = ROOT / "corpus" / "curl-bagder" / "raw"
    raw = {p.stem: load(p) for p in base.glob("*.json") if p.stem != "meta"}
    actions, links, outcome, direct = curl_actions(raw, load(base / "meta.json"))
    ref = rw.ref
    actions = {ref(k): [{**a, "ref": ref(a.get("ref"))} for a in v] for k, v in actions.items()}
    links = {ref(k): [(ref(other), why) for other, why in v] for k, v in links.items()}
    outcome = {ref(k): {**v, "labels": [rw.text(x, urls=False) for x in v["labels"]]} if v.get("labels") else v
               for k, v in outcome.items()}
    return actions, links, outcome, {ref(k): v for k, v in direct.items()}


def community_actions(rw: Rewriter) -> tuple[dict, dict]:
    """论坛：本人在同一话题里发帖就是行动；本人帖子指明回复的那一帖记为已直接回应。"""
    posts = load(BASE / "raw" / "forum.json")
    me = rw.m["selection"]["forum_self"]
    by_number = {(p["topic_id"], p["post_number"]): p for p in posts}
    actions, direct = collections.defaultdict(list), {}
    for p in posts:
        if p["author"] != me:
            continue
        post_id, thread = forum_ids(rw, p)
        actions[thread].append({"at": parse_time(p["at"]), "who": "self",
                                "action": "forum_topic" if p["post_number"] == 1 else "forum_reply", "ref": post_id})
        parent = by_number.get((p["topic_id"], p.get("reply_to_post_number")))
        if parent and parent["author"] != me:
            direct[forum_ids(rw, parent)[0]] = "self_replied"
    return actions, direct


def life_actions(rw: Rewriter) -> tuple[dict, dict, dict]:
    """问答：提问者（本人）此后在同一问题下的评论、回答是行动；评论挂在谁的回答下、或回复了谁的评论，那一条记为已直接回应。
    采纳的回答与关闭原因写入结局（采纳时间 API 不给，不算行动）。"""
    items = load(BASE / "raw" / "qa.json")
    chosen = rw.m["selection"].get("qa_questions") or {}
    keys = {(site, int(q)) for site, ids in chosen.items() for q in ids}
    questions = {(r["site"], r["question_id"]): r for r in items if r["kind"] == "question"}
    posts = {(r["site"], int(r["id"].split(":")[-1][1:])): r for r in items if r["kind"] in ("question", "answer")}
    comments = collections.defaultdict(list)
    for r in items:
        if r["kind"] == "comment":
            comments[(r["site"], r.get("post_id"))].append(r)
    actions, direct, outcome = collections.defaultdict(list), {}, {}
    for r in items:
        key = (r["site"], r["question_id"])
        if key not in keys or key not in questions:
            continue
        asker = questions[key].get("user_id")
        _, thread = qa_ids(rw, r)
        if r["kind"] == "question":
            result = {"state": "closed", "reason": r["closed_reason"]} if r.get("closed_reason") else {"state": "open"}
            if r.get("accepted_answer_id"):
                result["accepted"] = f"qa:{r['site']}:a{rw.number('se', str(r['accepted_answer_id']))}"
            outcome[thread] = result
            continue
        if asker is None or r.get("user_id") != asker:
            continue
        item_id, _ = qa_ids(rw, r)
        actions[thread].append({"at": qa_time(r, questions[key]), "who": "self", "action": f"qa_{r['kind']}",
                                "ref": item_id})
        if r["kind"] != "comment":
            continue
        target = posts.get((r["site"], r.get("post_id")))
        if target and target.get("user_id") != asker:
            direct[qa_ids(rw, target)[0]] = "self_replied"
        elif r.get("reply_to_user_id"):
            earlier = [c for c in comments[(r["site"], r.get("post_id"))]
                       if c.get("user_id") == r["reply_to_user_id"] and c["at"] < r["at"]]
            if earlier:
                direct[qa_ids(rw, max(earlier, key=lambda c: c["at"]))[0]] = "self_replied"
    return actions, direct, outcome


def labels(high_per_frame: int) -> dict:
    corpus = load(BASE / "frames.json")
    # 家庭流的标注由节拍表写定（family 子命令），这里只推前四条流；已有的 family 一节原样保留。
    previous = load(BASE / "labels.json") if (BASE / "labels.json").exists() else {}
    for frame in corpus["frames"]:
        frame["events"] = [e for e in frame["events"] if e.get("stream") != "family"]
    rw = Rewriter(load_mapping())
    actions, links, outcome, direct = work_actions(rw)
    forum_act, forum_direct = community_actions(rw)
    qa_act, qa_direct, qa_outcome = life_actions(rw)
    actions.update(forum_act)
    actions.update(qa_act)
    outcome.update(qa_outcome)
    direct.update(forum_direct)
    direct.update(qa_direct)
    events = [dict(e, frame=f["id"]) for f in corpus["frames"] for e in f["events"]]
    stream_of = {e["id"]: e["stream"] for e in events}
    # 订阅流默认是噪音：newsletter、营销邮件与天气提醒都不需要本人行动。
    direct.update({e["id"]: "subscription" for e in events if e["stream"] == "subscription"})
    out_frames, totals = label_frames(corpus, actions, links, outcome, direct, high_per_frame)
    per_stream = {s: collections.Counter() for s in STREAMS if s != "family"}
    where = {}
    for frame in out_frames:
        for item in frame["items"]:
            stream = stream_of[item["events"][0]]
            per_stream[stream][f"tier_{item['tier']}"] += 1
            per_stream[stream]["high"] += item["high"]
            for event_id in item["events"]:
                where[event_id] = item
        for ignored in frame["ignore"]:
            per_stream[stream_of[ignored["event"]]]["ignore_events"] += 1
    for e in events:
        if e["author_kind"] != "self":
            per_stream[e["stream"]]["input_events"] += 1
    ignored = {i["event"] for f in out_frames for i in f["ignore"]}
    thread_of = {e["id"]: e.get("thread") or e["id"] for e in events}
    thread_tiers = collections.defaultdict(set)
    for frame in out_frames:
        for item in frame["items"]:
            thread_tiers[item["thread"]].add(item["tier"] + ("+high" if item["high"] else ""))
    cross = []
    for item in resolve_cross_stream(events):
        # 本人发出的输入（如提出的问题）不单独定档，看它所在线程在各帧的档位。
        cross.append({**{k: item[k] for k in ("key", "title", "why", "streams", "frames")}, "events": [
            {"id": i, "stream": stream_of[i], "tier": where[i]["tier"] if i in where else "self",
             "high": bool(where.get(i, {}).get("high")), "ignored": i in ignored,
             "thread_tiers": sorted(thread_tiers.get(thread_of[i], ()))} for i in item["events"]]})
    result = {
        "source": "composite", "window": corpus["source"]["window"],
        "method": {
            "horizon_days": 7, "high_per_frame": high_per_frame,
            "work": "沿用 curl-bagder 的规则（corpus/curl-bagder/LABELS.md），线程、输入与依据换成同一套化名",
            "community": "本人在同一话题里发帖为行动；没有团队，不出现 delegated",
            "life": "本人（提问者）此后在同一问题下的评论与回答为行动；采纳与关闭只写入结局",
            "subscription": "默认 noise（subscription_default），不看后续行为",
            "cross_stream": "时间或话题真实重合的几件事单列，见 corpus/composite/MIX.md；不并成同一事项",
            "doc": "corpus/composite/LABELS.md"},
        "summary": {**dict(sorted(totals.items())), "frames": len(out_frames),
                    "frames_with_high": sum(1 for f in out_frames if any(i["high"] for i in f["items"])),
                    "by_stream": {s: dict(sorted(c.items())) for s, c in per_stream.items()}},
        "cross_stream": cross,
        "frames": out_frames,
    }
    if previous.get("family"):
        result["family"] = previous["family"]
    save(BASE / "labels.json", result, lines=True)
    log(f"写入 {BASE / 'labels.json'}：" + "；".join(
        f"{s} {dict(sorted(c.items()))}" for s, c in per_stream.items()))
    return result


# ---------- 噪音画像 ----------

def noise() -> dict:
    """composite 的噪音指标，与 curl-bagder、手写情境并排；手写情境的指标取自 curl-bagder 的 noise.json。"""
    corpus = load(BASE / "frames.json")
    events = [{**e, "author": e["from"], "frame": f["id"]} for f in corpus["frames"] for e in f["events"]]
    reference = load(ROOT / "corpus" / "curl-bagder" / "noise.json")
    result = {"source": "composite", "corpus": metrics(events, corpus["frames"], ZONE), "streams": {}}
    for stream in STREAMS:
        frames = [{"events": [e for e in f["events"] if e["stream"] == stream]} for f in corpus["frames"]]
        result["streams"][stream] = metrics([e for e in events if e["stream"] == stream], frames, ZONE)
    result["curl-bagder"] = reference["corpus"]
    result["scenario"] = reference["scenario"]
    save(BASE / "noise.json", result)
    log(f"写入 {BASE / 'noise.json'}")
    print(metric_table([result["curl-bagder"], result["corpus"], result["scenario"]],
                       ["curl-bagder", "composite", "手写情境"]))
    print()
    print(metric_table([result["streams"][s] for s in STREAMS], list(STREAMS)))
    return result


FAMILY_PERSONA = ("家人通过 iMessage、短信与 WhatsApp 群联系他：伴侣 Kajsa、女儿 Signe（11 岁）、儿子 Ture（4 岁，上幼儿园）、"
                  "母亲（通讯录里叫“Mamma”，独居外地）、妹妹 Ulrika；家里养一只猫 Smilla。家庭往来是瑞典语，由作者编写，不来自真实的人。")


def family() -> dict:
    """把家庭流追加进现有 frames.json：前四条流原样保留（不需要化名表与 raw/），家庭流按时间插入 28 帧。

    同时重写 ids.json（前四条流的条目必须与原来逐条一致）、重算 noise.json，并把作者标注写成 labels.json 的 family 一节。
    可以重复运行：先去掉已有的家庭流再插入。
    """
    import family_stream  # noqa: PLC0415

    events = family_stream.write_render()
    corpus = load(BASE / "frames.json")
    backup = ROOT / ".local" / "composite" / "frames-v1.1.json"
    frames = corpus["frames"]
    for frame in frames:
        frame["events"] = [e for e in frame["events"] if e.get("stream") != "family"]
    if not backup.exists():
        backup.parent.mkdir(parents=True, exist_ok=True)
        save(backup, corpus)
        log(f"备份不含家庭流的 frames.json → {backup}")
    old_ids = load(BASE / "ids.json")
    bounds = [(parse_time(f["signal"]["window"]["from"]), parse_time(f["signal"]["window"]["to"]), f) for f in frames]
    for event in events:
        at = parse_time(event["at"])
        frame = next((f for lo, hi, f in bounds if lo <= at < hi), None)
        if frame is None:
            raise SystemExit(f"{event['id']} 不在窗口内：{event['at']}")
        frame["events"].append(event)
    for frame in frames:
        frame["events"].sort(key=lambda e: (parse_time(e["at"]), e["id"]))
        frame["title"] = re.sub(r"· \d+ 条输入$", f"· {len(frame['events'])} 条输入", frame["title"])
        frame["signal"]["received"] = len(frame["events"])
    counts = collections.Counter(e["stream"] for f in frames for e in f["events"])
    total = sum(counts.values())
    corpus["title"] = "混合人物两周：工作、社区爱好、生活问答、家庭往来与订阅噪音（真实公开数据化名改写，家庭流为原创）"
    corpus["subtitle"] = (f"{corpus['source']['window']['start']} 至 {corpus['source']['window']['end']}（不含）· {total} 条输入"
                          f"（其中家庭流 {counts['family']} 条为作者编写）· {len(frames)} 帧")
    corpus["source"]["streams"] = {s: counts[s] for s in STREAMS if counts[s]}
    corpus["source"]["family"] = "corpus/composite/family/README.md"
    context = re.sub(r"家人通过 .*?不来自真实的人。", "", corpus["persona"]["context"])
    corpus["persona"]["context"] = context.replace("订阅了几份 newsletter", FAMILY_PERSONA + "订阅了几份 newsletter", 1)
    save(BASE / "frames.json", corpus)
    import hashlib as _h  # noqa: PLC0415
    ids_doc = {**{k: v for k, v in old_ids.items() if k != "events"}, "events": [
        {"id": e["id"], "frame": f["id"], "stream": e["stream"], "kind": e.get("kind"), "at": e["at"],
         "author_kind": e.get("author_kind"), "thread": e.get("thread"), "text_length": e["text_length"],
         "text_sha1": _h.sha1(e["text"].encode()).hexdigest()[:12], "origin": e["origin"]}
        for f in frames for e in f["events"]]}
    before = [e for e in old_ids["events"] if e["stream"] != "family"]
    after = [e for e in ids_doc["events"] if e["stream"] != "family"]
    if before != after:
        raise SystemExit("前四条流的 ids.json 条目与重建结果不一致，frames.json 可能不是入库清单对应的版本；未写入")
    save(BASE / "ids.json", ids_doc, lines=True)
    noise()
    labels_path = BASE / "labels.json"
    labels_doc = load(labels_path)
    labels_doc["family"] = family_stream.labels(family_stream.load_beats(), frames)
    save(labels_path, labels_doc, lines=True)
    summary = labels_doc["family"]["summary"]
    log(f"composite：{total} 条输入，家庭流 {counts['family']} 条（{counts['family'] / total:.1%}）；"
        f"家庭流标注：应忽略 {summary['ignore_events']} 条，问题 {summary['asks']} 个（答 {summary['asks_answered']}、"
        f"失效 {summary['asks_void']}、开着 {summary['asks_open']}）")
    return corpus


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("command", choices=("build", "labels", "noise", "audit", "family"))
    parser.add_argument("--high-per-frame", type=int, default=3)
    parser.add_argument("--write-ids", action="store_true")
    parser.add_argument("--sample", type=int, default=30)
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()
    if args.command == "build":
        build(args.write_ids)
    elif args.command == "labels":
        labels(args.high_per_frame)
    elif args.command == "noise":
        noise()
    elif args.command == "audit":
        audit(args.sample, args.seed)
    elif args.command == "family":
        family()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
