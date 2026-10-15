"""用内存内核运行 conformance/cases 的一致性用例。

通过只证明内存层实现；文件恢复、子进程中断与概览渲染的断言在此标记为 skipped。
用法：python3 scripts/run_cases.py [case.yaml ...] [--verbose]
"""

from __future__ import annotations

import copy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from fold import MemoryStore, text_brief  # noqa: E402
from yaml_subset import loads  # noqa: E402

PERSISTENCE_KEYS = {"receipt_received", "snapshot_revision"}


class Failure(Exception):
    pass


def subset(expected, actual, path="") -> None:
    """expected 是 actual 的部分断言：映射逐键递归，列表按位置递归。"""
    if isinstance(expected, dict):
        if not isinstance(actual, dict):
            raise Failure(f"{path}: 期望映射，实际 {actual!r}")
        for key, value in expected.items():
            if key not in actual:
                raise Failure(f"{path}.{key}: 缺少字段（实际键：{sorted(actual)[:12]}）")
            subset(value, actual[key], f"{path}.{key}")
    elif isinstance(expected, list):
        if not isinstance(actual, list) or len(expected) != len(actual):
            raise Failure(f"{path}: 期望 {expected!r}，实际 {actual!r}")
        for index, (exp, act) in enumerate(zip(expected, actual)):
            subset(exp, act, f"{path}[{index}]")
    elif expected != actual:
        raise Failure(f"{path}: 期望 {expected!r}，实际 {actual!r}")


def exact(expected: dict, actual, path: str) -> None:
    """映射的完整断言：键集合必须相同，值再按部分断言比较。"""
    if not isinstance(actual, dict) or set(expected) != set(actual):
        raise Failure(f"{path}: 期望恰好 {expected!r}，实际 {actual!r}")
    subset(expected, actual, path)


def contains(expected_list, actual_list, path):
    """每个期望记录都能在实际列表中找到一个满足部分断言的记录；*_contains 键按子串匹配。"""
    for exp in expected_list:
        for act in actual_list:
            try:
                partial_match(exp, act)
                break
            except Failure:
                continue
        else:
            raise Failure(f"{path}: 找不到匹配 {exp!r} 的记录；实际：{[summarize(a) for a in actual_list]}")


def partial_match(exp, act):
    for key, value in exp.items():
        if key.endswith("_contains") and isinstance(value, str):
            field = key[: -len("_contains")]
            if value not in str(act.get(field, "")):
                raise Failure(f"{field} 不含 {value!r}")
        elif key == "changes_contain":
            contains(value, act.get("changes", []), "changes")
        else:
            subset(value, act.get(key), key)


def summarize(record):
    return {k: record.get(k) for k in ("event_seq", "type", "batch_id", "revision", "op", "item") if k in record}


def collect_layers(state):
    layers = {}

    def visit(layer, parent):
        layers[parent] = {
            "used": layer["used"],
            "shares": {item["id"]: item["share"] for item in layer["items"]},
            "rank": [item["id"] for item in layer["items"]],
        }
        for item in layer["items"]:
            if item.get("children"):
                visit(item["children"], item["id"])

    visit(state["root"], "root")
    return layers


def item_record(store: MemoryStore, state: dict, item_id: str) -> dict:
    record = store.item(item_id)
    if record is None:
        raise Failure(f"items.{item_id}: 条目不存在")
    active_children = []
    for child in store.snapshot["items"].values():
        if child["parent_id"] == item_id and child["status"] == "active":
            active_children.append(child)
    from fold.kernel import rank_items
    ordered = [child["id"] for child in rank_items(active_children)]
    record["active_children"] = ordered
    record["children"] = ordered if ordered else None
    for layer_item in iter_items(state["root"]):
        if layer_item["id"] == item_id:
            for key in ("age", "since_update", "until_due", "until_stale", "rank", "last_seen_at", "since_seen"):
                record[key] = layer_item[key]
    return record


def iter_items(layer):
    for item in layer["items"]:
        yield item
        if item.get("children"):
            yield from iter_items(item["children"])


def check_expectations(expect: dict, store: MemoryStore, receipt, now: str, before_state, before_seq: int,
                       step_kind: str, history_result=None) -> list[str]:
    skipped = []
    state = store.state(now)
    layers = collect_layers(state)
    for key, value in expect.items():
        if key in PERSISTENCE_KEYS:
            skipped.append(f"{key}（持久化断言，内存运行器不验证）")
            continue
        if key in ("accepted", "batch_status", "annotation_id", "annotation_status_receipt"):
            subset(value, receipt.get(key), key)
        elif key == "annotation_status" and step_kind == "annotate":
            subset(value, receipt.get("annotation_status"), key)
        elif key == "annotation_status":
            subset(value, state["annotation_status"], key)
        elif key == "annotation_bound_to":
            subset(value, state["annotation_bound_to"], key)
        elif key == "revision":
            if step_kind in ("state", "history") or receipt is None:
                subset(value, state["revision"], key)
            else:
                subset(value, receipt.get("revision"), "receipt.revision")
                subset(value, store.revision, "store.revision")
        elif key == "now" or key == "event_seq":
            subset(value, receipt.get(key), f"receipt.{key}")
        elif key == "events_appended":
            subset(value, store.event_seq - before_seq, key)
        elif key == "used":
            subset(value, layers["root"]["used"], key)
        elif key == "shares":
            # 份额表是整层断言：多出未列出的 active 条目同样算失败。
            exact(value, layers["root"]["shares"], key)
        elif key == "last_checked_at":
            subset(value, state["last_checked_at"], key)
        elif key == "rank":
            subset(value, layers["root"]["rank"], key)
        elif key == "children":
            for parent, layer_expect in value.items():
                if parent not in layers:
                    raise Failure(f"children.{parent}: 该层没有 active 条目")
                subset(layer_expect, layers[parent], f"children.{parent}")
                if "shares" in layer_expect:
                    exact(layer_expect["shares"], layers[parent]["shares"], f"children.{parent}.shares")
        elif key == "withdrawn":
            actual = sorted(i["id"] for i in store.snapshot["items"].values() if i["status"] == "withdrawn")
            subset(sorted(value), actual, key)
        elif key == "pending_annotations":
            subset(value, [a["id"] for a in state["pending_annotations"]], key)
        elif key == "pending_annotation_items":
            subset(value, {a["id"]: a["item"] for a in state["pending_annotations"]}, key)
        elif key == "items":
            for item_id, fields in value.items():
                record = item_record(store, state, item_id)
                normalized = dict(fields)
                if "children" in normalized and normalized["children"] in (None, []):
                    normalized["children"] = None
                    record["children"] = record["children"] or None
                subset(normalized, record, f"items.{item_id}")
        elif key == "state_unchanged":
            if value and before_state != store.business_state():
                raise Failure("state_unchanged: 业务或批注状态发生了变化")
        elif key == "batch_id_recorded":
            batch_id = receipt.get("batch_id")
            recorded = batch_id in store.snapshot["receipts"]
            subset(value, recorded, key)
        elif key == "error":
            if receipt.get("accepted") is not False:
                raise Failure(f"error: 期望拒绝，实际回执 {receipt}")
            subset(value, receipt["error"], key)
        elif key == "original_receipt":
            subset(value, receipt["error"].get("original_receipt"), key)
        elif key == "events_contain":
            # history 步骤核对查询结果；其他步骤只核对本步新追加的记录，不回退到全部旧记录，
            # 否则本步没写入时旧记录也能让断言通过。
            if step_kind == "history":
                contains(value, history_result["events"], "history.events_contain")
            else:
                new_events = [e for e in store.snapshot["events"] if e["event_seq"] > before_seq]
                contains(value, new_events, key)
        elif key == "changes_contain":
            contains(value, receipt.get("changes", []), key)
        elif key == "text_brief_contains":
            brief = text_brief(state)
            for needle in value:
                if needle not in brief:
                    raise Failure(f"text_brief_contains: 缺少 {needle!r}\n{brief}")
        elif key == "text_brief_not_contains":
            brief = text_brief(state)
            for needle in value:
                if needle in brief:
                    raise Failure(f"text_brief_not_contains: 出现了 {needle!r}\n{brief}")
        elif key == "events" and step_kind == "history":
            subset_history_events(value, history_result["events"])
        elif key == "receipt" and step_kind == "history":
            subset(value, history_result.get("receipt"), key)
        elif key in ("summary_at_withdraw", "parent_at_withdraw", "sources_at_withdraw") and step_kind == "history":
            subset(value, history_result.get(key), key)
        elif key == "annotations" and step_kind == "history":
            subset(value, history_result.get("annotations"), key)
        elif key in ("overview", "artifact_assertions", "render_assertions", "diff", "diff_contains", "exit_nonzero"):
            skipped.append(f"{key}（概览渲染未实现）")
        else:
            raise Failure(f"运行器不认识的断言键：{key}")
    return skipped


def subset_history_events(expected, actual):
    if len(expected) != len(actual):
        raise Failure(f"history.events: 期望 {len(expected)} 条，实际 {len(actual)} 条：{[summarize(a) for a in actual]}")
    for index, (exp, act) in enumerate(zip(expected, actual)):
        try:
            partial_match(exp, act)
        except Failure as error:
            raise Failure(f"history.events[{index}]: {error}") from None


def run_case(path: Path, verbose: bool = False) -> tuple[int, int, list[str]]:
    case = loads(path.read_text(encoding="utf-8"))
    store = MemoryStore(case.get("budget", 64))
    default_actor = case.get("actor", "assistant")
    passed = failed = 0
    notes: list[str] = []
    for index, step in enumerate(case["steps"], start=1):
        name = step.get("name", f"step {index}")
        actor = step.get("actor", default_actor)
        now = step["now"]
        before_state = store.business_state()
        before_seq = store.event_seq
        receipt = None
        history_result = None
        kind = None
        try:
            if "commit" in step:
                kind = "commit"
                receipt = store.commit(copy.deepcopy(step["commit"]), actor, now)
            elif "annotate" in step:
                kind = "annotate"
                spec = step["annotate"]
                receipt = store.annotate(spec["batch_id"], spec["item"], spec["text"], actor, now)
            elif "state" in step:
                kind = "state"
                receipt = {}
                if step["state"] and "overview" in step["state"]:
                    notes.append(f"  ~ {name}: overview 请求未执行（渲染器未实现），仅检查普通 state")
            elif "history" in step:
                kind = "history"
                receipt = {}
                history_result = store.history(**step["history"])
                if history_result.get("accepted") is False:
                    raise Failure(f"history 查询被拒绝：{history_result['error']}")
            else:
                raise Failure("步骤缺少 commit / annotate / state / history")
            if step.get("fault"):
                notes.append(f"  ~ {name}: fault={step['fault']} 在内存运行器中视为提交已落地、回执未送达")
            if step.get("restart"):
                notes.append(f"  ~ {name}: restart 在内存运行器中无操作")
            skipped = check_expectations(step.get("expect", {}), store, receipt, now, before_state, before_seq,
                                         kind, history_result)
            passed += 1
            if verbose:
                print(f"  ✓ {name}")
            for item in skipped:
                notes.append(f"  ~ {name}: 跳过 {item}")
        except Failure as error:
            failed += 1
            print(f"  ✗ {name}\n    {error}")
            if receipt is not None and verbose:
                print(f"    回执：{receipt}")
        except Exception as error:  # noqa: BLE001 — 内核意外异常也只算本步失败，后续用例照常运行。
            failed += 1
            print(f"  ✗ {name}\n    未预期的异常 {type(error).__name__}: {error}")
    return passed, failed, notes


def main(argv: list[str]) -> int:
    verbose = "--verbose" in argv
    paths = [Path(a) for a in argv if not a.startswith("--")]
    if not paths:
        paths = sorted((ROOT / "conformance" / "cases").glob("*.yaml"))
    total_passed = total_failed = 0
    for path in paths:
        print(path.relative_to(ROOT) if path.is_absolute() and path.is_relative_to(ROOT) else path)
        passed, failed, notes = run_case(path, verbose)
        total_passed += passed
        total_failed += failed
        for note in dict.fromkeys(notes):
            print(note)
        print(f"  {passed} 步通过，{failed} 步失败")
    print(f"合计：{total_passed} 步通过，{total_failed} 步失败。内存层通过不代表文件恢复与概览渲染已完成。")
    return 1 if total_failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
