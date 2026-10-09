"""Check the startup files and local links in maintained Markdown documents."""

from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
REQUIRED = (
    "README.md",
    "AGENTS.md",
    "docs/product.md",
    "docs/visual-guide.md",
    "docs/assets/illustrations/README.md",
    "docs/user-stories.md",
    "docs/formal-model.md",
    "docs/information-contract.md",
    "docs/skill-design.md",
    "docs/architecture.md",
    "docs/decisions.md",
    "docs/development.md",
    "docs/reference/design-v0.3.md",
    "conformance/cases/01-us01-roundtrip.yaml",
    "conformance/cases/02-us03-overflow-reject.yaml",
    "Makefile",
    "scripts/check.py",
    ".editorconfig",
    ".gitattributes",
    ".gitignore",
)
LINK = re.compile(r"!?\[[^\]\n]*\]\(([^)\n]+)\)")
FENCE = re.compile(r"^\s*(`{3,}|~{3,})")


def check_document(path: Path) -> list[str]:
    errors: list[str] = []
    name = path.relative_to(ROOT)
    content = path.read_text(encoding="utf-8")
    if not content.endswith("\n"):
        errors.append(f"{name}: 文件末尾缺少换行")

    fence = ""
    for number, line in enumerate(content.splitlines(), start=1):
        location = f"{name}:{number}"
        if line.rstrip() != line:
            errors.append(f"{location}: 行尾有空白")
        marker = FENCE.match(line)
        if marker:
            token = marker.group(1)
            if not fence:
                fence = token
            elif token[0] == fence[0] and len(token) >= len(fence):
                fence = ""
            continue
        if fence:
            continue

        for match in LINK.finditer(line):
            target = match.group(1).strip().removeprefix("<").removesuffix(">")
            url = urlsplit(target)
            if url.scheme or url.netloc or not url.path:
                continue
            link_path = Path(unquote(url.path))
            if link_path.is_absolute():
                errors.append(f"{location}: 请使用仓库相对路径：{target}")
                continue
            destination = (path.parent / link_path).resolve()
            if not destination.is_relative_to(ROOT):
                errors.append(f"{location}: 链接超出仓库：{target}")
            elif not destination.exists():
                errors.append(f"{location}: 链接目标不存在：{target}")
    return errors


def main() -> int:
    if sys.version_info < (3, 11):
        print("需要 Python 3.11 或更高版本。", file=sys.stderr)
        return 1

    errors = [f"缺少启动文件：{name}" for name in REQUIRED if not (ROOT / name).is_file()]
    documents = [ROOT / "README.md", ROOT / "AGENTS.md"]
    documents.extend(sorted((ROOT / "docs").rglob("*.md")))
    maintained = [
        path for path in documents
        if path.is_file() and not path.is_relative_to(ROOT / "docs" / "reference")
    ]
    for path in maintained:
        errors.extend(check_document(path))

    if errors:
        print("启动检查未通过：", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(f"启动检查通过：{len(REQUIRED)} 个文件齐全，{len(maintained)} 份维护中文档链接与格式有效。")
    print("原始草案按原件保留；当前没有产品功能测试。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
