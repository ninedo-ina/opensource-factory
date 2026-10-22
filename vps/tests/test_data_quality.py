"""数据质量治理测试（M9-05 / M1-16，不访问网络）。"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

import app.api.data_quality as data_quality_api
from app.db import SessionLocal, init_db
from app.main import app
from app.models import MyRepository
from app.services.data_quality import (
    LinkItem,
    build_local_report,
    check_links,
    collect_metadata_patches,
    evaluate_response,
    normalize_url,
    reconcile_snapshot,
)

PREFIX = "dq-test-"


@pytest.fixture()
def db():
    init_db()
    session = SessionLocal()
    _cleanup(session)
    yield session
    session.rollback()
    _cleanup(session)
    session.close()


def _cleanup(session) -> None:
    session.execute(delete(MyRepository).where(MyRepository.id.like(f"{PREFIX}%")))
    session.commit()


def _repo(
    repo_id: str,
    *,
    name: str = "",
    description: str = "",
    language: str = "",
    summary: str = "",
    category: str = "",
    platform: str = "github",
    stars: int = 0,
    url: str = "",
    license_spdx: str = "",
) -> MyRepository:
    return MyRepository(
        id=f"{PREFIX}{repo_id}",
        platform=platform,
        name=name or repo_id,
        description=description,
        html_url=url or f"https://github.com/{PREFIX}{repo_id}",
        stars=stars,
        language=language,
        readme_summary=summary,
        category_id=category,
        license_spdx=license_spdx or None,
    )


def test_normalize_url_removes_scheme_noise_and_trailing_slash() -> None:
    assert normalize_url("https://GitHub.com/Acme/Demo/") == "https://github.com/Acme/Demo"
    assert normalize_url("https://github.com:443/Acme/Demo") == "https://github.com/Acme/Demo"
    assert normalize_url("") == ""


def test_evaluate_response_maps_status() -> None:
    assert evaluate_response("a", "https://github.com/a/b", 200, "https://github.com/a/b").status == "ok"
    assert evaluate_response("a", "https://github.com/a/b", 404, "").status == "broken"
    assert evaluate_response("a", "https://github.com/a/b", 410, "").status == "broken"
    redirected = evaluate_response(
        "a", "https://github.com/a/b", 301, "https://github.com/a/c"
    )
    assert redirected.status == "redirected"
    assert redirected.final_url == "https://github.com/a/c"
    assert evaluate_response("a", "https://github.com/a/b", 500, "").status == "unknown"


def test_check_links_degrades_per_item() -> None:
    async def fake_fetch(url: str):
        if "broken" in url:
            return SimpleNamespace(status_code=404, url=url)
        if "moved" in url:
            return SimpleNamespace(status_code=200, url="https://github.com/acme/new")
        if "error" in url:
            raise RuntimeError("timeout")
        return SimpleNamespace(status_code=200, url=url)

    results = asyncio.run(
        check_links(
            [
                LinkItem("ok", "https://github.com/acme/ok"),
                LinkItem("broken", "https://github.com/acme/broken"),
                LinkItem("moved", "https://github.com/acme/moved"),
                LinkItem("error", "https://github.com/acme/error"),
                LinkItem("empty", ""),
            ],
            fetcher=fake_fetch,
        )
    )
    by_id = {item.repo_id: item for item in results}
    assert by_id["ok"].status == "ok"
    assert by_id["broken"].status == "broken"
    assert by_id["moved"].status == "redirected"
    assert by_id["error"].status == "unknown"
    assert by_id["error"].error
    assert by_id["empty"].status == "unknown"


def test_collect_metadata_patches(db) -> None:
    db.add_all(
        [
            _repo("acme/demo", name="demo"),
            _repo("acme/gitee", name="gitee", platform="gitee"),
            _repo("acme/missing", name="missing"),
        ]
    )
    db.commit()

    async def fake_fetch(full_name: str):
        if full_name == f"{PREFIX}acme/demo":
            return {
                "description": "GitHub 简介",
                "language": "Rust",
                "stars": 42,
                "forks": 3,
                "html_url": "https://github.com/acme/renamed",
                "updated_at": None,
                "license_spdx": "MIT",
                "license_name": "MIT License",
                "license_source": "github",
            }
        return None

    items = asyncio.run(
        collect_metadata_patches(
            db,
            [f"{PREFIX}acme/demo", f"{PREFIX}acme/gitee", f"{PREFIX}acme/missing"],
            fetch_repo=fake_fetch,
        )
    )
    assert len(items) == 1
    assert items[0]["repoId"] == f"{PREFIX}acme/demo"
    assert items[0]["patch"]["language"] == "Rust"
    assert items[0]["patch"]["stars"] == 42
    assert items[0]["patch"]["license_source"] == "github"


def test_reconcile_snapshot_detects_missing_and_mismatch(db) -> None:
    db.add_all(
        [
            _repo("acme/one", name="one", stars=10),
            _repo("acme/two", name="two", stars=20),
        ]
    )
    db.commit()
    local = list(db.query(MyRepository).filter(MyRepository.id.like(f"{PREFIX}%")).all())
    assert len(local) == 2

    report = reconcile_snapshot(
        [
            {"id": f"{PREFIX}acme/one", "name": "one", "stars": 11},
            {"id": f"{PREFIX}acme/three", "name": "three", "stars": 1},
        ],
        local,
    )
    assert report["missingInLocal"] == 1
    assert report["missingInD1"] == 1
    assert report["mismatchCount"] == 1
    assert report["mismatchSample"][0]["fields"]["stars"] == {"d1": 11, "local": 10}
    assert report["ok"] is False


def test_reconcile_snapshot_ok_for_equal_data(db) -> None:
    db.add(_repo("acme/one", name="one", stars=10))
    db.commit()
    local = list(db.query(MyRepository).filter(MyRepository.id.like(f"{PREFIX}%")).all())
    report = reconcile_snapshot(
        [{"id": f"{PREFIX}acme/one", "name": "one", "stars": 10, "description": None,
          "language": None, "html_url": f"https://github.com/{PREFIX}acme/one"}],
        local,
    )
    assert report["ok"] is True


def test_build_local_report_counts_missing_fields(db) -> None:
    db.add_all(
        [
            _repo("acme/full", description="简介", language="Python", summary="摘要",
                  category="cat", license_spdx="MIT"),
            _repo("acme/empty"),
        ]
    )
    db.commit()
    rows = list(db.query(MyRepository).filter(MyRepository.id.like(f"{PREFIX}%")).all())
    report = build_local_report(rows)
    assert report["total"] == 2
    assert report["missing"]["description"] == 1
    assert report["missing"]["language"] == 1
    assert report["missing"]["license"] == 1
    assert report["missing"]["summary"] == 1
    assert report["missing"]["category"] == 1


def test_check_links_api_contract(monkeypatch) -> None:
    async def fake_check(items, *, fetcher=None):
        return [
            SimpleNamespace(
                to_dict=lambda: {
                    "repoId": "acme/demo",
                    "status": "broken",
                    "httpStatus": 404,
                    "finalUrl": None,
                    "error": None,
                }
            )
        ]

    monkeypatch.setattr(data_quality_api, "check_links", fake_check)
    client = TestClient(app)
    response = client.post(
        "/api/data-quality/check-links",
        json={"items": [{"repoId": "acme/demo", "url": "https://github.com/acme/demo"}]},
    )
    assert response.status_code == 200
    assert response.json()["results"][0]["status"] == "broken"


def test_metadata_api_contract(monkeypatch) -> None:
    async def fake_collect(db, repo_ids, *, token=None, fetch_repo=None):
        return [{"repoId": "acme/demo", "patch": {"language": "Go"}}]

    monkeypatch.setattr(data_quality_api, "collect_metadata_patches", fake_collect)
    client = TestClient(app)
    response = client.post("/api/data-quality/metadata", json={"repoIds": ["acme/demo"]})
    assert response.status_code == 200
    assert response.json()["items"] == [{"repoId": "acme/demo", "patch": {"language": "Go"}}]


def test_check_links_api_rejects_empty_items() -> None:
    client = TestClient(app)
    response = client.post("/api/data-quality/check-links", json={"items": []})
    assert response.status_code == 422
