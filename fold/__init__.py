"""Fold 首切片内核：纯函数校验与执行，内存存储，文字简报。

模块边界见 docs/architecture.md；外部行为见 docs/information-contract.md。
"""

from .kernel import BUDGET, FoldError, commit, annotate, project_state, history, derive_share
from .memory import MemoryStore
from .brief import text_brief

__all__ = [
    "BUDGET", "FoldError", "commit", "annotate", "project_state", "history",
    "derive_share", "MemoryStore", "text_brief",
]
