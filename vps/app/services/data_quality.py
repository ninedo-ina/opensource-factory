"""数据质量治理服务（M9-05 / REQ-202610-0982，含 M1-16 最小对账）。

三块能力，全部与网络隔离可测：

- `check_links`：批量 HEAD / GET 校验仓库地址，返回 ok / broken / redirected / unknown；
- `collect_metadata_patches`：按仓库 id 拉取 GitHub 详情，生成可回写 D1 的元数据 patch；
- `reconcile_snapshot`：比较 edge 导出的 D1 仓库快照与本机镜像，输出缺失与字段差异。

服务不直接写 D1：链接与元数据结果由 edge 回写；对账只输出报告，供运维 CLI 使用。
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Iterable, Optional, Sequence
from urllib.parse import urlsplit, urlunsplit

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import MyRepository
from app.services.github_service import get_repo

logger = logging.getLogger(__name__)

MAX_LINK_CHECKS = 50
MAX_METADATA_REPOS = 50
_LINK_CONCURRENCY = 5
_TIMEOUT = httpx.Timeout(12.0, connect=5.0)
_USER_AGENT = "OpenFactory-VPS/1.0 (+data-quality)"

LinkFetcher = Callable[[str], Awaitable[Any]]
RepoFetcher = Callable[[str], Awaitable[Optional[dict[str, Any]]]]


@dataclass(frozen=True)
class LinkItem:
    """一个待检测的仓库链接。"""

    repo_id: str
    url: str
    platform: str = "github"


@dataclass(frozen=True)
class LinkResult:
    """链接检测结果；`unknown` 不参与问题判定，避免误报。"""

    repo_id: str
    status: str
    http_status: Optional[int] = None
    final_url: Optional[str] = None
    error: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "repoId": self.repo_id,
            "status": self.status,
            "httpStatus": self.http_status,
            "finalUrl": self.final_url,
            "error": self.error,
        }


def normalize_url(url: str) -> str:
    """链接归一：去首尾空白、统一小写域名、去默认端口 / 尾斜杠。"""
    raw = (url or "").strip()
    if not raw:
        return ""
    try:
        parts = urlsplit(raw)
    except ValueError:
        return raw
    host = (parts.hostname or "").lower()
    if not host:
        return raw
    netloc = host
    if parts.port and not (
        (parts.scheme == "http" and parts.port == 80)
        or (parts.scheme == "https" and parts.port == 443)
    ):
        netloc = f"{host}:{parts.port}"
    path = parts.path.rstrip("/") or ""
    return urlunsplit((parts.scheme.lower() or "https", netloc, path, parts.query, ""))


def evaluate_response(
    repo_id: str,
    original_url: str,
    status_code: int,
    final_url: str,
) -> LinkResult:
    """把 HTTP 响应映射为链接状态（纯函数，便于测试）。"""
    if status_code in (404, 410):
        return LinkResult(repo_id, "broken", status_code, final_url or original_url)
    if 200 <= status_code < 400:
        if final_url and normalize_url(final_url) != normalize_url(original_url):
            return LinkResult(repo_id, "redirected", status_code, final_url)
        return LinkResult(repo_id, "ok", status_code, final_url or original_url)
    return LinkResult(repo_id, "unknown", status_code, final_url or original_url)


async def _default_fetch(url: str) -> Any:
    """HEAD 优先；部分站点拒绝 HEAD 时回退 GET（只读、跟随重定向）。"""
    async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=True) as client:
        resp = await client.head(url, headers={"User-Agent": _USER_AGENT})
        if resp.status_code in (403, 405, 501):
            resp = await client.get(url, headers={"User-Agent": _USER_AGENT})
        return resp


async def check_links(
    items: Sequence[LinkItem],
    *,
    fetcher: Optional[LinkFetcher] = None,
) -> list[LinkResult]:
    """并发（上限 5）检测链接；任何异常都降级为 unknown，不抛出。"""
    fetch = fetcher or _default_fetch
    semaphore = asyncio.Semaphore(_LINK_CONCURRENCY)
    selected = list(items)[:MAX_LINK_CHECKS]

    async def check_one(item: LinkItem) -> LinkResult:
        if not item.url.strip():
            return LinkResult(item.repo_id, "unknown", error="empty url")
        async with semaphore:
            try:
                response = await fetch(item.url)
            except Exception as exc:  # noqa: BLE001 - 单条失败不能影响整批
                logger.info("链接检测失败 %s: %s", item.url, exc)
                return LinkResult(item.repo_id, "unknown", error=str(exc)[:200])
        status_code = int(getattr(response, "status_code", 0) or 0)
        final_url = str(getattr(response, "url", "") or item.url)
        return evaluate_response(item.repo_id, item.url, status_code, final_url)

    return list(await asyncio.gather(*(check_one(item) for item in selected)))


def _iso(value: Any) -> str:
    if value is None:
        return ""
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _patch_from_repo(repo: dict[str, Any]) -> dict[str, Any]:
    """从 GitHub 标准化对象提取允许回写的字段（不臆造简介 / 分类）。"""
    patch: dict[str, Any] = {
        "description": (repo.get("description") or "").strip(),
        "language": (repo.get("language") or "").strip(),
        "stars": int(repo.get("stars") or 0),
        "forks": int(repo.get("forks") or 0),
        "html_url": (repo.get("html_url") or "").strip(),
        "updated_at": _iso(repo.get("updated_at")),
        "license_spdx": repo.get("license_spdx") or "",
        "license_name": repo.get("license_name") or "",
        "license_source": repo.get("license_source") or "none",
    }
    return {key: value for key, value in patch.items() if value not in ("", None)}


async def collect_metadata_patches(
    db: Session,
    repo_ids: Iterable[str],
    *,
    token: Optional[str] = None,
    fetch_repo: Optional[RepoFetcher] = None,
) -> list[dict[str, Any]]:
    """按 id 拉取仓库详情并生成 patch；只处理本机镜像中存在的 GitHub 仓库。"""
    ids = [repo_id for repo_id in dict.fromkeys(repo_ids) if repo_id][:MAX_METADATA_REPOS]
    if not ids:
        return []
    rows = list(db.execute(select(MyRepository).where(MyRepository.id.in_(ids))).scalars().all())
    fetch = fetch_repo or (lambda full_name: get_repo(token, full_name))

    async def one(row: MyRepository) -> Optional[dict[str, Any]]:
        if (row.platform or "github") != "github":
            return None
        try:
            repo = await fetch(row.id)
        except Exception as exc:  # noqa: BLE001 - 单仓库失败不影响整批
            logger.info("拉取仓库元数据失败 %s: %s", row.id, exc)
            return None
        if not repo:
            return None
        patch = _patch_from_repo(repo)
        if not patch:
            return None
        return {"repoId": row.id, "patch": patch}

    results = await asyncio.gather(*(one(row) for row in rows))
    return [item for item in results if item]


def _same_value(left: Any, right: Any) -> bool:
    if left is None and right is None:
        return True
    if isinstance(left, int) or isinstance(right, int):
        try:
            return int(left or 0) == int(right or 0)
        except (TypeError, ValueError):
            return False
    return str(left or "").strip() == str(right or "").strip()


def reconcile_snapshot(
    snapshot_items: Iterable[dict[str, Any]],
    local_rows: Iterable[MyRepository],
    *,
    fields: Sequence[str] = ("name", "description", "language", "stars", "html_url"),
    sample_limit: int = 20,
) -> dict[str, Any]:
    """比较 D1 快照与本地镜像：缺失项 + 字段差异（M1-16 最小对账）。"""
    snapshot = {
        str(item.get("id")): item
        for item in snapshot_items
        if isinstance(item, dict) and item.get("id")
    }
    local = {row.id: row for row in local_rows}
    missing_in_local = sorted(set(snapshot) - set(local))
    missing_in_d1 = sorted(set(local) - set(snapshot))

    mismatches: list[dict[str, Any]] = []
    for repo_id in sorted(set(snapshot) & set(local)):
        item = snapshot[repo_id]
        row = local[repo_id]
        diffs: dict[str, dict[str, Any]] = {}
        for field in fields:
            d1_value = item.get(field)
            local_value = getattr(row, field, None)
            if not _same_value(d1_value, local_value):
                diffs[field] = {"d1": d1_value, "local": local_value}
        if diffs:
            mismatches.append({"repoId": repo_id, "fields": diffs})

    return {
        "d1Count": len(snapshot),
        "localCount": len(local),
        "missingInLocal": len(missing_in_local),
        "missingInD1": len(missing_in_d1),
        "mismatchCount": len(mismatches),
        "missingInLocalSample": missing_in_local[:sample_limit],
        "missingInD1Sample": missing_in_d1[:sample_limit],
        "mismatchSample": mismatches[:sample_limit],
        "ok": not missing_in_local and not missing_in_d1 and not mismatches,
    }


def build_local_report(rows: Iterable[MyRepository]) -> dict[str, Any]:
    """本地镜像数据质量快照（CLI `report` 使用）。"""
    items = list(rows)
    missing = {
        "description": 0,
        "language": 0,
        "license": 0,
        "summary": 0,
        "category": 0,
    }
    for row in items:
        if not (row.description or "").strip():
            missing["description"] += 1
        if not (row.language or "").strip():
            missing["language"] += 1
        if not (row.license_spdx or row.license_checked_at):
            missing["license"] += 1
        if not (row.readme_summary or "").strip():
            missing["summary"] += 1
        if not (row.category_id or "").strip():
            missing["category"] += 1
    return {
        "total": len(items),
        "missing": missing,
        "missingTotal": sum(missing.values()),
        "platforms": {
            platform: sum(1 for row in items if (row.platform or "github") == platform)
            for platform in sorted({(row.platform or "github") for row in items})
        },
    }
