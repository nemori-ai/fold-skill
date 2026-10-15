"""用真实模型逐帧评测 Fold 的语义判断，与演示情境中作者手写的批次对比。

方法（teacher-forced）：第 n 帧的起始状态由内核回放作者前 n-1 帧的批次得到，每帧判断互不影响。
被测 Agent 看到 skill/SKILL.md、用户背景、业务用途、当前 state、待确认批注、本轮输入与宿主信号；
作者的处置（disposition / why / relatedIds）与批次是答案，不进入提示。Agent 输出的批次交给
MemoryStore.commit；被拒绝时把回执原样交回，最多再要两次。

用法：
  python3 scripts/eval_judgment.py --frames f01,f05 --report     # 子集
  python3 scripts/eval_judgment.py --report                      # 全部 36 帧
  python3 scripts/eval_judgment.py --dry-run --frames f01        # 只生成提示，不调用模型
  python3 scripts/eval_judgment.py --rescore .local/eval/<run-id> --report   # 用已保存的响应重新计分
  python3 scripts/eval_judgment.py --persona-context "<当时已知的背景>" ...    # 替换提示中的用户背景
  python3 scripts/eval_judgment.py --runner codex --frames f01 --report     # 改用 codex exec（默认 gpt-6.1-sol）
  python3 scripts/eval_judgment.py --skill .local/eval/SKILL-v1.md ...       # 指定被测的 SKILL.md 版本
  python3 scripts/eval_judgment.py --runner codex --run-id <id> --resume --report   # 中断后续跑未完成的帧

结果写到 .local/eval/<run-id>/：每帧一个 <frame>.json（提示、原始响应、回执、对比），
summary.json 与 report.md；codex 的每次调用另在 codex/ 下留空工作目录、事件流与最后消息。
指标分别列出，不合成总分。只用标准库；调用 `claude -p` 或 `codex exec`。

自由运行（--free-run --corpus <frames.json>）：真实语料没有作者批次，不能 teacher-forced。Agent 从空状态开始，
每帧拿到 SKILL.md、用户背景、自己上一帧提交后的状态、本帧输入与宿主信号；批次经内核提交，被拒绝时带回执
重试，最多 3 次，仍被拒绝则该帧记 skipped 并沿用上一帧状态。状态逐帧前传，因此只能顺序运行。不做作者对比，
改为与语料旁的弱标注（labels.json）做三项对照：忽略集合的精确率与召回率、同组输入是否进同一声明、同帧事项
成对排序一致率。用法：
  python3 scripts/eval_judgment.py --free-run --corpus corpus/curl-bagder/frames.json --dry-run   # 估算 token 与费用
  python3 scripts/eval_judgment.py --free-run --corpus <frames.json> --max-cost 40 --report        # 真实调用
  python3 scripts/eval_judgment.py --free-run --corpus <frames.json> --run-id <id> --resume --report
  python3 scripts/eval_judgment.py --free-run --corpus <frames.json> --rescore .local/eval/<id> --report
"""

from __future__ import annotations

import argparse
import collections
import concurrent.futures
import contextlib
import copy
import datetime
import hashlib
import itertools
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fold import MemoryStore, kernel  # noqa: E402

DISPOSITIONS = ("used", "noise", "duplicate", "deferred")
WEIGHTS = kernel.WEIGHT_ORDER
EVENT_FIELDS = ("id", "channel", "from", "at", "text", "feedback", "reminder")  # 宿主提供的字段；其余是作者的判断
DEFAULT_MODELS = {"claude": "claude-opus-5-5", "codex": "gpt-6.1-sol"}
SKILL_PATH = ROOT / "skill" / "SKILL.md"
MAX_RETRIES = 2

# codex exec 是带工具的 Agent，工作目录又在仓库里。以下设置让它读不到仓库与用户环境（均已用探针核实）：
# project_doc_max_bytes=0 —— 否则会沿工作目录向上加载仓库根的 AGENTS.md；
# include_environment_context=false —— 否则注入真实日期、时区与工作目录路径，日期落在情境中段；
# 关掉 shell、code mode 等工具 —— 否则能执行 pwd、ls .. 看到仓库路径。对应 claude 路径的 --tools ''。
CODEX_CONFIG = (
    "project_doc_max_bytes=0", 'web_search="disabled"',
    "include_environment_context=false", "include_permissions_instructions=false",
)
CODEX_DISABLED_FEATURES = (
    "shell_tool", "unified_exec", "code_mode_host", "apps", "plugins", "multi_agent", "goals",
    "image_generation", "view_image", "browser_use", "computer_use", "in_app_browser", "sleep_tool",
    "tool_suggest", "hooks", "memories", "skill_search",
)
CODEX_SYSTEM_HEADING = "======== 系统提示 ========"
CODEX_USER_HEADING = "======== 用户消息 ========"
RATE_LIMIT_PATTERN = re.compile(r"\b429\b|rate[ _-]?limit|usage limit|too many requests|quota", re.IGNORECASE)
AUTH_PATTERN = re.compile(r"\b401\b|unauthorized|not logged in|codex login", re.IGNORECASE)
STOP = threading.Event()  # 遇到致命错误后，尚未开始的调用不再发出

SOURCE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["channel", "ref"],
    "properties": {
        "channel": {"type": "string"},
        "ref": {"type": "string", "description": "引用本轮输入用 event:<事件 id>"},
        "quote": {"type": "string"},
        "observed_at": {"type": "string"},
    },
}
OUTPUT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["dispositions", "batch"],
    "properties": {
        "dispositions": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["event", "disposition", "why", "related"],
                "properties": {
                    "event": {"type": "string"},
                    "disposition": {"enum": list(DISPOSITIONS)},
                    "why": {"type": "string"},
                    "related": {"type": "array", "items": {"type": "string"}},
                },
            },
        },
        "batch": {
            "type": "object",
            "additionalProperties": False,
            "required": ["declarations", "acknowledges"],
            "properties": {
                "declarations": {"type": "array", "items": {"$ref": "#/$defs/declaration"}},
                "acknowledges": {"type": "array", "items": {"type": "string"}},
            },
        },
    },
    "$defs": {
        "declaration": {
            "type": "object",
            "additionalProperties": False,
            "required": ["id"],
            "properties": {
                "id": {"type": "string"},
                "relation": {"type": "string"},
                "title": {"type": "string"},
                "summary": {"type": ["string", "null"]},
                "weight": {"enum": list(WEIGHTS)},
                "kind": {"enum": list(kernel.KINDS)},
                "reason": {"type": "string"},
                "due_at": {"type": ["string", "null"]},
                "stale_after": {"type": ["string", "null"]},
                "share": {"type": ["integer", "null"]},
                "sources": {"type": ["array", "null"], "items": SOURCE_SCHEMA},
                "children": {"type": ["array", "null"], "items": {"$ref": "#/$defs/declaration"}},
            },
        },
    },
}

SYSTEM_PREAMBLE = (
    "你是用户的工作助手，正在使用已安装的 Fold skill 整理用户的状态。下面是 skill 全文。"
    "宿主每轮给你一次输入；你只输出 skill 规定的 JSON 对象。\n\n<skill>\n"
)


class FatalCallError(Exception):
    """登录、权限等使整轮评测无法继续的错误；不逐帧重试。"""


class RateLimitError(FatalCallError):
    """速率或额度限制：立即停下，保留已完成的帧。"""


class FrameCancelled(Exception):
    """其他帧遇到致命错误后，本帧不再调用模型。"""


def dump(value) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2)


# ---------- 情境与 teacher-forced 回放 ----------

def load_scenario(path: str | None) -> dict:
    if path:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    output = subprocess.run(["node", str(ROOT / "scripts" / "export-scenario.mjs")], check=True,
                            capture_output=True, text=True, cwd=ROOT).stdout
    return json.loads(output)


def prepare_frames(scenario: dict) -> list[dict]:
    """回放作者批次。每帧记录：Agent 看到的起始快照（已存入本帧批注）、作者批次与作者结果。"""
    store = MemoryStore()
    annotation_ids: dict[str, str] = {}
    prepared = []
    for frame in scenario["frames"]:
        for annotation in frame.get("annotations", []):
            receipt = store.annotate(f"annotate-{annotation['id']}", annotation["item"], annotation["text"],
                                     "user", annotation["at"])
            if not receipt.get("accepted"):
                raise SystemExit(f"{frame['id']} 的批注无法存入：{receipt}")
            annotation_ids[annotation["id"]] = receipt["annotation_id"]
        if frame["batch"] is None:
            continue
        base = copy.deepcopy(store.snapshot)
        author_batch = {
            "batch_id": frame["batch"]["batch_id"],
            "declarations": copy.deepcopy(frame["batch"]["declarations"]),
            "acknowledges": [annotation_ids.get(a, a) for a in frame["batch"]["acknowledges"]],
        }
        receipt = store.commit(copy.deepcopy(author_batch), "assistant", frame["at"])
        if not receipt.get("accepted"):
            raise SystemExit(f"作者批次 {frame['id']} 回放失败：{receipt}")
        prepared.append({
            "frame": frame, "base": base, "author_batch": author_batch, "author_receipt": receipt,
            "author_after": copy.deepcopy(store.snapshot),
        })
    return prepared


# ---------- 提示 ----------

def visible_event(event: dict) -> dict:
    visible = {key: copy.deepcopy(event[key]) for key in EVENT_FIELDS if key in event}
    for link in visible.get("feedback", []):
        link.pop("ask", None)  # 原型数据另记了回应路径的 ID；提示保持与此前的评测逐字节相同
    return visible


def build_prompt(scenario: dict, prep: dict, batch_id: str) -> str:
    frame = prep["frame"]
    store = MemoryStore()
    store.snapshot = copy.deepcopy(prep["base"])
    state = store.state(frame["at"])
    sections = [
        f"# 本轮整理\n\nnow: {frame['at']}\nbatch_id: {batch_id}（由宿主附加到批次，你不必输出）",
        "## 用户背景\n\n" + dump(scenario["persona"]),
        "## 业务用途与反馈约定\n\n两个界面消费同一份 Fold 状态。\n\n" + dump(scenario["feedback"]),
        "## 当前状态（state）\n\n" + dump(state),
        "## 待确认批注\n\n" + dump(state["pending_annotations"]),
        "## 宿主信号\n\n" + dump(frame.get("signal")),
        "## 本轮输入\n\n" + dump([visible_event(e) for e in frame["events"]]),
        "## 输出\n\n按 skill 的接口输出一个 JSON 对象：dispositions 覆盖上面每一个输入事件；"
        "batch 只含 declarations 与 acknowledges。",
    ]
    return "\n\n".join(sections) + "\n"


def retry_section(output: dict, receipt: dict) -> str:
    return (
        "\n\n## 上一次输出被拒绝\n\n你上一次的输出：\n\n" + dump(output)
        + "\n\n内核回执（批次未写入，状态不变，同一 batch_id 仍可使用）：\n\n" + dump(receipt)
        + "\n\n请修正后重新输出完整的 JSON 对象。\n"
    )


# ---------- 调用模型 ----------

def claude_command(model: str, system_prompt: str) -> list[str]:
    command = ["claude", "-p"]
    if os.environ.get("ANTHROPIC_API_KEY"):
        command.append("--bare")  # --bare 只接受 API key，不读 OAuth 登录。
    # 没有 API key 时用登录态调用，同样隔离：不读用户/项目设置与 hooks、不加载 MCP 与 skill、不给工具。
    command += [
        "--setting-sources", "", "--strict-mcp-config", "--disable-slash-commands",
        "--tools", "", "--no-session-persistence", "--output-format", "json",
        "--json-schema", json.dumps(OUTPUT_SCHEMA, ensure_ascii=False),
        "--system-prompt", system_prompt, "--model", model,
    ]
    return command


def call_model(command: list[str], prompt: str, timeout: int, workdir: str) -> dict:
    """调用一次 claude -p；失败重试一次。返回 {response, stdout_tail, error, calls}。"""
    errors = []
    for _ in range(2):
        try:
            proc = subprocess.run(command, input=prompt, capture_output=True, text=True, timeout=timeout, cwd=workdir)
        except subprocess.TimeoutExpired:
            errors.append(f"timeout after {timeout}s")
            continue
        try:
            data = json.loads(proc.stdout)
        except json.JSONDecodeError:
            errors.append(f"exit {proc.returncode}; stdout {proc.stdout[-400:]!r}; stderr {proc.stderr[-400:]!r}")
            continue
        result_text = str(data.get("result", ""))
        if "Not logged in" in result_text or "Invalid API key" in result_text:
            raise FatalCallError(result_text)
        if data.get("is_error") or not isinstance(data.get("structured_output"), dict):
            errors.append(f"is_error={data.get('is_error')} terminal={data.get('terminal_reason')} result={result_text[:400]!r}")
            continue
        return {"response": data, "error": None, "calls": len(errors) + 1}
    return {"response": None, "error": errors, "calls": len(errors)}


def compose_codex_prompt(system_prompt: str, prompt: str) -> str:
    """codex exec 没有 --system-prompt：两段原文不改，用分节标题合成一条用户消息。"""
    return f"{CODEX_SYSTEM_HEADING}\n\n{system_prompt}\n{CODEX_USER_HEADING}\n\n{prompt}"


def codex_message(args, system_prompt: str, prompt: str) -> str:
    """merged（默认）发合成消息；instructions 模式下系统提示经 model_instructions_file 传入，消息只含用户提示。"""
    return prompt if args.codex_system == "instructions" else compose_codex_prompt(system_prompt, prompt)


def codex_command(model: str, workdir: str, schema: str, last_message: str,
                  instructions: str | None = None) -> list[str]:
    command = ["codex", "exec", "-m", model, "-C", workdir, "-s", "read-only", "--ephemeral",
               "--skip-git-repo-check", "--ignore-user-config"]
    for setting in CODEX_CONFIG:
        command += ["-c", setting]
    if instructions:  # 用系统提示替换 codex 自带的基础指令，对照 claude -p --system-prompt
        command += ["-c", f"model_instructions_file={json.dumps(instructions)}"]
    for feature in CODEX_DISABLED_FEATURES:
        command += ["--disable", feature]
    return command + ["--output-schema", schema, "-o", last_message, "--json", "-"]


def parse_codex_events(stdout: str) -> dict:
    """从 --json 事件流取 usage、thread_id、错误与非消息条目（用来核实没有调用工具）。"""
    usage: collections.Counter = collections.Counter()
    parsed = {"thread_id": None, "usage": None, "errors": [], "items": [], "messages": []}
    for line in stdout.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        kind = event.get("type")
        if kind == "thread.started":
            parsed["thread_id"] = event.get("thread_id")
        elif kind == "turn.completed":
            usage.update({k: v for k, v in (event.get("usage") or {}).items() if isinstance(v, int)})
            parsed["usage"] = dict(usage)
        elif kind == "turn.failed":
            parsed["errors"].append(str((event.get("error") or {}).get("message", event)))
        elif kind == "error":
            parsed["errors"].append(str(event.get("message", event)))
        elif kind == "item.completed":
            item = event.get("item") or {}
            if item.get("type") == "agent_message":
                parsed["messages"].append(item.get("text", ""))
            elif item.get("type") == "error":
                parsed["errors"].append(str(item.get("message", "")))
            elif item.get("type") != "reasoning":
                parsed["items"].append(item.get("type"))
    return parsed


def call_codex(args, prompt: str, run_dir: Path, tag: str) -> dict:
    """调用一次 codex exec；失败重试一次，遇到速率限制立即停下。返回结构与 call_model 相同。"""
    errors = []
    calls_dir = run_dir / "codex"
    for _ in range(2):
        if STOP.is_set():
            raise FrameCancelled(tag)
        number = 1
        while Path(f"{calls_dir / tag}.c{number}.cwd").exists():  # 续跑时不覆盖此前失败调用的记录
            number += 1
        stem = calls_dir / f"{tag}.c{number}"
        workdir = Path(f"{stem}.cwd")  # 空目录，调用后保留以便排查
        workdir.mkdir(parents=True)
        last_path = Path(f"{stem}.last.json")
        last_path.unlink(missing_ok=True)
        instructions = str(run_dir / "system-prompt.txt") if args.codex_system == "instructions" else None
        command = codex_command(args.model, str(workdir), str(run_dir / "schema.json"), str(last_path), instructions)
        try:
            proc = subprocess.run(command, input=prompt, capture_output=True, text=True, timeout=args.timeout,
                                  cwd=workdir)
        except subprocess.TimeoutExpired as error:
            partial = error.stdout.decode(errors="replace") if isinstance(error.stdout, bytes) else (error.stdout or "")
            Path(f"{stem}.events.jsonl").write_text(partial, encoding="utf-8")
            errors.append(f"timeout after {args.timeout}s")
            continue
        Path(f"{stem}.events.jsonl").write_text(proc.stdout, encoding="utf-8")
        Path(f"{stem}.stderr.txt").write_text(proc.stderr, encoding="utf-8")
        events = parse_codex_events(proc.stdout)
        text = last_path.read_text(encoding="utf-8") if last_path.exists() else (events["messages"] or [""])[-1]
        try:
            output = json.loads(text)
        except json.JSONDecodeError:
            output = None
        if proc.returncode == 0 and isinstance(output, dict):
            response = {"structured_output": output, "usage": events["usage"], "thread_id": events["thread_id"],
                        "tool_items": events["items"], "error_items": events["errors"], "files": stem.name}
            return {"response": response, "error": None, "calls": len(errors) + 1}
        failure = " | ".join(events["errors"]) + " | " + proc.stderr[-1500:]
        if RATE_LIMIT_PATTERN.search(failure):
            raise RateLimitError(f"{tag}: {failure[-600:]}")
        if AUTH_PATTERN.search(failure):
            raise FatalCallError(f"{tag}: {failure[-600:]}")
        errors.append(f"exit {proc.returncode}; errors {events['errors'][-3:]!r}; last {text[-300:]!r}; "
                      f"stderr {proc.stderr[-300:]!r}; usage {events['usage']}")
    return {"response": None, "error": errors, "calls": len(errors)}


def token_usage(response: dict | None) -> dict | None:
    """把两种 CLI 的 usage 归一为 input（含缓存）、cached、output（含推理）、reasoning。"""
    usage = (response or {}).get("usage")
    if not usage:
        return None
    if "cache_read_input_tokens" in usage or "cache_creation_input_tokens" in usage:  # claude -p
        cached = usage.get("cache_read_input_tokens", 0)
        return {"input": usage.get("input_tokens", 0) + cached + usage.get("cache_creation_input_tokens", 0),
                "cached": cached, "output": usage.get("output_tokens", 0),
                "reasoning": (usage.get("output_tokens_details") or {}).get("thinking_tokens", 0)}
    return {"input": usage.get("input_tokens", 0), "cached": usage.get("cached_input_tokens", 0),  # codex exec
            "output": usage.get("output_tokens", 0), "reasoning": usage.get("reasoning_output_tokens", 0)}


# ---------- 运行一帧 ----------

def run_frame(scenario: dict, prep: dict, args, system_prompt: str, run_dir: Path) -> dict:
    frame = prep["frame"]
    batch_id = f"eval-{frame['id']}"
    prompt = build_prompt(scenario, prep, batch_id)
    record = {"frame": frame["id"], "at": frame["at"], "batch_id": batch_id, "prompt": prompt, "attempts": []}
    if args.runner == "codex":
        (run_dir / "codex").mkdir(exist_ok=True)
    if args.dry_run:
        if args.runner == "codex":
            (run_dir / "codex" / f"{frame['id']}.a1.prompt.txt").write_text(
                codex_message(args, system_prompt, prompt), encoding="utf-8")
        write_json(run_dir / f"{frame['id']}.json", record)
        return record
    store = MemoryStore()
    store.snapshot = copy.deepcopy(prep["base"])
    current = prompt
    with contextlib.ExitStack() as stack:
        if args.runner == "codex":
            def invoke(text: str, attempt: int) -> dict:
                composed = codex_message(args, system_prompt, text)
                tag = f"{frame['id']}.a{attempt}"
                (run_dir / "codex" / f"{tag}.prompt.txt").write_text(composed, encoding="utf-8")
                return call_codex(args, composed, run_dir, tag)
        else:
            command = claude_command(args.model, system_prompt)
            workdir = stack.enter_context(tempfile.TemporaryDirectory(prefix="fold-eval-"))  # 空目录，避免读到项目说明文件

            def invoke(text: str, attempt: int) -> dict:
                if STOP.is_set():
                    raise FrameCancelled(frame["id"])
                return call_model(command, text, args.timeout, workdir)
        for attempt in range(1 + MAX_RETRIES):
            call = invoke(current, attempt + 1)
            entry = {"prompt_suffix": current[len(prompt):], "calls": call["calls"]}
            if call["response"] is None:
                entry["call_error"] = call["error"]
                record["attempts"].append(entry)
                break
            output = call["response"]["structured_output"]
            entry["response"] = call["response"]
            batch = batch_from_output(output, batch_id)
            receipt = store.commit(copy.deepcopy(batch), "assistant", frame["at"])
            entry["receipt"] = receipt
            record["attempts"].append(entry)
            print(f"  {frame['id']} 第 {attempt + 1} 次：{'接受 ' + receipt['type'] if receipt.get('accepted') else '拒绝 ' + receipt['error']['code']}",
                  file=sys.stderr)
            if receipt.get("accepted"):
                break
            current = prompt + retry_section(output, receipt)
    record["comparison"] = compare(prep, record)
    write_json(run_dir / f"{frame['id']}.json", record)
    return record


def batch_from_output(output: dict, batch_id: str) -> dict:
    batch = output.get("batch") or {}
    return {"batch_id": batch_id, "declarations": batch.get("declarations", []),
            "acknowledges": batch.get("acknowledges", [])}


def write_json(path: Path, value) -> None:
    path.write_text(dump(value) + "\n", encoding="utf-8")


# ---------- 对比 ----------

def relation_of(declaration: dict) -> dict:
    try:
        return kernel.parse_relation(declaration)
    except kernel.FoldError:
        return {"type": "invalid"}


def flatten(declarations, changed: set | None, depth: int = 0, parent=None) -> list[dict]:
    """展开嵌套声明。changed 为 None 表示批次未被接受，无法判断是否为空操作。"""
    result = []
    for declaration in declarations or []:
        if not isinstance(declaration, dict):
            continue
        relation = relation_of(declaration)
        refs = {s.get("ref") for s in declaration.get("sources") or [] if isinstance(s, dict)
                and str(s.get("ref", "")).startswith("event:")}
        item_id = declaration.get("id")
        effective = True
        if changed is not None and relation["type"] == "supersedes":
            effective = item_id in changed
        result.append({
            "id": item_id, "rel": relation["type"], "merges": relation.get("ids", []),
            "weight": declaration.get("weight"), "kind": declaration.get("kind"),
            "title": declaration.get("title"), "summary": declaration.get("summary"),
            "reason": declaration.get("reason"), "refs": sorted(refs), "depth": depth, "parent": parent,
            "effective": effective,
        })
        result.extend(flatten(declaration.get("children"), changed, depth + 1, item_id))
    return result


def bigram_similarity(a: str | None, b: str | None) -> float:
    def grams(text):
        text = (text or "").replace(" ", "")
        return {text[i:i + 2] for i in range(len(text) - 1)}
    ga, gb = grams(a), grams(b)
    return len(ga & gb) / len(ga | gb) if ga and gb else 0.0


def match_declarations(author: list[dict], agent: list[dict]) -> tuple[list[dict], list[dict], list[dict]]:
    """返回 (pairs, 未匹配的作者声明, 未匹配的 Agent 声明)，只考虑有效声明。"""
    author = [d for d in author if d["effective"]]
    agent = [d for d in agent if d["effective"]]
    agent_by_id = {d["id"]: d for d in agent}
    used: set[int] = set()
    pairs, unmatched_author = [], []
    for a in author:
        if a["rel"] not in ("supersedes", "withdraw"):
            continue
        g = agent_by_id.get(a["id"])
        if g is not None and g["rel"] in ("supersedes", "withdraw") and id(g) not in used:
            used.add(id(g))
            pairs.append({"author": a, "agent": g, "by": "id"})
        else:
            unmatched_author.append(a)
    new_author = [a for a in author if a["rel"] in ("new", "merges")]
    new_agent = [g for g in agent if g["rel"] in ("new", "merges") and id(g) not in used]
    candidates = []
    for ai, a in enumerate(new_author):
        for gi, g in enumerate(new_agent):
            if a["id"] == g["id"]:
                candidates.append((10.0, ai, gi, "id"))
                continue
            common = set(a["refs"]) & set(g["refs"])
            if not common:
                continue
            score = len(common) / len(set(a["refs"]) | set(g["refs"]))
            score += 0.25 if a["depth"] == g["depth"] else 0.0
            score += 0.2 * bigram_similarity(a["title"], g["title"])
            candidates.append((score, ai, gi, "refs"))
    taken_a, taken_g = set(), set()
    for score, ai, gi, by in sorted(candidates, key=lambda c: -c[0]):
        if ai in taken_a or gi in taken_g:
            continue
        taken_a.add(ai)
        taken_g.add(gi)
        used.add(id(new_agent[gi]))
        pairs.append({"author": new_author[ai], "agent": new_agent[gi], "by": by, "score": round(score, 3)})
    unmatched_author += [a for i, a in enumerate(new_author) if i not in taken_a]
    unmatched_agent = [g for g in agent if id(g) not in used]
    return pairs, unmatched_author, unmatched_agent


def weight_distance(a: str | None, b: str | None) -> int | None:
    if a in WEIGHTS and b in WEIGHTS:
        return abs(WEIGHTS.index(a) - WEIGHTS.index(b))
    return None


def final_attempt(record: dict) -> dict | None:
    with_response = [a for a in record["attempts"] if a.get("response")]
    return with_response[-1] if with_response else None


def compare(prep: dict, record: dict) -> dict:
    frame = prep["frame"]
    final = final_attempt(record)
    attempts = [a for a in record["attempts"] if a.get("response")]
    comparison: dict = {
        "responded": final is not None,
        "call_errors": [a["call_error"] for a in record["attempts"] if a.get("call_error")],
        "attempts": len(attempts),
        "rejection_codes": [a["receipt"]["error"]["code"] for a in attempts if not a["receipt"].get("accepted")],
        "first_rejected": bool(attempts) and not attempts[0]["receipt"].get("accepted"),
        "accepted": bool(final) and final["receipt"].get("accepted", False),
    }
    author_receipt = prep["author_receipt"]
    comparison["author_type"] = author_receipt["type"]
    author_store = MemoryStore()
    author_store.snapshot = prep["author_after"]
    comparison["author_used"] = author_store.state(frame["at"])["root"]["used"]
    comparison["author_acknowledges"] = prep["author_batch"]["acknowledges"]
    author_flat = flatten(prep["author_batch"]["declarations"], set(author_receipt["changed_ids"]))
    comparison["author_titles"] = [len(d["title"]) for d in author_flat if d["title"]]

    # (a) 处置
    output = final["response"]["structured_output"] if final else {}
    agent_disp = {}
    for entry in output.get("dispositions", []) or []:
        agent_disp.setdefault(entry.get("event"), entry)
    comparison["dispositions"] = [{
        "event": e["id"], "text": e["text"], "author": e.get("disposition"), "author_why": e.get("why"),
        "author_related": e.get("relatedIds", []),
        "agent": (agent_disp.get(e["id"]) or {}).get("disposition", "missing"),
        "agent_why": (agent_disp.get(e["id"]) or {}).get("why"),
        "agent_related": (agent_disp.get(e["id"]) or {}).get("related", []),
    } for e in frame["events"]]
    comparison["extra_dispositions"] = sorted(set(agent_disp) - {e["id"] for e in frame["events"]}, key=str)

    if not final:
        return comparison
    batch = batch_from_output(output, record["batch_id"])
    receipt = final["receipt"]
    agent_store = MemoryStore()
    agent_store.snapshot = copy.deepcopy(prep["base"])
    replay = agent_store.commit(copy.deepcopy(batch), "assistant", frame["at"])
    changed = set(replay["changed_ids"]) if replay.get("accepted") else None
    agent_flat = flatten(batch["declarations"], changed)
    comparison["agent_type"] = receipt.get("type") if receipt.get("accepted") else "rejected"
    comparison["agent_used"] = agent_store.state(frame["at"])["root"]["used"] if replay.get("accepted") else None
    comparison["agent_acknowledges"] = batch["acknowledges"]
    comparison["agent_titles"] = [len(d["title"]) for d in agent_flat if d["title"]]
    comparison["noop"] = {
        "author": [d["id"] for d in author_flat if not d["effective"]],
        "agent": [d["id"] for d in agent_flat if not d["effective"]],
    }

    # (b)(c) 条目匹配与档位
    pairs, unmatched_author, unmatched_agent = match_declarations(author_flat, agent_flat)
    comparison["pairs"] = [{
        "by": p["by"], "author_id": p["author"]["id"], "agent_id": p["agent"]["id"],
        "author_rel": p["author"]["rel"], "agent_rel": p["agent"]["rel"],
        "author_weight": p["author"]["weight"], "agent_weight": p["agent"]["weight"],
        "author_kind": p["author"]["kind"], "agent_kind": p["agent"]["kind"],
        "author_title": p["author"]["title"], "agent_title": p["agent"]["title"],
        "author_summary": p["author"]["summary"], "agent_summary": p["agent"]["summary"],
        "agent_reason": p["agent"]["reason"],
    } for p in pairs]
    keep = ("id", "rel", "merges", "weight", "kind", "title", "summary", "reason", "refs", "parent")
    comparison["unmatched_author"] = [{k: d[k] for k in keep} for d in unmatched_author]
    comparison["unmatched_agent"] = [{k: d[k] for k in keep} for d in unmatched_agent]
    comparison["author_effective"] = collections.Counter(d["rel"] for d in author_flat if d["effective"])
    comparison["agent_effective"] = collections.Counter(d["rel"] for d in agent_flat if d["effective"])

    # (d) 结构
    agent_merges = [set(d["merges"]) for d in agent_flat if d["rel"] == "merges"]
    agent_withdraws = {d["id"] for d in agent_flat if d["rel"] == "withdraw"}
    author_merges = [d for d in author_flat if d["rel"] == "merges"]
    author_withdraws = {d["id"] for d in author_flat if d["rel"] == "withdraw"}
    comparison["author_merges"] = [{"ids": d["merges"], "agent_merged": any(set(d["merges"]) <= m for m in agent_merges)}
                                   for d in author_merges]
    comparison["author_withdraws"] = [{"id": i, "agent_withdrew": i in agent_withdraws} for i in sorted(author_withdraws)]
    comparison["agent_extra_withdraws"] = sorted(agent_withdraws - author_withdraws)
    comparison["agent_extra_merges"] = [sorted(m) for m in agent_merges
                                        if not any(set(d["merges"]) == m for d in author_merges)]

    # 终态档位：作者结果中每个 active 条目，在 Agent 结果里是什么档位（新建条目按匹配映射 ID）
    if replay.get("accepted"):
        id_map = {p["author_id"]: p["agent_id"] for p in comparison["pairs"]}
        agent_items = agent_store.snapshot["items"]
        final_states = []
        for item in prep["author_after"]["items"].values():
            if item["status"] != "active":
                continue
            other = agent_items.get(id_map.get(item["id"], item["id"]))
            final_states.append({"id": item["id"], "author": item["weight"],
                                 "agent": other["weight"] if other and other["status"] == "active" else (other or {}).get("status", "absent")})
        comparison["final_states"] = final_states
    return comparison


# ---------- 汇总与报告 ----------

def ratio(numerator: int, denominator: int) -> str:
    return f"{numerator}/{denominator}（{numerator / denominator:.0%}）" if denominator else "不适用"


def summarize(records: list[dict]) -> dict:
    comparisons = [r["comparison"] for r in records if "comparison" in r]
    confusion = {a: collections.Counter() for a in DISPOSITIONS}
    disp_total = disp_agree = 0
    for c in comparisons:
        for d in c["dispositions"]:
            confusion.setdefault(d["author"], collections.Counter())[d["agent"]] += 1
            disp_total += 1
            disp_agree += d["author"] == d["agent"]
    pairs = [p for c in comparisons for p in c.get("pairs", [])]
    weighted = [p for p in pairs if "withdraw" not in (p["author_rel"], p["agent_rel"])]
    distances = [weight_distance(p["author_weight"], p["agent_weight"]) for p in weighted]
    author_counts = collections.Counter()
    agent_counts = collections.Counter()
    matched_by_rel = collections.Counter()
    for c in comparisons:
        author_counts.update(c.get("author_effective", {}))
        agent_counts.update(c.get("agent_effective", {}))
        for p in c.get("pairs", []):
            matched_by_rel[p["author_rel"]] += 1
    responded = [c for c in comparisons if c["responded"]]
    finals = [s for c in comparisons for s in c.get("final_states", [])]
    final_distances = [weight_distance(s["author"], s["agent"]) for s in finals]
    author_titles = [n for c in comparisons for n in c["author_titles"]]
    agent_titles = [n for c in comparisons for n in c.get("agent_titles", [])]
    merges = [m for c in comparisons for m in c.get("author_merges", [])]
    withdraws = [w for c in comparisons for w in c.get("author_withdraws", [])]
    return {
        "frames": len(records), "responded": len(responded),
        "dispositions": {"agree": disp_agree, "total": disp_total,
                         "confusion": {a: dict(confusion[a]) for a in confusion}},
        "items": {"author_effective": dict(author_counts), "agent_effective": dict(agent_counts),
                  "matched_by_author_rel": dict(matched_by_rel), "pairs": len(pairs)},
        "weights": {"compared": len(weighted), "exact": sum(d == 0 for d in distances),
                    "within_one": sum(d is not None and d <= 1 for d in distances),
                    "kind_equal": sum(p["author_kind"] == p["agent_kind"] for p in weighted),
                    "agent_higher": sum(d is not None and d > 0 and WEIGHTS.index(p["agent_weight"]) < WEIGHTS.index(p["author_weight"])
                                        for p, d in zip(weighted, distances)),
                    "agent_lower": sum(d is not None and d > 0 and WEIGHTS.index(p["agent_weight"]) > WEIGHTS.index(p["author_weight"])
                                       for p, d in zip(weighted, distances))},
        "final_states": {"compared": len(finals), "exact": sum(d == 0 for d in final_distances),
                         "within_one": sum(d is not None and d <= 1 for d in final_distances),
                         "absent_or_inactive": sum(d is None for d in final_distances)},
        "structure": {"author_merges": len(merges), "agent_reproduced_merges": sum(m["agent_merged"] for m in merges),
                      "author_withdraws": len(withdraws), "agent_reproduced_withdraws": sum(w["agent_withdrew"] for w in withdraws),
                      "agent_extra_withdraws": {r["frame"]: r["comparison"]["agent_extra_withdraws"] for r in records
                                                if r.get("comparison", {}).get("agent_extra_withdraws")},
                      "agent_extra_merges": {r["frame"]: r["comparison"]["agent_extra_merges"] for r in records
                                             if r.get("comparison", {}).get("agent_extra_merges")}},
        "rejections": {"first_rejected": sum(c["first_rejected"] for c in responded),
                       "final_accepted": sum(c["accepted"] for c in responded),
                       "codes": dict(collections.Counter(code for c in comparisons for code in c["rejection_codes"]))},
        "budget": {"author_mean": mean([c["author_used"] for c in responded]),
                   "agent_mean": mean([c["agent_used"] for c in responded if c.get("agent_used") is not None])},
        "titles": {"author_mean": mean(author_titles), "agent_mean": mean(agent_titles),
                   "author_count": len(author_titles), "agent_count": len(agent_titles),
                   "agent_max": max(agent_titles) if agent_titles else None},
        "result_types": dict(collections.Counter(f"{c['author_type']}→{c.get('agent_type')}" for c in responded)),
        "cost_usd": round(sum((a.get("response") or {}).get("total_cost_usd", 0) for r in records
                              for a in r.get("attempts", [])), 2),
        "model_calls": sum(a.get("calls", 0) for r in records for a in r.get("attempts", [])),
        "tokens": summarize_tokens(records),
        "tool_items": {r["frame"]: items for r in records
                       if (items := [i for a in r.get("attempts", []) for i in (a.get("response") or {}).get("tool_items", [])])},
    }


def summarize_tokens(records: list[dict]) -> dict:
    """成功响应的 token 合计与每帧平均（含被拒后的重试）；失败调用的用量不计入。"""
    totals: collections.Counter = collections.Counter()
    frames = set()
    for r in records:
        for a in r.get("attempts", []):
            usage = token_usage(a.get("response"))
            if usage:
                totals.update(usage)
                frames.add(r["frame"])
    per_frame = {k: round(v / len(frames)) for k, v in totals.items()} if frames else {}
    return {"total": dict(totals), "frames_with_usage": len(frames), "per_frame_mean": per_frame}


def mean(values: list) -> float | None:
    return round(sum(values) / len(values), 1) if values else None


def render_report(meta: dict, records: list[dict], summary: dict) -> str:
    s = summary
    tokens = s.get("tokens") or {}
    mean_tokens = tokens.get("per_frame_mean") or {}
    lines = [f"# Fold 判断评测：{meta['run_id']}", "",
             f"- 模型：`{meta['model']}`；runner：{meta.get('runner', 'claude')}；CLI：{meta.get('cli_version')}；调用：{meta.get('invocation')}",
             f"- SKILL.md：{meta.get('skill_path', 'skill/SKILL.md')}，sha256 `{meta['skill_sha256'][:12]}`；帧：{s['frames']}，有响应：{s['responded']}",
             "- 方法：teacher-forced，每帧起始状态 = 作者前序批次的内核回放；指标分别列出，不合成总分。", "",
             "## 汇总", "", "| 指标 | Agent | 作者 / 基准 |", "| --- | --- | --- |"]
    d = s["dispositions"]
    w = s["weights"]
    lines += [
        f"| (a) 处置一致率 | {ratio(d['agree'], d['total'])} | — |",
        f"| (b) 作者有效声明被匹配 | {ratio(s['items']['pairs'], sum(s['items']['author_effective'].values()))} | 作者有效声明 {s['items']['author_effective']} |",
        f"| (b) Agent 有效声明 | {s['items']['agent_effective']} | 按作者关系匹配 {s['items']['matched_by_author_rel']} |",
        f"| (c) 档位完全一致 | {ratio(w['exact'], w['compared'])} | — |",
        f"| (c) 档位相差一档以内 | {ratio(w['within_one'], w['compared'])} | Agent 更高 {w['agent_higher']}，更低 {w['agent_lower']} |",
        f"| (c) kind 一致 | {ratio(w['kind_equal'], w['compared'])} | — |",
        f"| (d) 复现作者的合并 | {ratio(s['structure']['agent_reproduced_merges'], s['structure']['author_merges'])} | — |",
        f"| (d) 复现作者的撤下 | {ratio(s['structure']['agent_reproduced_withdraws'], s['structure']['author_withdraws'])} | — |",
        f"| (e) 首次提交被拒 | {ratio(s['rejections']['first_rejected'], s['responded'])} | 最终接受 {s['rejections']['final_accepted']}；code {s['rejections']['codes']} |",
        f"| (f) 根层平均已用份额 | {s['budget']['agent_mean']} | {s['budget']['author_mean']} |",
        f"| (g) 标题平均长度 | {s['titles']['agent_mean']}（{s['titles']['agent_count']} 个，最长 {s['titles']['agent_max']}） | {s['titles']['author_mean']}（{s['titles']['author_count']} 个） |",
        f"| 终态档位一致（作者结果中的 active 条目） | {ratio(s['final_states']['exact'], s['final_states']['compared'])} | 相差一档以内 {s['final_states']['within_one']}；Agent 侧不存在或非 active {s['final_states']['absent_or_inactive']} |",
        f"| 结果类型 作者→Agent | {s['result_types']} | — |",
        f"| 调用 | {s['model_calls']} 次，" + (f"约 {s['cost_usd']} 美元" if s["cost_usd"] else "未计美元") + " | — |",
        f"| 每帧平均 token | 输入 {mean_tokens.get('input')}（缓存 {mean_tokens.get('cached')}），"
        f"输出 {mean_tokens.get('output')}（推理 {mean_tokens.get('reasoning')}） | 合计 {tokens.get('total')} |",
        f"| 非消息条目（工具调用等） | {s.get('tool_items') or '无'} | — |", "",
        "## 处置混淆矩阵（行：作者，列：Agent）", "",
        "| 作者 \\ Agent | " + " | ".join(DISPOSITIONS + ("missing",)) + " |",
        "| --- |" + " --- |" * (len(DISPOSITIONS) + 1)]
    for author in DISPOSITIONS:
        row = d["confusion"].get(author, {})
        lines.append(f"| {author} | " + " | ".join(str(row.get(a, 0)) for a in DISPOSITIONS + ("missing",)) + " |")
    lines += ["", "## Agent 额外的撤下与合并", "",
              f"- 撤下：{s['structure']['agent_extra_withdraws'] or '无'}",
              f"- 合并：{s['structure']['agent_extra_merges'] or '无'}", "",
              "## 逐帧", "",
              "| 帧 | 输入 | 处置一致 | 作者/Agent 有效声明 | 匹配 | 档位一致 | 尝试 | 拒绝 code | 结果类型 | 已用 作者/Agent | 确认 作者/Agent |",
              "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    for r in records:
        c = r.get("comparison")
        if not c:
            continue
        agree = sum(x["author"] == x["agent"] for x in c["dispositions"])
        pairs = c.get("pairs", [])
        exact = sum(p["author_weight"] == p["agent_weight"] for p in pairs if "withdraw" not in (p["author_rel"], p["agent_rel"]))
        compared = sum(1 for p in pairs if "withdraw" not in (p["author_rel"], p["agent_rel"]))
        lines.append(
            f"| {r['frame']} | {len(c['dispositions'])} | {agree}/{len(c['dispositions'])} | "
            f"{sum(c.get('author_effective', {}).values())}/{sum(c.get('agent_effective', {}).values())} | {len(pairs)} | "
            f"{exact}/{compared} | {c['attempts']} | {','.join(c['rejection_codes']) or '—'} | "
            f"{c['author_type']}→{c.get('agent_type')} | {c['author_used']}/{c.get('agent_used')} | "
            f"{','.join(c['author_acknowledges']) or '—'}/{','.join(c.get('agent_acknowledges', [])) or '—'} |")
    lines += ["", "## 逐帧明细", ""]
    for r in records:
        c = r.get("comparison")
        if not c:
            continue
        lines += [f"### {r['frame']}", ""]
        if c["call_errors"]:
            lines.append(f"- 调用失败：{c['call_errors']}")
        for x in c["dispositions"]:
            mark = "" if x["author"] == x["agent"] else " **≠**"
            lines.append(f"- `{x['event']}` 作者 {x['author']} / Agent {x['agent']}{mark}：{x['text'][:40]}…"
                         + (f"\n  - 作者：{x['author_why']}\n  - Agent：{x['agent_why']}" if mark else ""))
        for p in c.get("pairs", []):
            lines.append(f"- 匹配（{p['by']}）`{p['author_id']}`↔`{p['agent_id']}`：{p['author_rel']}/{p['agent_rel']}，"
                         f"{p['author_weight']}/{p['agent_weight']}，{p['author_kind']}/{p['agent_kind']}；"
                         f"标题「{p['author_title'] or '（保留）'}」/「{p['agent_title'] or '（保留）'}」")
        for u in c.get("unmatched_author", []):
            lines.append(f"- 作者有、Agent 无：`{u['id']}` {u['rel']} {u['weight']} {u['kind']}「{u['title'] or ''}」{u['summary'] or ''}")
        for u in c.get("unmatched_agent", []):
            lines.append(f"- Agent 有、作者无：`{u['id']}` {u['rel']} {u['weight']} {u['kind']}「{u['title'] or ''}」{u['summary'] or ''}"
                         + (f"（reason：{u['reason']}）" if u.get("reason") else ""))
        if c.get("noop", {}).get("author") or c.get("noop", {}).get("agent"):
            lines.append(f"- 空操作声明 作者 {c['noop']['author']} / Agent {c['noop']['agent']}")
        lines.append("")
    return "\n".join(lines) + "\n"


# ---------- 自由运行：真实语料，状态逐帧前传 ----------

FREE_MAX_RETRIES = 3              # 被拒后最多再要 3 次
FREE_EVENT_LIMIT = 60             # 每帧超过 60 条或 2 万字符时，截断单条正文
FREE_CHAR_LIMIT = 20_000
FREE_TEXT_CAP = 1500
TEXT_CAP_OVERRIDE = None          # --text-cap：估算超出预算时把截断收紧到更短
# 估算用的单价（美元 / 百万 token），由 2026-10-14 全量运行 38 次调用的 usage 与 total_cost_usd 拟合：
# claude -p 把输入写入 1 小时缓存（写入价），重复的系统提示按缓存读取计价。只用于 --dry-run 的估算。
PRICE_PER_MTOK = {"cache_write": 8.0, "cache_read": 0.4, "output": 20.0}
TOKEN_OVERHEAD = 3500             # claude -p 结构化输出工具等固定开销，同一次运行实测约 3.5k–4.8k
LANGUAGE_NOTE = ("用户的工作语言是英文，输入多为英文。整理结果（标题、摘要、理由、处置说明）用中文写；"
                 "项目名、人名与账号、issue/PR 编号、版本号、代码标识与命令保留英文原文。")
SELF_NOTE = ("本轮输入里 `self: true` 的事件是用户本人发出的：任何渠道里他的评论、评审、关闭与合并、帖子、提问与回复、邮件。"
             "它们相当于用户自己的动作与回复，用来判断哪些事已经处理、他关心什么，不是等他处理的来信。")
STREAM_NOTE = ("输入的 `stream` 是宿主按来源给的粗分类：work（工作）、community（社区与爱好）、life（生活琐事）、"
               "family（家人、朋友、邻居与家务相关的通知）、subscription（订阅、营销与提醒）。它只说明从哪条渠道来，不代表重要性。")


def estimate_tokens(text: str) -> int:
    """粗估 token：CJK 字符按 1 个计，其余按 3.3 字符一个，再乘 1.2 的余量（用上次运行的实测校准）。"""
    cjk = len(re.findall(r"[　-鿿＀-￯]", text))
    return round((cjk + (len(text) - cjk) / 3.3) * 1.2)


def load_corpus(path: str) -> dict:
    corpus = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(corpus.get("frames"), list):
        raise SystemExit(f"{path} 不是帧序列（缺少 frames）")
    return corpus


def free_visible_events(frame: dict) -> tuple[list[dict], list[dict]]:
    """交给模型的输入：id/channel/from/at/subject/url/text、是否本人，以及语料带有时的 stream。

    不交作者类别（bot/automation 由公开资料推断）、线程、kind、origin 等语料构建时的标注。每帧超过 60 条
    或 2 万字符时，单条正文截到 1500 字符（--text-cap 可收紧）并记原长；不删条目。返回 (可见事件, 截断记录)。
    """
    events = frame["events"]
    total = sum(len(e.get("text") or "") for e in events)
    cap = FREE_TEXT_CAP if len(events) > FREE_EVENT_LIMIT or total > FREE_CHAR_LIMIT else None
    if cap and TEXT_CAP_OVERRIDE:
        cap = TEXT_CAP_OVERRIDE
    visible, truncated = [], []
    for e in events:
        text = e.get("text") or ""
        item = {"id": e["id"], "channel": e["channel"], "from": e["from"], "at": e["at"]}
        if e.get("stream"):
            item["stream"] = e["stream"]
        if e.get("subject"):
            item["subject"] = e["subject"]
        if e.get("url"):
            item["url"] = e["url"]
        item["self"] = e.get("author_kind") == "self"
        original = e.get("text_length", len(text))
        if cap and len(text) > cap:
            text = text[:cap] + "…"
            truncated.append({"event": e["id"], "original_length": original, "shown": cap})
        if len(text) < original:
            item["text_length"] = original  # 语料构建或本轮截断过，给出原长
        item["text"] = text
        visible.append(item)
    return visible, truncated


def free_persona(corpus: dict, override: str | None) -> dict:
    persona = copy.deepcopy(corpus.get("persona") or {})
    if override is not None:
        persona["context"] = override
    persona["language"] = LANGUAGE_NOTE
    if any(e.get("stream") == "family" for f in corpus["frames"] for e in f["events"]):
        persona["language"] += "家人、朋友与邻居之间的往来是瑞典语，同样用中文整理，人名与原话保留原文。"
    persona["self_events"] = SELF_NOTE
    if any(e.get("stream") for f in corpus["frames"] for e in f["events"][:1]):
        persona["streams"] = STREAM_NOTE
    return persona


def build_free_prompt(corpus: dict, persona: dict, frame: dict, state: dict, batch_id: str) -> tuple[str, list[dict]]:
    events, truncated = free_visible_events(frame)
    feedback = corpus.get("feedback") or "宿主未提供业务用途与反馈策略。这份状态供用户回来时阅读：先看到需要他处理的事，也知道其余事项的主要进展。"
    sections = [
        f"# 本轮整理\n\nnow: {frame['at']}\nbatch_id: {batch_id}（由宿主附加到批次，你不必输出）",
        "## 用户背景\n\n" + dump(persona),
        "## 业务用途与反馈约定\n\n" + (feedback if isinstance(feedback, str) else dump(feedback)),
        "## 当前状态（state）\n\n这是你自己上一轮提交后的状态，按本轮 now 投影。\n\n" + dump(state),
        "## 待确认批注\n\n" + dump(state["pending_annotations"]),
        "## 宿主信号\n\n" + dump(frame.get("signal")),
        "## 本轮输入\n\n" + dump(events),
        "## 输出\n\n按 skill 的接口输出一个 JSON 对象：dispositions 覆盖上面每一个输入事件（包括 self 为 true 的事件）；"
        "batch 只含 declarations 与 acknowledges。",
    ]
    return "\n\n".join(sections) + "\n", truncated


def free_frame_record_path(run_dir: Path, frame_id: str) -> Path:
    return run_dir / f"{frame_id}.json"


def response_cost(response: dict | None) -> float:
    return float((response or {}).get("total_cost_usd") or 0)


def run_free(args, corpus: dict, system_prompt: str, run_dir: Path, meta: dict) -> list[dict]:
    """顺序运行全部帧。已有记录（--resume）按记录里的接受批次重放，验证 revision 后继续。"""
    persona = free_persona(corpus, args.persona_context)
    frames = corpus["frames"]
    if args.frames:
        wanted = {f.strip() for f in args.frames.split(",") if f.strip()}
        last = max(i for i, f in enumerate(frames) if f["id"] in wanted) if wanted else -1
        frames = frames[:last + 1]  # 状态前传：只能从第一帧跑到所选的最后一帧
    store = MemoryStore()
    records: list[dict] = []
    spent = 0.0
    command = claude_command(args.model, system_prompt)
    with tempfile.TemporaryDirectory(prefix="fold-free-") as workdir:
        for frame in frames:
            path = free_frame_record_path(run_dir, frame["id"])
            batch_id = f"free-{frame['id']}"
            if args.resume and path.exists():
                record = json.loads(path.read_text(encoding="utf-8"))
                if record.get("status") in ("accepted", "skipped"):
                    if record["status"] == "accepted":
                        receipt = store.commit(copy.deepcopy(record["batch"]), "assistant", frame["at"])
                        if not receipt.get("accepted") or receipt["revision"] != record["receipt"]["revision"]:
                            raise SystemExit(f"续跑重放 {frame['id']} 与记录不一致：{receipt}")
                    spent += record.get("cost_usd", 0)
                    records.append(record)
                    continue
            state = store.state(frame["at"])
            prompt, truncated = build_free_prompt(corpus, persona, frame, state, batch_id)
            record = {"frame": frame["id"], "at": frame["at"], "batch_id": batch_id, "prompt": prompt,
                      "truncated": truncated, "state_before_revision": state["revision"], "attempts": []}
            if args.dry_run:
                record["status"] = "dry-run"
                write_json(path, record)
                records.append(record)
                continue
            if spent >= args.max_cost:
                print(f"已花费 {spent:.2f} 美元，达到上限 {args.max_cost}，停止于 {frame['id']}", file=sys.stderr)
                meta["stopped"] = {"kind": "max_cost", "spent": round(spent, 2), "at_frame": frame["id"]}
                break
            current = prompt
            record["status"] = "skipped"
            for attempt in range(1 + FREE_MAX_RETRIES):
                call = call_model(command, current, args.timeout, workdir)
                entry = {"prompt_suffix": current[len(prompt):], "calls": call["calls"]}
                record["attempts"].append(entry)
                if call["response"] is None:
                    entry["call_error"] = call["error"]
                    record["status"] = "call_failed"
                    break
                entry["response"] = call["response"]
                spent += response_cost(call["response"])
                output = call["response"]["structured_output"]
                batch = batch_from_output(output, batch_id)
                receipt = store.commit(copy.deepcopy(batch), "assistant", frame["at"])
                entry["receipt"] = receipt
                print(f"  {frame['id']} 第 {attempt + 1} 次：{'接受 ' + receipt['type'] if receipt.get('accepted') else '拒绝 ' + receipt['error']['code']}"
                      f"（累计 {spent:.2f} 美元）", file=sys.stderr)
                if receipt.get("accepted"):
                    record.update(status="accepted", batch=batch, receipt=receipt, dispositions=output.get("dispositions", []))
                    break
                current = prompt + retry_section(output, receipt)
            final = final_attempt(record)
            if record["status"] != "accepted" and final:
                record["dispositions"] = final["response"]["structured_output"].get("dispositions", [])
            record["state_after"] = store.state(frame["at"])
            record["cost_usd"] = round(sum(response_cost(a.get("response")) for a in record["attempts"]), 4)
            record["tokens"] = [token_usage(a.get("response")) for a in record["attempts"] if a.get("response")]
            write_json(path, record)
            records.append(record)
            if record["status"] == "call_failed":
                meta["stopped"] = {"kind": "call_failed", "at_frame": frame["id"], "error": record["attempts"][-1]["call_error"]}
                break
    meta["spent_usd"] = round(spent, 2)
    return records


def free_estimate(records: list[dict], system_prompt: str) -> dict:
    """dry-run 的估算。状态在 dry-run 中始终为空，按每帧增长 1.2k token、上限 30k 假设。"""
    system = estimate_tokens(system_prompt)
    rows, total = [], collections.Counter()
    for index, record in enumerate(records):
        events = len(json.loads(record["prompt"].split("## 本轮输入\n\n", 1)[1].split("\n\n## 输出", 1)[0]))
        prompt_tokens = estimate_tokens(record["prompt"])
        state_tokens = min(1200 * index, 30_000)
        write = prompt_tokens + state_tokens + TOKEN_OVERHEAD
        output = 60 * events + 6000  # 每条处置约 60 token，批次与推理约 6k
        cost = (write * PRICE_PER_MTOK["cache_write"] + system * PRICE_PER_MTOK["cache_read"]
                + output * PRICE_PER_MTOK["output"]) / 1e6
        rows.append({"frame": record["frame"], "events": events, "prompt_tokens": prompt_tokens,
                     "assumed_state_tokens": state_tokens, "output_tokens": output, "cost_usd": round(cost, 3),
                     "truncated": len(record.get("truncated", []))})
        total.update({"input": write + system, "output": output})
        total["cost"] += cost
    return {"system_tokens": system, "frames": rows, "input_tokens": total["input"], "output_tokens": total["output"],
            "cost_usd": round(total["cost"], 2), "cost_usd_with_retries": round(total["cost"] * 1.25, 2),
            "assumptions": "状态每帧 +1.2k token（上限 30k）；输出 = 60×输入条数 + 6k；25% 的帧重试一次；单价见 PRICE_PER_MTOK"}


def free_score(corpus: dict, labels: dict, records: list[dict]) -> dict:
    """与弱标注的三项对照。只计接受或沿用的帧；弱依据的忽略单列，不计入主指标。"""
    label_frames = {f["frame"]: f for f in labels.get("frames", [])}
    corpus_frames = {f["id"]: f for f in corpus["frames"]}
    ignore = collections.Counter()
    groups = collections.Counter()
    pairs = collections.Counter()
    tiers = collections.Counter()
    per_frame = []
    tier_score = {"noise": 0, "untouched": 0, "delegated": 1, "later": 2, "engaged": 3}
    stream_of = {e["id"]: e.get("stream") for f in corpus["frames"] for e in f["events"]}
    by_stream: collections.Counter = collections.Counter()
    for record in records:
        lf = label_frames.get(record["frame"])
        cf = corpus_frames.get(record["frame"])
        if not lf or not cf or record.get("status") not in ("accepted", "skipped"):
            continue
        self_ids = {e["id"] for e in cf["events"] if e.get("author_kind") == "self"}
        disp = {d.get("event"): d.get("disposition") for d in record.get("dispositions") or []}
        agent_ignored = {e for e, d in disp.items() if d in ("noise", "duplicate") and e not in self_ids}
        strong = {i["event"] for i in lf["ignore"] if "in_active_item" not in i["basis"]}
        weak = {i["event"] for i in lf["ignore"] if "in_active_item" in i["basis"]}
        row = {"frame": record["frame"], "agent_ignored": len(agent_ignored), "strong": len(strong),
               "strong_hit": len(agent_ignored & strong), "weak": len(weak), "weak_hit": len(agent_ignored & weak)}
        ignore.update({"agent_ignored": len(agent_ignored), "strong": len(strong), "strong_hit": len(agent_ignored & strong),
                       "weak": len(weak), "weak_hit": len(agent_ignored & weak),
                       "any_hit": len(agent_ignored & (strong | weak))})
        # 与行为不矛盾的忽略：输入所在事项本人此后从未跟进（untouched）或本身是噪音档。弱标注的忽略列表只收低信息量输入，
        # 有实质内容但没人理的社区帖不在其中；这一列把它们算作“不矛盾”，单列，不替代精确率。
        quiet = {e for item in lf["items"] if item["tier"] in ("untouched", "noise") and not item.get("high") for e in item["events"]}
        ignore["consistent_hit"] += len(agent_ignored & (strong | weak | quiet))
        # 事件 → 引用它的条目（任何状态），以及条目的根层祖先与根层份额。
        state = record["state_after"]
        items = {}

        def walk(layer, root_id, root_share):
            for item in (layer or {}).get("items", []):
                rid = root_id or item["id"]
                rshare = root_share if root_id else item["share"]
                items[item["id"]] = {"root": rid, "root_share": rshare, "active": True, "sources": item.get("sources") or []}
                walk(item.get("children"), rid, rshare)
        walk(state["root"], None, None)
        cited = collections.defaultdict(set)
        for item_id, info in items.items():
            for source in info["sources"]:
                ref = str(source.get("ref", ""))
                if ref.startswith("event:"):
                    cited[ref[6:]].add(item_id)
        # (2) 同组输入是否进同一声明：组内被引用的事件两两比较，同一条目算一致，同一根层事项另计。
        frame_groups = {"pairs": 0, "same_item": 0, "same_root": 0, "cross_pairs": 0, "cross_same_root": 0}
        for group in lf["groups"]:
            members = [e for e in group["events"] if e not in self_ids and cited.get(e)]
            cross = len(group["threads"]) > 1
            for a, b in itertools.combinations(members, 2):
                same_item = bool(cited[a] & cited[b])
                same_root = bool({items[i]["root"] for i in cited[a]} & {items[i]["root"] for i in cited[b]})
                frame_groups["pairs"] += 1
                frame_groups["same_item"] += same_item
                frame_groups["same_root"] += same_root
                if cross:
                    frame_groups["cross_pairs"] += 1
                    frame_groups["cross_same_root"] += same_root
            groups["groups"] += 1
            groups["groups_cited"] += bool(members)
        groups.update(frame_groups)
        row["group_pairs"] = frame_groups["pairs"]
        row["group_same_root"] = frame_groups["same_root"]
        # (3) 同帧事项成对排序：线程的 Agent 份额 = 引用其任一输入的 active 条目的根层份额最大值，未纳入为 0。
        scored = []
        for label_item in lf["items"]:
            shares = [items[i]["root_share"] for e in label_item["events"] for i in cited.get(e, ())]
            share = max(shares) if shares else 0
            score = 4 if label_item.get("high") else tier_score.get(label_item["tier"], 0)
            scored.append((score, share))
            tier = "high" if label_item.get("high") else label_item["tier"]
            stream = stream_of.get(label_item["events"][0]) if label_item["events"] else None
            if stream:
                acted = "acted" if tier in ("high", "engaged", "later") else tier
                by_stream[(stream, acted, "total")] += 1
                by_stream[(stream, acted, "included")] += share > 0
                by_stream[(stream, acted, "ge6")] += share >= 6
            tiers[f"{tier}:total"] += 1
            tiers[f"{tier}:included"] += share > 0
            tiers[f"{tier}:ge12"] += share >= 12
            tiers[f"{tier}:ge6"] += share >= 6
        for (sa, aa), (sb, ab) in itertools.combinations(scored, 2):
            if sa == sb:
                continue
            hi, lo = ((aa, ab) if sa > sb else (ab, aa))
            pairs["compared"] += 1
            pairs["concordant"] += hi > lo
            pairs["tied"] += hi == lo
            pairs["discordant"] += hi < lo
        per_frame.append(row)
    def rate(a, b):
        return round(a / b, 3) if b else None
    return {
        "ignore": {**ignore, "recall_strong": rate(ignore["strong_hit"], ignore["strong"]),
                   "precision_strong": rate(ignore["strong_hit"], ignore["agent_ignored"]),
                   "precision_any": rate(ignore["any_hit"], ignore["agent_ignored"]),
                   "recall_weak": rate(ignore["weak_hit"], ignore["weak"]),
                   "precision_consistent": rate(ignore["consistent_hit"], ignore["agent_ignored"])},
        "groups": {**groups, "same_item_rate": rate(groups["same_item"], groups["pairs"]),
                   "same_root_rate": rate(groups["same_root"], groups["pairs"]),
                   "cross_same_root_rate": rate(groups["cross_same_root"], groups["cross_pairs"])},
        "ranking": {**pairs, "concordance": rate(pairs["concordant"], pairs["compared"]),
                    "concordance_ties_half": rate(pairs["concordant"] + pairs["tied"] / 2, pairs["compared"])},
        "tiers": {tier: {"total": tiers[f"{tier}:total"], "included": tiers[f"{tier}:included"],
                         "share_ge_12": tiers[f"{tier}:ge12"], "share_ge_6": tiers[f"{tier}:ge6"]}
                  for tier in ("high", "engaged", "later", "delegated", "untouched", "noise")},
        "per_frame": per_frame,
        # 分流的召回：本人后来有行动的事项（high/engaged/later 合称 acted）按流统计纳入与份额；语料没有 stream 时为空。
        "by_stream": {f"{s}:{tier}": {"total": by_stream[(s, tier, "total")], "included": by_stream[(s, tier, "included")],
                                      "share_ge_6": by_stream[(s, tier, "ge6")]}
                      for s in ("work", "community", "life", "subscription")
                      for tier in ("acted", "delegated", "untouched", "noise") if by_stream[(s, tier, "total")]},
    }


def free_summary(records: list[dict]) -> dict:
    statuses = collections.Counter(r.get("status") for r in records)
    attempts = [a for r in records for a in r.get("attempts", []) if a.get("receipt")]
    codes = collections.Counter(a["receipt"]["error"]["code"] for a in attempts if not a["receipt"].get("accepted"))
    disp = collections.Counter(d.get("disposition") for r in records for d in r.get("dispositions") or [])
    last = next((r["state_after"] for r in reversed(records) if r.get("state_after")), None)
    return {
        "frames": len(records), "statuses": dict(statuses), "rejection_codes": dict(codes),
        "first_rejected": sum(1 for r in records if r.get("attempts") and r["attempts"][0].get("receipt")
                              and not r["attempts"][0]["receipt"].get("accepted")),
        "dispositions": dict(disp), "truncated_events": sum(len(r.get("truncated", [])) for r in records),
        "cost_usd": round(sum(r.get("cost_usd", 0) for r in records), 2),
        "model_calls": sum(a.get("calls", 0) for r in records for a in r.get("attempts", [])),
        "tokens": summarize_tokens(records),
        "final_root": {"used": last["root"]["used"], "items": len(last["root"]["items"]),
                       "not_active": len(last["not_active"])} if last else None,
        "root_used_by_frame": {r["frame"]: r["state_after"]["root"]["used"] for r in records if r.get("state_after")},
    }


def stream_breakdown(records: list[dict], corpus: dict) -> dict | None:
    """语料带 stream 时：各流的处置分布，以及根层份额按依据来自哪条流分摊（逐帧平均）。

    一件根层事项的份额按它（含子项）引用到的输入所属的流平均分摊；没有引用输入的记入 none。
    """
    stream_of = {e["id"]: e.get("stream") for f in corpus["frames"] for e in f["events"]}
    if not any(stream_of.values()):
        return None
    disp: dict = collections.defaultdict(collections.Counter)
    self_disp: dict = collections.defaultdict(collections.Counter)
    by_frame = {r["frame"]: r for r in records}
    for frame in corpus["frames"]:
        record = by_frame.get(frame["id"])
        judged = {d["event"]: d.get("disposition") for d in (record or {}).get("dispositions") or []}
        for e in frame["events"]:
            (self_disp if e.get("author_kind") == "self" else disp)[e.get("stream")][judged.get(e["id"], "unjudged")] += 1

    def streams(item: dict) -> list[str]:
        refs = [s.get("ref", "") for s in item.get("sources") or []]
        for child in item.get("children") or []:
            refs += [s.get("ref", "") for s in child.get("sources") or []]
        found = [stream_of.get(r[6:]) for r in refs if r.startswith("event:")]
        return [s for s in found if s] or ["none"]

    share: collections.Counter = collections.Counter()
    frames_counted = 0
    for record in records:
        state = record.get("state_after")
        if not state:
            continue
        frames_counted += 1
        for item in state["root"]["items"]:
            found = streams(item)
            for s in found:
                share[s] += item["share"] / len(found)
    return {"dispositions": {k: dict(v) for k, v in disp.items()}, "self": {k: dict(v) for k, v in self_disp.items()},
            "mean_root_share": {k: round(v / max(frames_counted, 1), 1) for k, v in share.most_common()}}


def render_free_report(meta: dict, summary: dict, score: dict | None) -> str:
    s = summary
    lines = [f"# Fold 自由运行：{meta['run_id']}", "",
             f"- 语料：`{meta['corpus']}`；模型：`{meta['model']}`；CLI：{meta.get('cli_version')}；调用：{meta.get('invocation')}",
             f"- SKILL.md sha256 `{meta['skill_sha256'][:12]}`；帧 {s['frames']}，状态 {s['statuses']}",
             f"- 费用 {s['cost_usd']} 美元，调用 {s['model_calls']} 次；首次被拒 {s['first_rejected']} 帧，拒绝 code {s['rejection_codes']}",
             f"- 截断正文 {s['truncated_events']} 条；处置分布 {s['dispositions']}；末帧根层 {s['final_root']}", ""]
    if s.get("streams"):
        st = s["streams"]
        lines += ["## 各流", "", "他人发来的输入怎样处置，以及根层 64 份平均有多少来自这条流（按事项引用的输入分摊）。", "",
                  "| 流 | 采用 | 重复 | 暂缓 | 噪音 | 未判 | 本人发言 | 根层平均份额 |", "| --- | --- | --- | --- | --- | --- | --- | --- |"]
        for name in ["work", "community", "life", "subscription", "none"]:
            d = st["dispositions"].get(name, {})
            mine = sum(st["self"].get(name, {}).values())
            if not d and name not in st["mean_root_share"]:
                continue
            lines.append(f"| {name} | {d.get('used', 0)} | {d.get('duplicate', 0)} | {d.get('deferred', 0)} | {d.get('noise', 0)} | "
                         f"{d.get('unjudged', 0)} | {mine} | {st['mean_root_share'].get(name, 0)} |")
        lines.append("")
    if score:
        ig, gr, rk = score["ignore"], score["groups"], score["ranking"]
        lines += ["## 与弱标注对照", "", "| 指标 | 值 |", "| --- | --- |",
                  f"| 忽略：强依据召回 | {ig['strong_hit']}/{ig['strong']}（{ig['recall_strong']}） |",
                  f"| 忽略：精确率（只算强依据 / 强弱都算） | {ig['precision_strong']} / {ig['precision_any']}（Agent 忽略 {ig['agent_ignored']} 条） |",
                  f"| 忽略：弱依据召回（单列） | {ig['weak_hit']}/{ig['weak']}（{ig['recall_weak']}） |",
                  f"| 忽略：与行为不矛盾（含 untouched 与 noise 档事项的输入） | {ig.get('consistent_hit')}/{ig['agent_ignored']}（{ig.get('precision_consistent')}） |",
                  f"| 同组输入进同一条目 / 同一根层事项 | {gr['same_item_rate']} / {gr['same_root_rate']}（{gr['pairs']} 对） |",
                  f"| 跨线程组进同一根层事项 | {gr['cross_same_root_rate']}（{gr['cross_pairs']} 对） |",
                  f"| 成对排序一致（平局记半） | {rk['concordance']}（{rk['concordant']}/{rk['compared']}，平 {rk['tied']}）/ {rk['concordance_ties_half']} |",
                  "", "| 弱档位 | 事项帧数 | 纳入 | 根层份额 ≥12 | ≥6 |", "| --- | --- | --- | --- | --- |"]
        for tier, row in score["tiers"].items():
            lines.append(f"| {tier} | {row['total']} | {row['included']} | {row['share_ge_12']} | {row['share_ge_6']} |")
        if score.get("by_stream"):
            lines += ["", "分流的召回：按输入所在的流统计事项帧（acted = 本人后来有行动：high、engaged、later）。", "",
                      "| 流 · 弱档位 | 事项帧数 | 纳入 | 根层份额 ≥6 |", "| --- | --- | --- | --- |"]
            for key, row in score["by_stream"].items():
                lines.append(f"| {key.replace(':', ' · ')} | {row['total']} | {row['included']} | {row['share_ge_6']} |")
        lines += ["", "## 逐帧", "", "| 帧 | Agent 忽略 | 强依据命中/总数 | 弱依据命中/总数 | 组内对 | 同根层 | 根层已用 |",
                  "| --- | --- | --- | --- | --- | --- | --- |"]
        used = s["root_used_by_frame"]
        for row in score["per_frame"]:
            lines.append(f"| {row['frame']} | {row['agent_ignored']} | {row['strong_hit']}/{row['strong']} | {row['weak_hit']}/{row['weak']} | "
                         f"{row['group_pairs']} | {row['group_same_root']} | {used.get(row['frame'])} |")
    return "\n".join(lines) + "\n"


def main_free(args, parser) -> int:
    corpus = load_corpus(args.corpus)
    labels_path = Path(args.labels) if args.labels else Path(args.corpus).with_name("labels.json")
    labels = json.loads(labels_path.read_text(encoding="utf-8")) if labels_path.exists() else None
    skill_path = Path(args.skill).resolve()
    skill_text = skill_path.read_text(encoding="utf-8")
    system_prompt = SYSTEM_PREAMBLE + skill_text + "\n</skill>\n"
    if args.rescore:
        run_dir = Path(args.rescore)
        meta = json.loads((run_dir / "meta.json").read_text(encoding="utf-8"))
        order = {f["id"]: i for i, f in enumerate(corpus["frames"])}
        records = sorted((json.loads(p.read_text(encoding="utf-8")) for p in run_dir.glob("f*.json")),
                         key=lambda r: order.get(r["frame"], 1e9))
    else:
        if args.resume and not args.run_id:
            parser.error("--resume 需要 --run-id")
        run_id = args.run_id or "free-" + datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        run_dir = ROOT / ".local" / "eval" / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        meta = {"run_id": run_id, "mode": "free-run", "runner": "claude", "model": args.model,
                "corpus": display_path(Path(args.corpus).resolve()), "labels": display_path(labels_path.resolve()) if labels else None,
                "cli_version": cli_version("claude"), "invocation": invocation(args), "skill_path": display_path(skill_path),
                "skill_sha256": hashlib.sha256(skill_text.encode()).hexdigest(), "max_cost": args.max_cost,
                "text_cap": args.text_cap or FREE_TEXT_CAP,
                "persona_context": args.persona_context if args.persona_context is not None else "（语料原文）",
                "started_at": datetime.datetime.now().isoformat(), "dry_run": args.dry_run}
        if args.resume:
            old = json.loads((run_dir / "meta.json").read_text(encoding="utf-8"))
            for key in ("model", "skill_sha256", "corpus", "persona_context", "text_cap"):
                if old.get(key) != meta.get(key):
                    parser.error(f"--resume 的条件与原运行不同：{key} {old.get(key)!r} → {meta.get(key)!r}")
            old.setdefault("resumed", []).append({"at": meta["started_at"], "previous_stop": old.pop("stopped", None)})
            old["max_cost"] = args.max_cost
            meta = old
        write_json(run_dir / "meta.json", meta)
        write_json(run_dir / "schema.json", OUTPUT_SCHEMA)
        (run_dir / "system-prompt.txt").write_text(system_prompt, encoding="utf-8")
        print(f"自由运行 {meta['run_id']}：{len(corpus['frames'])} 帧，结果写到 {run_dir}", file=sys.stderr)
        records = run_free(args, corpus, system_prompt, run_dir, meta)
        meta["finished_at"] = datetime.datetime.now().isoformat()
        write_json(run_dir / "meta.json", meta)
        if args.dry_run:
            estimate = free_estimate(records, system_prompt)
            write_json(run_dir / "estimate.json", estimate)
            print(dump({k: v for k, v in estimate.items() if k != "frames"}))
            for row in estimate["frames"]:
                print(f"  {row['frame']}: {row['events']} 条，提示约 {row['prompt_tokens']} token，截断 {row['truncated']} 条，"
                      f"约 {row['cost_usd']} 美元", file=sys.stderr)
            return 0
    summary = free_summary(records)
    streams = stream_breakdown(records, corpus)
    if streams:
        summary["streams"] = streams
    score = free_score(corpus, labels, records) if labels else None
    write_json(run_dir / "summary.json", {"summary": summary, "weak_labels": score})
    if args.report:
        (run_dir / "report.md").write_text(render_free_report(meta, summary, score), encoding="utf-8")
        print(f"报告：{run_dir / 'report.md'}", file=sys.stderr)
    print(dump({"summary": {k: summary[k] for k in ("frames", "statuses", "cost_usd", "first_rejected")},
                "weak_labels": {k: score[k] for k in ("ignore", "groups", "ranking")} if score else None}))
    return 2 if meta.get("stopped") else 0


# ---------- 入口 ----------

def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--frames", help="逗号分隔的帧 ID，例如 f01,f05,cold-01；默认全部有批次的帧")
    parser.add_argument("--runner", choices=sorted(DEFAULT_MODELS), default="claude",
                        help="调用 claude -p（默认）或 codex exec")
    parser.add_argument("--model", help="默认 claude 用 claude-opus-5-5，codex 用 gpt-6.1-sol")
    parser.add_argument("--codex-system", choices=("merged", "instructions"), default="merged",
                        help="codex 的系统提示放在哪里：merged 与用户提示合成一条消息（默认）；"
                             "instructions 经 model_instructions_file 替换 codex 自带的基础指令，用于检验合成方式的影响")
    parser.add_argument("--skill", default=str(SKILL_PATH), metavar="PATH",
                        help="被测的 SKILL.md，默认 skill/SKILL.md；可指定旧版本做对照")
    parser.add_argument("--run-id")
    parser.add_argument("--resume", action="store_true",
                        help="续跑 --run-id 指定的运行：条件须一致，已有响应的帧不再调用")
    parser.add_argument("--report", action="store_true", help="生成 report.md")
    parser.add_argument("--dry-run", action="store_true", help="只写出提示，不调用模型")
    parser.add_argument("--rescore", metavar="RUN_DIR", help="用已保存的响应重新计算对比，不调用模型")
    parser.add_argument("--scenario", help="已导出的情境 JSON；默认运行 scripts/export-scenario.mjs")
    parser.add_argument("--persona-context", metavar="TEXT",
                        help="只替换提示里的 persona.context，例如去掉透露后续情节的句子；默认用情境原文")
    parser.add_argument("--jobs", type=int, default=4, help="并行调用数；帧之间互不依赖")
    parser.add_argument("--timeout", type=int, default=900, help="单次调用的秒数上限")
    parser.add_argument("--free-run", action="store_true",
                        help="自由运行：从空状态开始逐帧前传自己的状态，与弱标注对照；需要 --corpus")
    parser.add_argument("--corpus", metavar="FRAMES_JSON", help="自由运行的语料帧序列，例如 corpus/curl-bagder/frames.json")
    parser.add_argument("--labels", metavar="LABELS_JSON", help="弱标注，默认取语料同目录的 labels.json")
    parser.add_argument("--text-cap", type=int, metavar="CHARS",
                        help="自由运行：截断超长帧的单条正文到这个长度（默认 1500），只在帧超过 60 条或 2 万字符时生效")
    parser.add_argument("--max-cost", type=float, default=40.0,
                        help="自由运行的费用上限（美元），累计达到后不再开始新的一帧")
    args = parser.parse_args(argv)
    args.model = args.model or DEFAULT_MODELS[args.runner]
    if args.free_run:
        global TEXT_CAP_OVERRIDE
        TEXT_CAP_OVERRIDE = args.text_cap
        if not args.corpus:
            parser.error("--free-run 需要 --corpus")
        if args.runner != "claude":
            parser.error("自由运行目前只支持 claude -p")
        return main_free(args, parser)

    scenario = load_scenario(args.scenario)
    if args.persona_context is not None:
        scenario["persona"]["context"] = args.persona_context  # 只改内存中的副本，不动 scenario.mjs
    prepared = prepare_frames(scenario)
    if args.frames:
        wanted = [f.strip() for f in args.frames.split(",") if f.strip()]
        known = {p["frame"]["id"] for p in prepared}
        missing = [f for f in wanted if f not in known]
        if missing:
            parser.error(f"未知或无批次的帧：{missing}")
        prepared = [p for p in prepared if p["frame"]["id"] in wanted]

    skill_path = Path(args.skill).resolve()
    skill_text = skill_path.read_text(encoding="utf-8")
    system_prompt = SYSTEM_PREAMBLE + skill_text + "\n</skill>\n"

    fatal = None
    if args.rescore:
        run_dir = Path(args.rescore)
        meta = json.loads((run_dir / "meta.json").read_text(encoding="utf-8"))
        by_id = {p["frame"]["id"]: p for p in prepared}
        records = []
        for path in sorted(run_dir.glob("*.json")):
            if path.name in ("meta.json", "summary.json", "schema.json"):
                continue
            record = json.loads(path.read_text(encoding="utf-8"))
            if record.get("frame") not in by_id:
                continue
            record["comparison"] = compare(by_id[record["frame"]], record)
            write_json(path, record)
            records.append(record)
    else:
        if args.resume and not args.run_id:
            parser.error("--resume 需要 --run-id")
        run_id = args.run_id or datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        run_dir = ROOT / ".local" / "eval" / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        meta = {
            "run_id": run_id, "runner": args.runner, "model": args.model,
            "cli_version": cli_version(args.runner), "invocation": invocation(args),
            "skill_path": display_path(skill_path),
            "skill_sha256": hashlib.sha256(skill_text.encode()).hexdigest(),
            "frames": [p["frame"]["id"] for p in prepared], "started_at": datetime.datetime.now().isoformat(),
            "dry_run": args.dry_run, "jobs": args.jobs,
            "persona_context": args.persona_context if args.persona_context is not None else "（情境原文）",
        }
        if args.runner == "codex":
            meta.update({
                "ignore_user_config": True, "codex_system": args.codex_system,
                "prompt_composition": f"系统提示与用户提示原文合成一条用户消息，以「{CODEX_SYSTEM_HEADING}」"
                                      f"「{CODEX_USER_HEADING}」分节；codex 自带的基础指令保留"
                if args.codex_system == "merged" else
                "系统提示经 model_instructions_file 替换 codex 自带的基础指令；用户消息只含用户提示",
                "reasoning_effort": "未指定，用模型默认",
            })
        records = []
        to_run = prepared
        if args.resume:
            meta, records = resume_state(parser, run_dir, meta, prepared)
            done = {r["frame"] for r in records}
            to_run = [p for p in prepared if p["frame"]["id"] not in done]
            meta["resumed"][-1]["frames"] = [p["frame"]["id"] for p in to_run]
        write_json(run_dir / "meta.json", meta)
        write_json(run_dir / "schema.json", OUTPUT_SCHEMA)
        (run_dir / "system-prompt.txt").write_text(system_prompt, encoding="utf-8")
        print(f"运行 {run_id}：{len(to_run)} 帧" + (f"（续跑，沿用已完成的 {len(records)} 帧）" if args.resume else "")
              + f"，结果写到 {run_dir}", file=sys.stderr)
        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
            futures = [pool.submit(run_frame, scenario, p, args, system_prompt, run_dir) for p in to_run]
            for future in concurrent.futures.as_completed(futures):
                try:
                    records.append(future.result())
                except FrameCancelled:
                    continue
                except FatalCallError as error:
                    fatal = fatal or error
                    STOP.set()  # 未开始的帧不再调用；进行中的帧在下一次调用前停下
        order = {p["frame"]["id"]: i for i, p in enumerate(prepared)}
        records.sort(key=lambda r: order[r["frame"]])
        meta["finished_at"] = datetime.datetime.now().isoformat()
        if fatal:
            meta["stopped"] = {"kind": "rate_limit" if isinstance(fatal, RateLimitError) else "fatal",
                               "message": str(fatal)[-800:], "completed": [r["frame"] for r in records]}
        write_json(run_dir / "meta.json", meta)
        if fatal:
            print(f"{args.runner} 无法继续调用，评测停止（已完成 {len(records)} 帧，结果保留）：{fatal}", file=sys.stderr)
        if args.dry_run:
            print(f"已写出 {len(to_run)} 份提示（未调用模型）。", file=sys.stderr)
            return 0
        if fatal and not records:
            return 2

    summary = summarize(records)
    write_json(run_dir / "summary.json", summary)
    if args.report:
        (run_dir / "report.md").write_text(render_report(meta, records, summary), encoding="utf-8")
        print(f"报告：{run_dir / 'report.md'}", file=sys.stderr)
    print(dump({k: summary[k] for k in ("dispositions", "weights", "rejections", "budget", "titles", "tokens")}))
    return 2 if fatal else 0


def resume_state(parser, run_dir: Path, meta: dict, prepared: list[dict]) -> tuple[dict, list[dict]]:
    """续跑：条件须与原运行一致；已有响应的帧沿用原记录，其余帧（含调用失败的）重新调用。"""
    meta_path = run_dir / "meta.json"
    if not meta_path.exists():
        parser.error(f"--resume 找不到 {meta_path}")
    old = json.loads(meta_path.read_text(encoding="utf-8"))
    if old.get("runner") == "codex":
        old.setdefault("codex_system", "merged")  # 早于该选项的 codex 运行都是合成提示
    for key in ("runner", "model", "skill_sha256", "persona_context", "codex_system"):
        if old.get(key) != meta.get(key):
            parser.error(f"--resume 的条件与原运行不同：{key} {old.get(key)!r} → {meta.get(key)!r}")
    records = []
    for p in prepared:
        path = run_dir / f"{p['frame']['id']}.json"
        if path.exists():
            record = json.loads(path.read_text(encoding="utf-8"))
            if record.get("comparison", {}).get("responded"):
                records.append(record)
    old.setdefault("resumed", []).append({
        "at": datetime.datetime.now().isoformat(), "previous_stop": old.pop("stopped", None),
        "cli_version": meta["cli_version"], "invocation": meta["invocation"], "jobs": meta["jobs"]})
    return old, records


def cli_version(runner: str) -> str:
    try:
        return subprocess.run([runner, "--version"], capture_output=True, text=True).stdout.strip()
    except FileNotFoundError:
        return f"未找到 {runner}"


def invocation(args) -> str:
    """如实记录调用形态；路径用占位符。"""
    if args.runner == "codex":
        command = codex_command(args.model, "<run_dir>/codex/<帧>.a<尝试>.c<调用>.cwd（空目录）",
                                "<run_dir>/schema.json", "<run_dir>/codex/<帧>.a<尝试>.c<调用>.last.json",
                                "<run_dir>/system-prompt.txt" if args.codex_system == "instructions" else None)
        return " ".join(command) + ("（用户提示经 stdin）" if args.codex_system == "instructions" else "（合成提示经 stdin）")
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "claude -p --bare"
    return "claude -p（登录态）--setting-sources '' --strict-mcp-config --disable-slash-commands"


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
