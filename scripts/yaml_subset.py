"""读取 conformance/cases 所用的 YAML 子集，不引入第三方依赖。

支持：注释、块映射与块序列、流式 {} / []（可跨行）、单双引号字符串、
null / true / false / 整数 / 浮点与普通字符串。不支持锚点、多行标量与复杂键。
产品 CLI 只接收 JSON；这个解析器只服务用例运行器。
"""

from __future__ import annotations

import re


class YamlSubsetError(ValueError):
    pass


def _strip_comment(line: str) -> str:
    quote = None
    for index, char in enumerate(line):
        if quote:
            if char == quote:
                quote = None
        elif char in ("'", '"'):
            quote = char
        elif char == "#" and (index == 0 or line[index - 1] in " \t"):
            return line[:index].rstrip()
    return line.rstrip()


def _scalar(text: str):
    text = text.strip()
    if text == "":
        return None
    if text[0] in ("'", '"'):
        return _quoted(text)[0]
    if text in ("null", "~"):
        return None
    if text == "true":
        return True
    if text == "false":
        return False
    if re.fullmatch(r"-?\d+", text):
        return int(text)
    if re.fullmatch(r"-?\d+\.\d+", text):
        return float(text)
    return text


def _quoted(text: str) -> tuple[str, int]:
    quote = text[0]
    index = 1
    out = []
    while index < len(text):
        char = text[index]
        if quote == '"' and char == "\\" and index + 1 < len(text):
            out.append(text[index + 1])
            index += 2
            continue
        if char == quote:
            if quote == "'" and text[index + 1:index + 2] == "'":
                out.append("'")
                index += 2
                continue
            return "".join(out), index + 1
        out.append(char)
        index += 1
    raise YamlSubsetError(f"未闭合的引号：{text}")


class _Flow:
    def __init__(self, text: str):
        self.text = text
        self.pos = 0

    def skip(self):
        while self.pos < len(self.text) and self.text[self.pos] in " \t\n\r":
            self.pos += 1

    def parse(self):
        self.skip()
        char = self.text[self.pos]
        if char == "{":
            return self.mapping()
        if char == "[":
            return self.sequence()
        return self.plain(stop=",}]")

    def mapping(self) -> dict:
        self.pos += 1
        result: dict = {}
        while True:
            self.skip()
            if self.text[self.pos] == "}":
                self.pos += 1
                return result
            key = self.plain(stop=":,}", key=True)
            self.skip()
            if self.text[self.pos] != ":":
                raise YamlSubsetError(f"流式映射缺少冒号：{self.text}")
            self.pos += 1
            value = self.parse()
            result[key] = value
            self.skip()
            if self.text[self.pos] == ",":
                self.pos += 1

    def sequence(self) -> list:
        self.pos += 1
        result = []
        while True:
            self.skip()
            if self.text[self.pos] == "]":
                self.pos += 1
                return result
            result.append(self.parse())
            self.skip()
            if self.text[self.pos] == ",":
                self.pos += 1

    def plain(self, stop: str, key: bool = False):
        self.skip()
        if self.text[self.pos] in ("'", '"'):
            value, consumed = _quoted(self.text[self.pos:])
            self.pos += consumed
            return value
        start = self.pos
        while self.pos < len(self.text):
            char = self.text[self.pos]
            if char in stop:
                if char == ":" and not key:
                    # 普通标量中的冒号后若非空白，视为内容的一部分（如 supersedes:x）。
                    if self.text[self.pos + 1:self.pos + 2] not in (" ", ""):
                        self.pos += 1
                        continue
                break
            if char == ":" and key is False and self.text[self.pos + 1:self.pos + 2] == " ":
                break
            self.pos += 1
        raw = self.text[start:self.pos].strip()
        return raw if key else _scalar(raw)


def _parse_flow(text: str):
    parser = _Flow(text)
    value = parser.parse()
    parser.skip()
    if parser.pos != len(text):
        raise YamlSubsetError(f"流式结构后有多余内容：{text[parser.pos:]}")
    return value


def _balanced(text: str) -> bool:
    depth = 0
    quote = None
    for char in text:
        if quote:
            if char == quote:
                quote = None
        elif char in ("'", '"'):
            quote = char
        elif char in "{[":
            depth += 1
        elif char in "}]":
            depth -= 1
    return depth == 0 and quote is None


def _split_key(text: str) -> tuple[str, str] | None:
    """把 `key: value` 或 `key:` 拆开；键不含引号时在首个“冒号+空白或行尾”处切分。"""
    if text.startswith(("'", '"')):
        key, consumed = _quoted(text)
        rest = text[consumed:].lstrip()
        if rest.startswith(":"):
            return key, rest[1:].strip()
        return None
    match = re.match(r"^([^\s:{}\[\],#][^:]*?)\s*:(?:\s+(.*))?$", text)
    if not match:
        return None
    return match.group(1).strip(), (match.group(2) or "").strip()


def loads(source: str):
    lines = []
    for raw in source.splitlines():
        stripped = _strip_comment(raw)
        if stripped.strip():
            lines.append((len(stripped) - len(stripped.lstrip(" ")), stripped.strip()))
    joined: list[tuple[int, str]] = []
    index = 0
    while index < len(lines):
        indent, text = lines[index]
        while not _balanced(text) and index + 1 < len(lines):
            index += 1
            text += " " + lines[index][1]
        joined.append((indent, text))
        index += 1
    value, position = _parse_block(joined, 0, joined[0][0] if joined else 0)
    if position != len(joined):
        raise YamlSubsetError(f"第 {position} 行开始无法解析：{joined[position][1]}")
    return value


def _value_from_text(text: str):
    if text.startswith(("{", "[")):
        return _parse_flow(text)
    return _scalar(text)


def _parse_block(lines, position: int, indent: int):
    if position >= len(lines):
        return None, position
    if lines[position][1].startswith("- ") or lines[position][1] == "-":
        return _parse_sequence(lines, position, indent)
    return _parse_mapping(lines, position, indent)


def _parse_sequence(lines, position: int, indent: int):
    result = []
    while position < len(lines):
        line_indent, text = lines[position]
        if line_indent != indent or not (text.startswith("- ") or text == "-"):
            break
        body = text[1:].strip()
        if body == "":
            value, position = _parse_block(lines, position + 1, lines[position + 1][0])
            result.append(value)
            continue
        split = _split_key(body)
        if split and not body.startswith(("{", "[", "'", '"')):
            # 序列项内联映射：`- key: value`，后续更深缩进的行继续这个映射。
            key, rest = split
            item: dict = {}
            inner_indent = indent + 2
            if rest == "":
                value, position = _parse_block(lines, position + 1, lines[position + 1][0]) \
                    if position + 1 < len(lines) and lines[position + 1][0] > indent else (None, position + 1)
                item[key] = value
            else:
                item[key] = _value_from_text(rest)
                position += 1
            if position < len(lines) and lines[position][0] > indent and not (
                    lines[position][0] == indent and lines[position][1].startswith("- ")):
                inner_indent = lines[position][0]
                more, position = _parse_mapping(lines, position, inner_indent)
                item.update(more)
            result.append(item)
            continue
        result.append(_value_from_text(body))
        position += 1
    return result, position


def _parse_mapping(lines, position: int, indent: int):
    result: dict = {}
    while position < len(lines):
        line_indent, text = lines[position]
        if line_indent != indent:
            if line_indent > indent:
                raise YamlSubsetError(f"意外缩进：{text}")
            break
        if text.startswith("- "):
            break
        split = _split_key(text)
        if split is None:
            raise YamlSubsetError(f"无法解析的行：{text}")
        key, rest = split
        if rest == "":
            if position + 1 < len(lines) and (lines[position + 1][0] > indent or
                                              (lines[position + 1][0] == indent and lines[position + 1][1].startswith("- "))):
                value, position = _parse_block(lines, position + 1, lines[position + 1][0])
            else:
                value, position = None, position + 1
        else:
            value = _value_from_text(rest)
            position += 1
        result[key] = value
    return result, position
