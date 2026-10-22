"""主题聚类与自动标签测试（M6-11，不访问网络）。

覆盖：分词 / 标签归一化 / 关键词抽取 / 建议标签 / 贪心聚类 / 簇合并 /
最大主题数截断 / 未聚类原因 / 数据库读取 / 内部 API 契约。
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.db import SessionLocal, init_db
from app.main import app
from app.models import MyRepository, RepoVector
from app.services.theme_clustering import (
    ThemeOptions,
    ThemeRepo,
    build_theme_result,
    cluster_vectors,
    extract_keywords,
    normalize_tag,
    suggest_tags,
    tokenize,
)


@pytest.fixture()
def db():
    init_db()
    session = SessionLocal()
    session.execute(delete(RepoVector).where(RepoVector.repo_id.like("theme-test/%")))
    session.execute(delete(MyRepository).where(MyRepository.id.like("theme-test/%")))
    session.commit()
    yield session
    # 清理本文件写入的数据，避免污染同库的其他测试（如向量化管线）
    session.execute(delete(RepoVector).where(RepoVector.repo_id.like("theme-test/%")))
    session.execute(delete(MyRepository).where(MyRepository.id.like("theme-test/%")))
    session.commit()
    session.close()


def _repo(repo_id: str, **kwargs) -> ThemeRepo:
    return ThemeRepo(id=repo_id, name=kwargs.pop("name", repo_id.split("/")[-1]), **kwargs)


def test_tokenize_mixed_text_filters_stopwords() -> None:
    tokens = tokenize("A modern React component library 支持多租户后台")
    assert "react" in tokens
    assert "component" in tokens
    # 停用词 / 泛词被过滤
    assert "modern" not in tokens
    assert "library" not in tokens
    assert "a" not in tokens
    # 中文 bigram
    assert "多租" in tokens
    assert "租户" in tokens


def test_normalize_tag() -> None:
    assert normalize_tag("Machine Learning") == "machine-learning"
    assert normalize_tag("  Vue_3  ") == "vue-3"
    assert normalize_tag("***") == ""
    assert normalize_tag("C++") == "c++"


def test_extract_keywords_prefers_cluster_specific_terms() -> None:
    repos = [
        _repo("a", name="react-dashboard", description="React admin dashboard with charts"),
        _repo("b", name="react-admin", description="React admin panel for SaaS"),
        _repo("c", name="vue-admin", description="Vue admin dashboard"),
    ]
    keywords = extract_keywords(repos, max_keywords=5)
    assert "admin" in keywords
    assert "dashboard" in keywords
    # 三个仓库都有的词在全局频率惩罚下不应排到最前
    assert keywords[0] in {"react", "admin", "dashboard"}


def test_suggest_tags_skips_common_existing_tag() -> None:
    repos = [
        _repo("a", name="react-admin", tags=("admin",)),
        _repo("b", name="react-dashboard", tags=("admin",)),
    ]
    tags = suggest_tags(["admin", "react", "dashboard"], repos, max_tags=3)
    assert tags == ["react", "dashboard"]


def test_cluster_vectors_groups_similar_and_marks_singletons() -> None:
    items = [
        (_repo("a", stars=100), [1.0, 0.0, 0.0]),
        (_repo("b", stars=80), [0.98, 0.17, 0.0]),
        (_repo("c", stars=60), [0.96, 0.28, 0.0]),
        (_repo("d", stars=10), [0.0, 1.0, 0.0]),
    ]
    result = cluster_vectors(
        items,
        ThemeOptions(min_similarity=0.55, min_cluster_size=2, max_clusters=12),
    )
    assert len(result.themes) == 1
    assert result.themes[0].repo_count == 3
    assert [repo.id for repo in result.themes[0].repos] == ["a", "b", "c"]
    assert result.clustered == 3
    assert result.unclustered == [(_repo("d", stars=10), "singleton")]


def test_cluster_vectors_merges_split_clusters() -> None:
    # a 与 b 相距 30°（0.866 < 0.9）先各自成簇；c 靠近 a 使 a 簇质心偏移，
    # 合并阶段 a / b 两簇质心相似度 >= 0.9，应合并为一个主题。
    items = [
        (_repo("a", stars=100), [1.0, 0.0]),
        (_repo("b", stars=90), [0.866, 0.5]),
        (_repo("c", stars=80), [0.966, 0.259]),
    ]
    result = cluster_vectors(
        items,
        ThemeOptions(min_similarity=0.9, min_cluster_size=1, max_clusters=12),
    )
    assert len(result.themes) == 1
    assert result.themes[0].repo_count == 3


def test_cluster_vectors_respects_max_clusters() -> None:
    items = [
        (_repo(f"r{i}", stars=100 - i), [1.0 if i == j else 0.0 for j in range(4)])
        for i in range(4)
    ]
    result = cluster_vectors(
        items,
        ThemeOptions(min_similarity=0.9, min_cluster_size=1, max_clusters=2),
    )
    assert len(result.themes) == 2
    assert len(result.unclustered) == 2
    assert all(reason == "overflow" for _, reason in result.unclustered)


def test_build_theme_result_reads_vectors_and_marks_missing(db) -> None:
    repos = [
        MyRepository(
            id="theme-test/react-admin",
            platform="github",
            name="react-admin",
            description="React admin dashboard",
            html_url="https://example.com/theme-test/react-admin",
            stars=120,
            language="TypeScript",
        ),
        MyRepository(
            id="theme-test/react-panel",
            platform="github",
            name="react-panel",
            description="React admin panel",
            html_url="https://example.com/theme-test/react-panel",
            stars=90,
            language="TypeScript",
        ),
        MyRepository(
            id="theme-test/react-console",
            platform="github",
            name="react-console",
            description="React admin console",
            html_url="https://example.com/theme-test/react-console",
            stars=60,
            language="TypeScript",
        ),
        MyRepository(
            id="theme-test/rust-cli",
            platform="github",
            name="rust-cli",
            description="Rust command line tool",
            html_url="https://example.com/theme-test/rust-cli",
            stars=30,
            language="Rust",
        ),
        MyRepository(
            id="theme-test/no-vector",
            platform="github",
            name="no-vector",
            description="Not vectorized yet",
            html_url="https://example.com/theme-test/no-vector",
            stars=10,
        ),
    ]
    db.add_all(repos)
    db.commit()

    vectors = {
        "theme-test/react-admin": [1.0, 0.0, 0.0],
        "theme-test/react-panel": [0.98, 0.17, 0.0],
        "theme-test/react-console": [0.96, 0.28, 0.0],
        "theme-test/rust-cli": [0.0, 1.0, 0.0],
    }
    for repo_id, vector in vectors.items():
        db.add(
            RepoVector(
                source="my",
                repo_id=repo_id,
                model="test-model",
                backend="hash",
                dim=len(vector),
                text_hash=f"hash-{repo_id}",
                vector=json.dumps(vector),
            )
        )
    db.commit()

    result = build_theme_result(
        db,
        [
            "theme-test/react-admin",
            "theme-test/react-panel",
            "theme-test/react-console",
            "theme-test/rust-cli",
            "theme-test/no-vector",
            "theme-test/not-exists",
        ],
        ThemeOptions(min_similarity=0.55, min_cluster_size=2, max_clusters=12),
    )

    assert result["stats"]["totalRepos"] == 5
    assert result["stats"]["clusteredRepos"] == 3
    assert result["stats"]["themeCount"] == 1
    assert result["stats"]["coverage"] == 60.0
    assert result["model"] == "test-model"
    assert result["dim"] == 3
    reasons = {item["id"]: item["reason"] for item in result["unclustered"]}
    assert reasons["theme-test/rust-cli"] == "singleton"
    assert reasons["theme-test/no-vector"] == "no_vector"
    assert "theme-test/not-exists" not in reasons
    theme = result["themes"][0]
    assert theme["repoCount"] == 3
    assert theme["suggestedTags"]
    assert theme["cohesion"] > 0.9


def test_cluster_api_contract_and_empty(db) -> None:
    client = TestClient(app)
    empty = client.post("/api/themes/cluster", json={"repoIds": []})
    assert empty.status_code == 200
    assert empty.json()["themes"] == []
    assert empty.json()["stats"]["totalRepos"] == 0

    repo = MyRepository(
        id="theme-test/api-repo",
        platform="github",
        name="api-repo",
        description="API test repository",
        html_url="https://example.com/theme-test/api-repo",
        stars=1,
    )
    db.add(repo)
    db.add(
        RepoVector(
            source="my",
            repo_id=repo.id,
            model="test-model",
            backend="hash",
            dim=2,
            text_hash="hash-api",
            vector=json.dumps([1.0, 0.0]),
        )
    )
    db.commit()

    response = client.post(
        "/api/themes/cluster",
        json={
            "repoIds": [repo.id],
            "minSimilarity": 2,
            "minClusterSize": 0,
            "maxClusters": 999,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["thresholds"] == {
        "minSimilarity": 0.99,
        "minClusterSize": 1,
        "maxClusters": 50,
    }
    assert body["stats"]["totalRepos"] == 1
    # minClusterSize 被夹取到 1，单仓库也会形成一个主题
    assert body["themes"][0]["repoCount"] == 1
    assert body["unclustered"] == []
