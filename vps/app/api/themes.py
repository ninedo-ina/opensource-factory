"""主题聚类内部接口 `/api/themes/*`（M6-11）。

供 edge Worker 调用，统一要求 `X-Internal-Token`（`INTERNAL_TOKEN` 为空时不鉴权）：

- `POST /api/themes/cluster`：对当前用户收藏仓库的向量做只读聚类，返回主题、
  关键词、建议标签与未聚类仓库。VPS 不做用户隔离，`repoIds` 必须由 edge 按
  当前登录用户过滤后传入。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas import ThemeClusterRequest, ThemeClusterResponse
from app.security import require_internal_token
from app.services.theme_clustering import ThemeOptions, build_theme_result

router = APIRouter(
    prefix="/api/themes",
    tags=["themes"],
    dependencies=[Depends(require_internal_token)],
)


@router.post(
    "/cluster",
    response_model=ThemeClusterResponse,
    status_code=status.HTTP_200_OK,
    summary="收藏库主题聚类与标签建议",
)
def cluster_themes(
    payload: ThemeClusterRequest, db: Session = Depends(get_db)
) -> ThemeClusterResponse:
    options = ThemeOptions.from_settings(
        min_similarity=payload.minSimilarity,
        min_cluster_size=payload.minClusterSize,
        max_clusters=payload.maxClusters,
    )
    result = build_theme_result(db, payload.repoIds, options)
    return ThemeClusterResponse(**result)
