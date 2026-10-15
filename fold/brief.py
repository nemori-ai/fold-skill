"""文字简报：首个消费者。规则见 docs/information-contract.md 第 5 节。

按 rank 排序；critical 与 high 各自成段并加粗标题；normal 每项一逻辑行；
low 与 trace 折成一行尾注；有 active 子层的标“▸ n 项细节”；时间用时长；只展示 active 条目。
"""

from __future__ import annotations

KIND_LABEL = {"needs-you": "需要你", "in-progress": "进行中", "done": "已完成", "fyi": "知会"}


def _time_note(item: dict) -> str:
    notes = []
    if item.get("until_due") is not None:
        notes.append(f"截止{'已过' if item['until_due'].startswith('已过') else '还剩'} {item['until_due'].removeprefix('已过 ')}")
    if item.get("until_stale") is not None:
        notes.append(f"依据{'已过期' if item['until_stale'].startswith('已过') else '有效还剩'} {item['until_stale'].removeprefix('已过 ')}")
    return " · ".join(notes)


def _detail_note(item: dict) -> str:
    children = item.get("children")
    if children and children.get("items"):
        return f" ▸ {len(children['items'])} 项细节"
    return ""


def text_brief(state: dict) -> str:
    layer = state["root"]
    lines: list[str] = []
    minor: list[dict] = []
    for item in layer["items"]:
        kind = KIND_LABEL.get(item["kind"], item["kind"])
        time_note = _time_note(item)
        if item["weight"] in ("critical", "high"):
            header = f"**{item['title']}** · {kind} · {item['share']} 份"
            if time_note:
                header += f" · {time_note}"
            if item.get("since_update"):
                header += f" · 更新于 {item['since_update']}前"
            body = (item.get("summary") or "").strip()
            lines.append(header)
            lines.append((body + _detail_note(item)).strip() if body or _detail_note(item) else "")
            lines.append("")
        elif item["weight"] == "normal":
            summary = (item.get("summary") or "").strip()
            line = f"- {item['title']} · {kind}"
            if summary:
                line += f"：{summary}"
            if time_note:
                line += f"（{time_note}）"
            line += _detail_note(item)
            lines.append(line)
        else:
            minor.append(item)
    if minor:
        names = "、".join(item["title"] for item in minor)
        lines.append(f"另有 {len(minor)} 项次要事项：{names}")
    if not layer["items"]:
        lines.append("当前没有事项。")
    lines.append(f"预算 {layer['used']} / {layer['budget']} 份 · 状态 {state['revision']} · 历史：fold history --item <id>")
    while lines and lines[-2:-1] == [""]:
        lines.pop(-2)
    return "\n".join(line for line in lines).strip() + "\n"
