"""数据质量治理内部接口（M9-05 / REQ-202610-0982）。

- `POST /api/data-quality/check-links`：批量校验仓库链接（HEAD / GET）；
- `POST /api/data-quality/metadata`：按仓库 id 拉取 GitHub 详情，返回元数据 patch。

仅限 edge 通过 `X-Internal-Token` 调用；不直接修改 D1。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.tasks import require_internal_token
from app.config import get_settings
from app.db import get_db
from app.schemas import (
    DataQualityLinkCheckRequest,
    DataQualityLinkCheckResponse,
    DataQualityLinkResultOut,
    DataQualityMetadataItemOut,
    DataQualityMetadataRequest,
    DataQualityMetadataResponse,
)
from app.services.data_quality import LinkItem, check_links, collect_metadata_patches

router = APIRouter(
    prefix="/api/data-quality",
    tags=["data-quality"],
    dependencies=[Depends(require_internal_token)],
)


@router.post(
    "/check-links",
    response_model=DataQualityLinkCheckResponse,
    summary="批量校验仓库链接（M9-05）",
)
async def check_repo_links(payload: DataQualityLinkCheckRequest) -> DataQualityLinkCheckResponse:
    results = await check_links(
        [LinkItem(repo_id=item.repoId, url=item.url, platform=item.platform) for item in payload.items]
    )
    return DataQualityLinkCheckResponse(
        results=[DataQualityLinkResultOut(**result.to_dict()) for result in results]
    )


@router.post(
    "/metadata",
    response_model=DataQualityMetadataResponse,
    summary="生成仓库元数据补全 patch（M9-05）",
)
async def build_metadata(
    payload: DataQualityMetadataRequest,
    db: Session = Depends(get_db),
) -> DataQualityMetadataResponse:
    token = (get_settings().GITHUB_TOKEN or "").strip() or None
    items = await collect_metadata_patches(db, payload.repoIds, token=token)
    return DataQualityMetadataResponse(
        items=[DataQualityMetadataItemOut(**item) for item in items]
    )
