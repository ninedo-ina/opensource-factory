"""数据质量运维 CLI（M9-05 / M1-16）。

用法：

    python -m app.data_quality report
    python -m app.data_quality reconcile --snapshot /tmp/d1-mirror.json

`reconcile` 的 snapshot 来自 edge 内部接口 `GET /api/internal/data-quality/mirror`
（返回 `{ "items": [...] }`），用于核对 D1 与本机 SQLite 镜像是否一致。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Optional, Sequence

from sqlalchemy import select

from app.db import SessionLocal
from app.models import MyRepository
from app.services.data_quality import build_local_report, reconcile_snapshot


def _load_snapshot(path: str) -> list[dict[str, Any]]:
    if path == "-":
        payload = json.load(sys.stdin)
    else:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(payload, dict):
        items = payload.get("items")
        if isinstance(items, list):
            return [item for item in items if isinstance(item, dict)]
        raise ValueError("snapshot JSON 缺少 items 数组")
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    raise ValueError("snapshot JSON 必须是对象或数组")


def _print(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2, default=str))


def run_report() -> int:
    db = SessionLocal()
    try:
        rows = list(db.execute(select(MyRepository)).scalars().all())
        _print(build_local_report(rows))
    finally:
        db.close()
    return 0


def run_reconcile(snapshot_path: str) -> int:
    try:
        snapshot = _load_snapshot(snapshot_path)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"读取 snapshot 失败: {exc}", file=sys.stderr)
        return 2
    db = SessionLocal()
    try:
        rows = list(db.execute(select(MyRepository)).scalars().all())
        report = reconcile_snapshot(snapshot, rows)
        _print(report)
    finally:
        db.close()
    return 0 if report["ok"] else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="OpenFactory 数据质量运维工具")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("report", help="输出本机镜像数据质量快照")
    reconcile = sub.add_parser("reconcile", help="对比 edge D1 快照与本机镜像")
    reconcile.add_argument("--snapshot", required=True, help="D1 快照 JSON 文件路径，- 表示 stdin")
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "report":
        return run_report()
    if args.command == "reconcile":
        return run_reconcile(args.snapshot)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
