"""内存存储：围绕纯内核保存快照，把异常翻译成契约回执。

没有文件、时钟或锁；阶段 3 的本地目录存储另行实现，并复用同一内核。
"""

from __future__ import annotations

import copy

from . import kernel
from .brief import text_brief


class MemoryStore:
    def __init__(self, budget: int = kernel.BUDGET):
        self.snapshot = kernel.initial_snapshot(budget)

    @property
    def revision(self) -> str:
        return self.snapshot["revision"]

    @property
    def event_seq(self) -> int:
        return self.snapshot["event_seq"]

    def commit(self, batch: dict, actor: str, now: str) -> dict:
        try:
            self.snapshot, receipt = kernel.commit(self.snapshot, batch, actor, now)
            return receipt
        except kernel.FoldError as error:
            return self._rejection(error, batch.get("batch_id") if isinstance(batch, dict) else None)

    def annotate(self, batch_id: str, item: str, text: str, actor: str = "user", now: str | None = None) -> dict:
        try:
            self.snapshot, receipt = kernel.annotate(self.snapshot, batch_id, item, text, actor, now)
            return receipt
        except kernel.FoldError as error:
            return self._rejection(error, batch_id)

    def state(self, now: str) -> dict:
        return kernel.project_state(self.snapshot, now)

    def brief(self, now: str) -> str:
        return text_brief(self.state(now))

    def history(self, item: str | None = None, batch: str | None = None) -> dict:
        try:
            return kernel.history(self.snapshot, item=item, batch=batch)
        except kernel.FoldError as error:
            return {"accepted": False, "error": error.to_dict()}

    def item(self, item_id: str) -> dict | None:
        record = self.snapshot["items"].get(item_id)
        return copy.deepcopy(record) if record else None

    def business_state(self) -> dict:
        """业务与批注状态，用于判断一次调用是否改变了状态。"""
        items = {item_id: kernel.business_view(self.snapshot, item) for item_id, item in self.snapshot["items"].items()}
        for item_id, item in self.snapshot["items"].items():
            items[item_id]["updated_at"] = item["updated_at"]
            items[item_id]["annotations"] = list(item["annotations"])
        return {
            "revision": self.snapshot["revision"], "items": items,
            "annotations": copy.deepcopy(self.snapshot["annotations"]),
        }

    def _rejection(self, error: kernel.FoldError, batch_id) -> dict:
        return {
            "accepted": False, "batch_id": batch_id, "revision": self.snapshot["revision"],
            "event_seq": self.snapshot["event_seq"], "events_appended": 0, "error": error.to_dict(),
        }
