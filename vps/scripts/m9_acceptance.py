#!/usr/bin/env python3
"""M9 验收 · 数据资产与洞察跨分支走查（零额外依赖、可离线复跑）。

覆盖已交付的 M9-01~05，并对平台仍为 pending 的 M9-06 输出缺口状态：

    M9-01 个人技术画像（语言 / 框架分布 / 收藏趋势 / 活跃度）
    M9-02 资产报表（收录量 / 分类分布 / Star 趋势）
    M9-03 数据导入（JSON / CSV / 书签 HTML，预览 / 执行 / 历史）
    M9-04 全量导出与归档（openfactory.archive.v1，ZIP / JSON + SHA-256）
    M9-05 数据质量治理（质量台账 / 失效链接 / 元数据补全 / M1-16 对账）
    M9-06 数据保留与隐私策略（策略 / 导出 / 删除 / 每日清理）

用法（在 vps/ 下）：

    python scripts/m9_acceptance.py
    python scripts/m9_acceptance.py --strict
    python scripts/m9_acceptance.py --report-md docs/planning/acceptance-m9-report.md \
        --report-json docs/planning/acceptance-m9-report.json
"""
from __future__ import annotations

import argparse
import json
import platform
import subprocess
import sys
import time
from pathlib import Path

VPS_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = VPS_ROOT.parent
sys.path.insert(0, str(VPS_ROOT))

RESULTS: list[dict[str, object]] = []


# ---------------------------------------------------------------------------
# 结果记录
# ---------------------------------------------------------------------------
def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def assert_equal(actual: object, expected: object, label: str) -> None:
    if actual != expected:
        raise AssertionError(f"{label}：期望 {expected!r}，实际 {actual!r}")


def check(cid: str, title: str, fn, *args) -> None:
    started = time.perf_counter()
    try:
        detail = fn(*args) or ""
        RESULTS.append(
            {
                "id": cid,
                "title": title,
                "status": "PASS",
                "detail": str(detail),
                "durationMs": round((time.perf_counter() - started) * 1000, 1),
            }
        )
        print(f"  ✔ [PASS] {title}" + (f" — {detail}" if detail else ""))
    except Exception as exc:  # noqa: BLE001 - 单项失败不影响其余检查
        RESULTS.append(
            {
                "id": cid,
                "title": title,
                "status": "FAIL",
                "detail": str(exc),
                "durationMs": round((time.perf_counter() - started) * 1000, 1),
            }
        )
        print(f"  ✖ [FAIL] {title} — {exc}")


def gap(cid: str, title: str, detail: str) -> None:
    RESULTS.append(
        {"id": cid, "title": title, "status": "GAP", "detail": detail, "durationMs": 0.0}
    )
    print(f"  ○ [GAP ] {title} — {detail}")


# ---------------------------------------------------------------------------
# 读取辅助
# ---------------------------------------------------------------------------
def _read(relative: str) -> str:
    path = REPO_ROOT / relative
    assert_true(path.exists(), f"缺少文件：{relative}")
    return path.read_text(encoding="utf-8")


def _json(relative: str) -> dict:
    return json.loads(_read(relative))


def _exists(relative: str) -> bool:
    return (REPO_ROOT / relative).exists()


# ---------------------------------------------------------------------------
# M9-01 个人技术画像
# ---------------------------------------------------------------------------
def check_tech_profile_aggregate() -> str:
    aggregate = _read("edge/src/tech-profile/aggregate.ts")
    for symbol in (
        "export function buildTechProfile",
        "export function parseProfileDate",
        "export function monthKey",
        "export function shiftMonth",
        "TechProfileResponse",
        "ProfileType",
    ):
        assert_true(symbol in aggregate, f"aggregate.ts 缺少 {symbol}")
    for concept in ("语言 / 框架分布", "收藏趋势", "活跃度分", "画像类型", "确定性洞察"):
        assert_true(concept in aggregate, f"aggregate.ts 缺少能力 {concept}")
    return "纯函数 buildTechProfile / 语言 / 框架 / 趋势 / 活跃度 / 洞察"


def check_tech_profile_route() -> str:
    route = _read("edge/src/routes/tech-profile.ts")
    assert_true("techProfile.get('/'" in route, "缺少 GET /api/tech-profile")
    assert_true("Math.min(24, Math.max(1" in route, "months 未限制在 1..24")
    assert_true("WHERE r.user_id = ?" in route, "查询未按 user_id 隔离")
    assert_true("buildTechProfile(" in route, "路由未调用聚合纯函数")
    index = _read("edge/src/index.ts")
    assert_true("app.route('/api/tech-profile'" in index, "index.ts 未挂载 tech-profile")
    _read("admin/src/features/tech-profile/index.tsx")
    _read("admin/src/routes/_authenticated/tech-profile/index.tsx")
    sidebar = _read("admin/src/components/layout/data/sidebar-data.ts")
    assert_true("url: '/tech-profile'" in sidebar, "侧边栏缺少技术画像入口")
    return "登录态 / months 1..24 / user_id 隔离 / admin 页面"


# ---------------------------------------------------------------------------
# M9-02 资产报表
# ---------------------------------------------------------------------------
def check_asset_report_aggregate() -> str:
    aggregate = _read("edge/src/asset-report/aggregate.ts")
    for symbol in (
        "export function buildAssetReport",
        "export function normalizeMonths",
        "export function starTrendDays",
        "unknownCreated",
        "coverage",
    ):
        assert_true(symbol in aggregate, f"aggregate.ts 缺少 {symbol}")
    for concept in ("收录量", "分类分布", "Star 趋势", "分类覆盖率", "确定性洞察"):
        assert_true(concept in aggregate, f"aggregate.ts 缺少能力 {concept}")
    return "收录量 / 分类 / 语言 / Star 趋势 / 覆盖率 / 洞察"


def check_asset_report_route() -> str:
    route = _read("edge/src/routes/asset-report.ts")
    assert_true("assetReport.get('/'" in route, "缺少 GET /api/asset-report")
    assert_true("normalizeMonths(" in route, "路由未归一 months")
    assert_true("FROM trending_snapshots" in route, "未读取 trending_snapshots")
    assert_true("repo_id IN" in route, "快照查询未按收藏仓库白名单")
    assert_true("WHERE user_id = ?" in route, "收藏查询未按 user_id 隔离")
    index = _read("edge/src/index.ts")
    assert_true("app.route('/api/asset-report'" in index, "index.ts 未挂载 asset-report")
    _read("admin/src/features/asset-report/index.tsx")
    _read("admin/src/routes/_authenticated/asset-report/index.tsx")
    sidebar = _read("admin/src/components/layout/data/sidebar-data.ts")
    assert_true("url: '/asset-report'" in sidebar, "侧边栏缺少资产报表入口")
    return "months 归一 / 快照白名单 / user_id 隔离 / admin 页面"


# ---------------------------------------------------------------------------
# M9-03 数据导入
# ---------------------------------------------------------------------------
def check_import_parse() -> str:
    parse = _read("edge/src/import/parse.ts")
    for symbol in (
        "export function parseImportContent",
        "export function detectImportFormat",
        "export function parseCsvRows",
        "export function parseRepoUrl",
        "export function buildImportPlan",
        "MAX_CONTENT_LENGTH = 2_000_000",
        "MAX_IMPORT_ENTRIES = 2_000",
        "MAX_TAGS_PER_REPO = 20",
    ):
        assert_true(symbol in parse, f"parse.ts 缺少 {symbol}")
    for fmt in ("openfactory.knowledge.v1", "csv", "html"):
        assert_true(fmt in parse, f"parse.ts 缺少格式 {fmt}")
    return "JSON / CSV / 书签 HTML / 去重 / 预览计划"


def check_import_route() -> str:
    route = _read("edge/src/routes/import.ts")
    for endpoint in ("'/preview'", "'/execute'", "'/history'"):
        assert_true(endpoint in route, f"import 路由缺少 {endpoint}")
    assert_true("INSERT INTO import_runs" in route, "执行未写 import_runs 审计")
    index = _read("edge/src/index.ts")
    assert_true("app.route('/api/import'" in index, "index.ts 未挂载 import")
    migration = _read("edge/migrations/0023_data_import.sql")
    for needle in ("CREATE TABLE IF NOT EXISTS import_runs", "user_id", "conflicts"):
        assert_true(needle in migration, f"迁移缺少 {needle}")
    schema = _read("docs/assets/d1-schema.sql")
    assert_true("CREATE TABLE IF NOT EXISTS import_runs" in schema, "d1-schema 缺少 import_runs")
    _read("admin/src/features/import/index.tsx")
    _read("admin/src/routes/_authenticated/import/index.tsx")
    return "预览 / 执行 / 历史 / import_runs 迁移 0023 / admin 页面"


# ---------------------------------------------------------------------------
# M9-04 全量导出与归档
# ---------------------------------------------------------------------------
def check_archive_build() -> str:
    build = _read("edge/src/archive/build.ts")
    for symbol in (
        "ARCHIVE_SCHEMA = 'openfactory.archive.v1'",
        "export async function buildArchive",
        "export async function buildArchiveManifest",
        "ARCHIVE_EXCLUDED",
        "checksums",
    ):
        assert_true(symbol in build, f"build.ts 缺少 {symbol}")
    for excluded in ("sessions", "extension_tokens", "telegram_links", "security_events"):
        assert_true(excluded in build, f"排除项缺少 {excluded}")
    hash_file = _read("edge/src/archive/hash.ts")
    assert_true("sha256" in hash_file.lower(), "hash.ts 未实现 SHA-256")
    return "openfactory.archive.v1 / ZIP / JSON / SHA-256 / 敏感表排除"


def check_archive_route() -> str:
    route = _read("edge/src/routes/archive.ts")
    for endpoint in ("'/summary'", "'/manifest'"):
        assert_true(endpoint in route, f"archive 路由缺少 {endpoint}")
    assert_true("archiveRoutes.get('/'" in route, "缺少归档下载入口")
    assert_true("Content-Disposition" in route, "缺少附件下载头")
    export_route = _read("edge/src/routes/export.ts")
    assert_true("exportRoutes.route('/archive', archiveRoutes)" in export_route, "export 路由未挂载 archive")
    index = _read("edge/src/index.ts")
    assert_true("app.route('/api/export'" in index, "index.ts 未挂载 export")
    _read("admin/src/features/archive/index.tsx")
    _read("admin/src/routes/_authenticated/archive/index.tsx")
    _read("docs/guides/full-export-archive.md")
    return "summary / manifest / 下载 / 附件头 / admin 页面 / 格式指南"


# ---------------------------------------------------------------------------
# M9-05 数据质量治理
# ---------------------------------------------------------------------------
def check_data_quality_edge() -> str:
    checks = _read("edge/src/data-quality/checks.ts")
    for symbol in (
        "export function checkAllMetadata",
        "export function buildDuplicateIssues",
        "export function buildLinkIssues",
        "export function scoreQuality",
        "MAX_LINK_CHECKS = 30",
        "STALE_AFTER_DAYS = 90",
    ):
        assert_true(symbol in checks, f"checks.ts 缺少 {symbol}")
    route = _read("edge/src/routes/data-quality.ts")
    for endpoint in (
        "dataQuality.get('/'",
        "dataQuality.post('/scan'",
        "dataQuality.post('/fix'",
        "dataQuality.post('/issues/ignore'",
        "dataQuality.post('/issues/restore'",
        "internalDataQuality.get('/mirror'",
    ):
        assert_true(endpoint in route, f"data-quality 路由缺少 {endpoint}")
    migration = _read("edge/migrations/0024_data_quality.sql")
    for needle in (
        "CREATE TABLE IF NOT EXISTS data_quality_scans",
        "CREATE TABLE IF NOT EXISTS data_quality_issues",
        "user_id, repo_id, issue_key",
    ):
        assert_true(needle in migration, f"迁移缺少 {needle}")
    schema = _read("docs/assets/d1-schema.sql")
    for table in ("data_quality_scans", "data_quality_issues"):
        assert_true(f"CREATE TABLE IF NOT EXISTS {table}" in schema, f"d1-schema 缺少 {table}")
    return "扫描 / 补全 / 忽略 / 恢复 / 内部镜像 / 迁移 0024"


def check_data_quality_vps() -> str:
    from app.services.data_quality import (
        MAX_LINK_CHECKS,
        evaluate_response,
        normalize_url,
        reconcile_snapshot,
    )

    assert_equal(MAX_LINK_CHECKS, 50, "链接检测上限")
    assert_equal(normalize_url("https://GitHub.com/Owner/Repo/"), "https://github.com/Owner/Repo", "URL 归一")
    assert_equal(evaluate_response("a/b", "https://github.com/a/b", 404, "").status, "broken", "404 状态")
    assert_equal(
        evaluate_response("a/b", "https://github.com/a/b", 301, "https://github.com/a/b/").status,
        "ok",
        "同址尾斜杠视为 ok",
    )
    assert_equal(
        evaluate_response("a/b", "https://github.com/a/b", 301, "https://github.com/c/d").status,
        "redirected",
        "跨址跳转",
    )
    assert_equal(evaluate_response("a/b", "https://github.com/a/b", 500, "").status, "unknown", "5xx 状态")

    from app.models import MyRepository

    local = [
        MyRepository(
            id="a/b",
            platform="github",
            name="b",
            description=None,
            html_url="https://github.com/a/b",
            stars=10,
            language="Python",
        )
    ]
    report = reconcile_snapshot(
        [{"id": "a/b", "name": "b", "description": "d", "language": "Python", "stars": 10, "html_url": "https://github.com/a/b"}],
        local,
    )
    assert_equal(report["mismatchCount"], 1, "对账差异数")
    assert_equal(report["ok"], False, "对账 ok 标记")
    _read("vps/app/data_quality.py")
    _read("vps/tests/test_data_quality.py")
    _read("admin/src/features/data-quality/index.tsx")
    return "链接状态纯函数 / 对账 / CLI / 测试 / admin 页面"


# ---------------------------------------------------------------------------
# M9-06 数据保留与隐私
# ---------------------------------------------------------------------------
def check_privacy_edge() -> str:
    policy = _read("edge/src/privacy/policy.ts")
    for symbol in (
        "PRIVACY_POLICY_VERSION",
        "export function buildPrivacyPolicy",
        "export function isAccountDeletionConfirmed",
        "retention",
    ):
        assert_true(symbol in policy, f"policy.ts 缺少 {symbol}")
    cleanup = _read("edge/src/privacy/cleanup.ts")
    for symbol in ("export async function cleanupExpiredData", "retention_cleanup", "DELETE FROM"):
        assert_true(symbol in cleanup, f"cleanup.ts 缺少 {symbol}")
    export_file = _read("edge/src/privacy/export.ts")
    assert_true("buildPersonalDataExport" in export_file, "export.ts 缺少个人数据导出")
    route = _read("edge/src/routes/privacy.ts")
    for endpoint in ("privacy.get('/policy'", "privacy.get('/export'", "privacy.delete('/account'"):
        assert_true(endpoint in route, f"privacy 路由缺少 {endpoint}")
    index = _read("edge/src/index.ts")
    assert_true("app.route('/api/privacy'" in index, "index.ts 未挂载 privacy")
    migration = _read("edge/migrations/0025_privacy_lifecycle.sql")
    assert_true("CREATE TABLE IF NOT EXISTS privacy_events" in migration, "迁移缺少 privacy_events")
    schema = _read("docs/assets/d1-schema.sql")
    assert_true("CREATE TABLE IF NOT EXISTS privacy_events" in schema, "d1-schema 缺少 privacy_events")
    _read("admin/src/features/privacy/index.tsx")
    _read("admin/src/routes/_authenticated/settings/privacy.tsx")
    _read("docs/guides/privacy-retention.md")
    return "策略 / 导出 / 删除 / 保留清理 / 迁移 0025 / admin 隐私页 / 隐私指南"


def check_privacy_vps() -> str:
    from app.services.privacy_retention import (
        PRIVACY_POLICY_VERSION,
        cleanup_expired_data,
        purge_user_data,
        retention_status,
    )

    assert_true(bool(PRIVACY_POLICY_VERSION), "缺少策略版本")
    assert_true(
        all(callable(fn) for fn in (cleanup_expired_data, purge_user_data, retention_status)),
        "保留清理接口缺失",
    )
    _read("vps/app/api/privacy.py")
    _read("vps/tests/test_privacy_retention.py")
    return "VPS 保留策略 / 清理服务 / API / 测试"


# ---------------------------------------------------------------------------
# 跨切面 / 迁移 / 文档
# ---------------------------------------------------------------------------
def check_cross_cutting() -> str:
    index = _read("edge/src/index.ts")
    for route in (
        "/api/tech-profile",
        "/api/asset-report",
        "/api/import",
        "/api/export",
        "/api/data-quality",
        "/api/privacy",
    ):
        assert_true(f"app.route('{route}'" in index, f"index.ts 未挂载 {route}")
    route_tree = _read("admin/src/routeTree.gen.ts")
    for route in ("/tech-profile", "/asset-report", "/import", "/archive", "/data-quality", "/settings/privacy"):
        assert_true(route in route_tree, f"routeTree 缺少 {route}")
    return "edge 路由挂载 + admin 路由树完整"


def check_migrations() -> str:
    names = {path.name for path in (REPO_ROOT / "edge" / "migrations").glob("00*.sql")}
    for expected in (
        "0021_telegram_bot.sql",
        "0022_extension_tokens.sql",
        "0023_data_import.sql",
        "0024_data_quality.sql",
        "0025_privacy_lifecycle.sql",
    ):
        assert_true(expected in names, f"缺少迁移 {expected}")
    m9_numbers = [name[:4] for name in names if name[:4] >= "0021"]
    assert_equal(len(m9_numbers), len(set(m9_numbers)), "M9 迁移编号存在重号")
    return "M9 迁移 0023/0024/0025 编号唯一，0021/0022 保持"


def check_docs_status() -> str:
    backlog = _read("docs/requirements/backlog.md")
    for item in ("M9-01", "M9-02", "M9-03", "M9-04", "M9-05", "M9-06", "M9-07"):
        line = next((row for row in backlog.splitlines() if row.startswith(f"| {item} |")), "")
        assert_true("✅" in line, f"backlog {item} 未标记完成")
    _read("docs/planning/acceptance-m9.md")
    _read("docs/planning/plan-req-202610-0984-m9-acceptance.md")
    return "backlog 状态正确，验收结论与计划文档齐全"


def check_gaps() -> None:
    branch = "feat/req-202610-0983-data-retention-privacy"
    try:
        merged = (
            subprocess.run(
                ["git", "merge-base", "--is-ancestor", branch, "HEAD"],
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
                timeout=15,
            ).returncode
            == 0
        )
    except Exception:  # noqa: BLE001 - 分支不存在按缺口处理
        merged = False
    if merged:
        RESULTS.append(
            {
                "id": "M9-06-GAP",
                "title": "M9-06 数据保留与隐私策略（已合并，待平台状态确认）",
                "status": "PASS",
                "detail": f"{branch} 已包含在验收分支",
                "durationMs": 0.0,
            }
        )
    else:
        gap(
            "M9-06-GAP",
            "M9-06 数据保留与隐私策略（平台 pending）",
            f"{branch} 未合并，需该需求交付后补充验收",
        )


# ---------------------------------------------------------------------------
# 报告
# ---------------------------------------------------------------------------
def summarize() -> dict[str, int]:
    counts = {"PASS": 0, "FAIL": 0, "GAP": 0}
    for item in RESULTS:
        status = str(item["status"])
        counts[status] = counts.get(status, 0) + 1
    return counts


def git_info() -> tuple[str, str]:
    try:
        branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        commit = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        return branch, commit
    except Exception:  # noqa: BLE001 - 报告不因 git 缺失失败
        return "unknown", "unknown"


def build_markdown(meta: dict[str, str]) -> str:
    rows = "\n".join(
        f"| {item['id']} | {item['title']} | {item['status']} | {item['detail']} | {item['durationMs']}ms |"
        for item in RESULTS
    )
    summary = summarize()
    if summary["FAIL"]:
        conclusion = "存在失败项，M9 验收不通过"
    elif summary["GAP"]:
        conclusion = (
            "M9-01~05 已交付能力全部通过；M9-06 平台状态仍为 pending，"
            "本轮判定为部分验收（有条件通过）"
        )
    else:
        conclusion = "全部通过，M9 验收通过"
    return f"""# M9 验收报告（自动生成）

- 生成时间：{meta['finishedAt']}
- 分支 / 提交：{meta['branch']} / {meta['commit']}
- 运行环境：{meta['platform']} · Python {meta['python']}
- 验收方式：跨分支静态资产检查 + M9-05 纯函数实跑 + 缺口登记
- 判定口径：PASS 通过 · FAIL 行为错误 · GAP 未交付缺口（不计入通过率）

## 检查结果

| # | 检查 | 结果 | 说明 | 耗时 |
| --- | --- | --- | --- | --- |
{rows}

## 汇总

- PASS：{summary['PASS']}
- FAIL：{summary['FAIL']}
- GAP：{summary['GAP']}
- 结论：{conclusion}
"""


def main() -> int:
    parser = argparse.ArgumentParser(description="M9 验收脚本")
    parser.add_argument("--strict", action="store_true", help="存在 GAP 或 FAIL 时返回非零")
    parser.add_argument("--report-md", default=None, help="Markdown 报告输出路径")
    parser.add_argument("--report-json", default=None, help="JSON 报告输出路径")
    args = parser.parse_args()

    print("• M9-01 个人技术画像…")
    check("M9-A01", "M9-01 技术画像聚合纯函数", check_tech_profile_aggregate)
    check("M9-A02", "M9-01 路由与 admin 页面", check_tech_profile_route)

    print("• M9-02 资产报表…")
    check("M9-B01", "M9-02 资产报表聚合纯函数", check_asset_report_aggregate)
    check("M9-B02", "M9-02 路由与 admin 页面", check_asset_report_route)

    print("• M9-03 数据导入…")
    check("M9-C01", "M9-03 三格式解析与预览计划", check_import_parse)
    check("M9-C02", "M9-03 导入接口与迁移", check_import_route)

    print("• M9-04 全量导出与归档…")
    check("M9-D01", "M9-04 归档构建与校验和", check_archive_build)
    check("M9-D02", "M9-04 归档接口与 admin 页面", check_archive_route)

    print("• M9-05 数据质量治理…")
    check("M9-E01", "M9-05 edge 扫描 / 补全 / 迁移", check_data_quality_edge)
    check("M9-E02", "M9-05 VPS 链接检测与对账", check_data_quality_vps)

    print("• M9-06 数据保留与隐私…")
    check("M9-F01", "M9-06 edge 策略 / 导出 / 删除 / 清理", check_privacy_edge)
    check("M9-F02", "M9-06 VPS 保留清理与测试", check_privacy_vps)

    print("• 跨切面检查…")
    check("M9-S01", "edge / admin 路由集成", check_cross_cutting)
    check("M9-S02", "M9 迁移编号唯一", check_migrations)
    check("M9-S03", "需求与验收文档状态", check_docs_status)
    check_gaps()

    summary = summarize()
    print(f"\n汇总：PASS {summary['PASS']} · FAIL {summary['FAIL']} · GAP {summary['GAP']}")

    branch, commit = git_info()
    meta = {
        "branch": branch,
        "commit": commit,
        "finishedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "platform": platform.platform(),
        "python": platform.python_version(),
    }
    if args.report_md:
        target = (REPO_ROOT / args.report_md).resolve()
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(build_markdown(meta), encoding="utf-8")
        print(f"• 已写入 Markdown 报告：{target}")
    if args.report_json:
        target = (REPO_ROOT / args.report_json).resolve()
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(
            json.dumps({"meta": meta, "results": RESULTS}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"• 已写入 JSON 报告：{target}")

    if summary["FAIL"] > 0 or (args.strict and summary["GAP"] > 0):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
