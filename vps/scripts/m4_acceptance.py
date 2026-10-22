#!/usr/bin/env python3
"""M4 验收 · 定向推送端到端走查（零第三方依赖，全部本地执行）。

覆盖 VPS 侧 M4 能力：
  M4-01 每日评估（质量分 + 匹配度阈值）
  M4-03 Bark 通道（真实 dispatch + 注入假客户端，不访问网络）
  M4-04 Telegram 摘要（注入假客户端，不访问网络）
  M4-05 Email 摘要（注入假 sender，不访问 SMTP）
  M4-06 推送偏好（内部接口客户端 + 时间窗口 / 阈值纯函数）
  M4-07 去重与静默（策略 API + daily_push 账本）
  M4-08 推送记录与回执（列表 / 统计 / 详情 / 回执 / 脱敏）

M4-02 站内通知中心在 edge / D1，由 `edge/scripts/m4-acceptance.mjs` 走查；
本脚本只验证其数据源（daily_push 产出的 `pushed` 推荐）。

用法（在 vps/ 下）：
  .venv/bin/python scripts/m4_acceptance.py
  .venv/bin/python scripts/m4_acceptance.py --strict
  .venv/bin/python scripts/m4_acceptance.py --report-md docs/planning/acceptance-m4-report.md \
      --report-json docs/planning/acceptance-m4-report.json
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

_TMP_DIR = tempfile.mkdtemp(prefix="opensource-factory-m4-acceptance-")
os.environ["DATABASE_URL"] = f"sqlite:///{os.path.join(_TMP_DIR, 'm4.db')}"
os.environ["CELERY_TASK_ALWAYS_EAGER"] = "1"
os.environ["GITHUB_TOKEN"] = ""
os.environ["OLLAMA_BASE_URL"] = ""
os.environ["DEEPSEEK_API_KEY"] = ""
os.environ["EMBEDDING_FORCE_FALLBACK"] = "1"
os.environ["VECTORIZE_AUTO"] = "0"
os.environ["INTERNAL_TOKEN"] = "e2e-m4-internal-token"
os.environ["PUSH_QUIET_HOURS_START"] = ""
os.environ["PUSH_QUIET_HOURS_END"] = ""
os.environ["BARK_ENABLED"] = "false"
os.environ["TELEGRAM_ENABLED"] = "false"
os.environ["EMAIL_ENABLED"] = "false"

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import delete, select  # noqa: E402

from app.config import Settings, get_settings  # noqa: E402
from app.db import SessionLocal, init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import (  # noqa: E402
    MyRepository,
    PushDelivery,
    PushEvent,
    Recommendation,
    TelegramDelivery,
    TrendingRepository,
    User,
)
from app.services.bark import BarkResult, dispatch_bark_notifications  # noqa: E402
from app.services.email_channel import EmailSendResult, send_digest as send_email_digest  # noqa: E402
from app.services.push_preferences import (  # noqa: E402
    PushPreferenceClient,
    filter_recommendations,
    is_due,
    normalize_preferences,
)
from app.services.telegram import TelegramSendResult, send_digest as send_telegram_digest  # noqa: E402
from app.tasks import jobs  # noqa: E402

USER_ID = "m4-acceptance-user"
REC_ID = "m4-acceptance-rec-1"
TREND_ID = "m4-acceptance/trend"
MY_ID = "m4-acceptance/my"
TOKEN = os.environ["INTERNAL_TOKEN"]
PERF_SAMPLES = 100
PERF_BUDGET_MS = 300.0

CHECKS: list[dict[str, object]] = []


class CheckFailure(AssertionError):
    """验收断言失败。"""


def assert_true(value: object, message: str) -> None:
    if not value:
        raise CheckFailure(message)


def assert_equal(actual: object, expected: object, message: str) -> None:
    if actual != expected:
        raise CheckFailure(f"{message}: 期望 {expected!r}，实际 {actual!r}")


def check(check_id: str, title: str, fn) -> None:
    started = time.perf_counter()
    try:
        detail = fn()
        status = "PASS"
        error = ""
    except CheckFailure as exc:
        status = "FAIL"
        detail = ""
        error = str(exc)
    except Exception as exc:  # noqa: BLE001 - 验收脚本需继续跑完剩余项
        status = "FAIL"
        detail = ""
        error = f"{type(exc).__name__}: {exc}"
    elapsed = round((time.perf_counter() - started) * 1000, 1)
    CHECKS.append(
        {
            "id": check_id,
            "title": title,
            "status": status,
            "detail": detail,
            "error": error,
            "durationMs": elapsed,
        }
    )
    icon = "✅" if status == "PASS" else "❌"
    print(f"{icon} {check_id} {title}" + (f" · {detail}" if detail else "") + (f" · {error}" if error else ""))


def _cleanup(db) -> None:
    for model, column in (
        (PushEvent, PushEvent.user_id),
        (PushDelivery, PushDelivery.user_id),
        (TelegramDelivery, TelegramDelivery.chat_id),
        (Recommendation, Recommendation.user_id),
        (MyRepository, MyRepository.id),
        (TrendingRepository, TrendingRepository.id),
        (User, User.id),
    ):
        if model is User:
            db.execute(delete(model).where(column == USER_ID))
        else:
            db.execute(delete(model).where(column.like("m4-acceptance%")))
    db.commit()


def seed(db) -> None:
    _cleanup(db)
    db.add(User(id=USER_ID, username="m4-acceptance"))
    db.add(
        MyRepository(
            id=MY_ID,
            platform="github",
            name="my-project",
            description="Python FastAPI 支付服务",
            html_url="https://github.com/m4-acceptance/my",
            language="Python",
            stars=42,
        )
    )
    db.add(
        TrendingRepository(
            id=TREND_ID,
            platform="github",
            name="trend-project",
            description="一个面向 Python 的支付后端服务",
            html_url="https://github.com/m4-acceptance/trend",
            language="Python",
            stars=1200,
            stars_today=180,
            tech_stack="Python, FastAPI, Redis",
        )
    )
    db.add(
        Recommendation(
            id=REC_ID,
            user_id=USER_ID,
            repo_id=TREND_ID,
            score=0.86,
            match_score=0.86,
            quality_score=0.0,
            reason="与你收藏的 Python / FastAPI 项目高度相似，且今日热度上升。",
            status="new",
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        )
    )
    db.commit()


class FakeBark:
    def __init__(self) -> None:
        self.messages = []

    def send(self, message):
        self.messages.append(message)
        return BarkResult(ok=True, status_code=200)


class FakeTelegram:
    def __init__(self) -> None:
        self.parts = []

    def send_parts(self, parts, *, chat_id=None):
        self.parts.extend(parts)
        return TelegramSendResult(message_ids=[f"tg-{index}" for index in range(len(parts))], parts=len(parts))


class FakeEmailSender:
    def __init__(self) -> None:
        self.sent = []

    def send(self, content, recipients):
        self.sent.append((content, list(recipients)))
        return EmailSendResult(ok=True, message_id="<m4-acceptance@example.com>", attempts=1)


def main() -> int:
    parser = argparse.ArgumentParser(description="M4 验收走查")
    parser.add_argument("--strict", action="store_true", help="存在 FAIL / GAP 时以非零退出")
    parser.add_argument("--report-md", default=None)
    parser.add_argument("--report-json", default=None)
    args = parser.parse_args()

    init_db()
    db = SessionLocal()
    seed(db)

    client = TestClient(app)
    headers = {"X-Internal-Token": TOKEN}

    # ── M4-01 每日评估 ────────────────────────────────────────────
    def m4_01() -> str:
        result = jobs.evaluate_recommendations.run(
            user_id=USER_ID, match_threshold=0.1, quality_threshold=0.1
        )
        assert_true(result.get("status") in ("ok", "completed"), f"评估任务状态: {result.get('status')}")
        db.expire_all()
        row = db.get(Recommendation, REC_ID)
        assert_true(row is not None, "推荐应存在")
        assert_equal(row.status, "qualified", "推荐状态")
        assert_true(float(row.quality_score or 0) > 0, "质量分应写入")
        api = client.get("/api/recommend/qualified", params={"user_id": USER_ID}, headers=headers)
        assert_equal(api.status_code, 200, "合格推荐 API 状态")
        assert_true(any(item["id"] == REC_ID for item in api.json().get("items", [])), "合格推荐应包含目标记录")
        return f"quality={row.quality_score:.3f} · status=qualified"

    check("M4-01", "每日评估写入质量分并产出 qualified", m4_01)

    # ── M4-07 策略预演 / 事件账本 / daily_push ────────────────────
    def m4_07_policy() -> str:
        status_resp = client.get("/api/push/policy/status", headers=headers)
        assert_equal(status_resp.status_code, 200, "策略状态 API")
        body = status_resp.json()
        assert_true(body.get("enabled") is True, "策略开关应开启")
        allowed = client.post(
            "/api/push/policy/check",
            json={"userId": USER_ID, "repoId": "m4-acceptance/policy-other", "channel": "inapp"},
            headers=headers,
        )
        assert_equal(allowed.status_code, 200, "预演 API")
        assert_true(allowed.json().get("allowed") is True, "首条应允许")
        event = client.post(
            "/api/push/policy/events",
            json={
                "userId": USER_ID,
                "repoId": "m4-acceptance/policy-other",
                "channel": "inapp",
                "status": "sent",
            },
            headers=headers,
        )
        assert_equal(event.status_code, 201, "事件写入 API")
        duplicate = client.post(
            "/api/push/policy/check",
            json={"userId": USER_ID, "repoId": "m4-acceptance/policy-other", "channel": "inapp"},
            headers=headers,
        )
        assert_equal(duplicate.json().get("reason"), "duplicate_repo", "重复仓库应命中去重")
        return "policy=on · duplicate_repo 命中"

    check("M4-07A", "推送策略预演与事件账本", m4_07_policy)

    def m4_07_push() -> str:
        result = jobs.daily_push()
        assert_equal(result.get("status"), "ok", "daily_push 状态")
        assert_true(int(result.get("pushed", 0)) >= 1, "至少推送 1 条")
        db.expire_all()
        row = db.get(Recommendation, REC_ID)
        assert_equal(row.status, "pushed", "推荐状态")
        event = db.execute(
            select(PushEvent).where(PushEvent.user_id == USER_ID, PushEvent.repo_id == TREND_ID)
        ).scalars().first()
        assert_true(event is not None and event.status == "prepared", "应写入 prepared 事件")
        return f"pushed={result.get('pushed')} · event=prepared"

    check("M4-07B", "daily_push 通过策略并写事件账本", m4_07_push)

    # ── M4-03 Bark ───────────────────────────────────────────────
    def m4_03() -> str:
        fake = FakeBark()
        cfg = Settings(
            BARK_ENABLED=True,
            BARK_DEVICE_KEY="m4-acceptance-device-key",
            BARK_DRY_RUN=False,
            BARK_GROUP="OpenFactory",
        )
        result = dispatch_bark_notifications(db, user_id=USER_ID, settings=cfg, client=fake)
        assert_equal(result.get("status"), "ok", "Bark dispatch 状态")
        assert_equal(result.get("sent"), 1, "Bark 发送条数")
        assert_equal(len(fake.messages), 1, "假客户端收到条数")
        db.expire_all()
        row = db.get(Recommendation, REC_ID)
        assert_true(row.bark_sent_at is not None, "bark_sent_at 应写入")
        status_resp = client.get("/api/push/bark/status", headers=headers)
        assert_equal(status_resp.status_code, 200, "Bark 状态 API")
        assert_true("device" not in json.dumps(status_resp.json()).lower(), "状态接口不得回显 device key")
        return "sent=1 · bark_sent_at 已写入"

    check("M4-03", "Bark 通道投递与状态接口（假客户端）", m4_03)

    # ── M4-04 Telegram ───────────────────────────────────────────
    def m4_04() -> str:
        get_settings.cache_clear()
        os.environ["TELEGRAM_ENABLED"] = "true"
        os.environ["TELEGRAM_BOT_TOKEN"] = "123456:m4-acceptance-token"
        os.environ["TELEGRAM_CHAT_ID"] = "123456789"
        fake = FakeTelegram()
        result = send_telegram_digest(db, user_id=USER_ID, force=True, client=fake)
        assert_equal(result.get("status"), "sent", "Telegram 摘要状态")
        assert_true(int(result.get("itemCount", 0)) >= 1, "摘要条数")
        assert_true(len(fake.parts) >= 1, "应生成至少一个消息分片")
        status_resp = client.get("/api/notifications/telegram/status", headers=headers)
        assert_equal(status_resp.status_code, 200, "Telegram 状态 API")
        assert_true("m4-acceptance-token" not in status_resp.text, "状态接口不得回显 token")
        return f"sent=1 · items={result.get('itemCount')} · parts={len(fake.parts)}"

    check("M4-04", "Telegram 每日摘要（假客户端）", m4_04)

    # ── M4-05 Email ──────────────────────────────────────────────
    def m4_05() -> str:
        get_settings.cache_clear()
        os.environ["EMAIL_ENABLED"] = "true"
        os.environ["EMAIL_SMTP_HOST"] = "smtp.example.com"
        os.environ["EMAIL_SMTP_PORT"] = "587"
        os.environ["EMAIL_FROM"] = "noreply@example.com"
        os.environ["EMAIL_TO"] = "acceptance@example.com"
        os.environ["EMAIL_SMTP_USERNAME"] = "smtp-user"
        os.environ["EMAIL_SMTP_PASSWORD"] = "m4-acceptance-password"
        fake = FakeEmailSender()
        result = send_email_digest(db, user_id=USER_ID, force=True, sender=fake)
        assert_equal(result.get("status"), "sent", "Email 摘要状态")
        assert_true(int(result.get("itemCount", 0)) >= 1, "摘要条数")
        assert_equal(len(fake.sent), 1, "假 sender 收到邮件数")
        status_resp = client.get("/api/notifications/email/status", headers=headers)
        assert_equal(status_resp.status_code, 200, "Email 状态 API")
        assert_true("m4-acceptance-password" not in status_resp.text, "状态接口不得回显 SMTP 密码")
        return f"sent=1 · items={result.get('itemCount')} · recipient=masked"

    check("M4-05", "Email 每日摘要（假 sender）", m4_05)

    # ── M4-06 推送偏好 ───────────────────────────────────────────
    def m4_06() -> str:
        import httpx

        payload = {
            "items": [
                {
                    "userId": USER_ID,
                    "preferences": {
                        "enabled": True,
                        "timeOfDay": "09:00",
                        "timezone": "Asia/Shanghai",
                        "minScore": 0.35,
                        "minQualityScore": 0.55,
                        "channels": {"inapp": True, "bark": False, "telegram": False, "email": False},
                    },
                }
            ]
        }
        transport = httpx.MockTransport(lambda request: httpx.Response(200, json=payload))
        client_pref = PushPreferenceClient("http://edge.test", "token", transport=transport)
        prefs_map = client_pref.fetch_all()
        prefs = prefs_map.get(USER_ID)
        assert_true(prefs is not None, "应解析出用户偏好")
        assert_equal(prefs.time_of_day, "09:00", "推送时间")
        # 2026-10-22 01:00 UTC = 09:00 Asia/Shanghai，落在 10 分钟窗口
        assert_true(
            is_due(prefs, now=datetime(2026, 10, 22, 1, 0, tzinfo=timezone.utc), window_minutes=10),
            "09:00 应到期",
        )
        assert_true(
            not is_due(prefs, now=datetime(2026, 10, 22, 2, 0, tzinfo=timezone.utc), window_minutes=10),
            "10:00 不应到期",
        )
        low = Recommendation(
            id="m4-acceptance-low",
            user_id=USER_ID,
            repo_id="m4-acceptance/low",
            score=0.2,
            match_score=0.2,
            quality_score=0.9,
            reason="低匹配",
            status="new",
        )
        high = Recommendation(
            id="m4-acceptance-high",
            user_id=USER_ID,
            repo_id="m4-acceptance/high",
            score=0.8,
            match_score=0.8,
            quality_score=0.9,
            reason="高匹配",
            status="new",
        )
        filtered = filter_recommendations([low, high], prefs)
        assert_equal([row.id for row in filtered], ["m4-acceptance-high"], "阈值筛选")
        return "09:00 到期 · 阈值 0.35 生效"

    check("M4-06", "推送偏好解析、时间窗口与阈值筛选", m4_06)

    # ── M4-08 推送记录与回执 ─────────────────────────────────────
    def m4_08() -> str:
        records = client.get("/api/push/records", params={"pageSize": 50}, headers=headers)
        assert_equal(records.status_code, 200, "记录列表 API")
        body = records.json()
        assert_true(body["total"] >= 3, "应至少有 Bark / Telegram / Email 三条记录")
        channels = {item["channel"] for item in body["items"]}
        assert_true({"bark", "telegram", "email"}.issubset(channels), "三通道记录齐全")
        email_item = next(item for item in body["items"] if item["channel"] == "email")
        assert_true("@" in email_item["targetMasked"] and "***" in email_item["targetMasked"], "邮箱应脱敏")
        bark_item = next(item for item in body["items"] if item["channel"] == "bark")
        assert_equal(bark_item["targetMasked"], "OpenFactory", "Bark group 原样返回")

        stats = client.get("/api/push/records/stats", params={"days": 30}, headers=headers)
        assert_equal(stats.status_code, 200, "统计 API")
        stats_body = stats.json()
        assert_true(stats_body["total"] >= 3, "统计总数")
        assert_true(stats_body["byChannel"].get("bark", 0) >= 1, "Bark 统计")

        delivery_id = email_item["id"]
        detail = client.get(f"/api/push/records/{delivery_id}", headers=headers)
        assert_equal(detail.status_code, 200, "详情 API")
        assert_true(detail.json()["receipts"] == [], "初始回执为空")

        receipt = client.post(
            "/api/push/receipts",
            json={
                "deliveryId": delivery_id,
                "status": "delivered",
                "source": "manual",
                "detail": "验收人工确认",
            },
            headers=headers,
        )
        assert_equal(receipt.status_code, 200, "回执 API")
        assert_equal(receipt.json()["delivery"]["status"], "delivered", "回执后状态")

        late = client.post(
            "/api/push/receipts",
            json={
                "deliveryId": delivery_id,
                "status": "accepted",
                "source": "provider",
                "externalId": "late-accepted",
            },
            headers=headers,
        )
        assert_equal(late.status_code, 200, "迟到回执 API")
        assert_equal(late.json()["delivery"]["status"], "delivered", "已送达不可被迟到回执降级")
        return f"records={body['total']} · receipt=delivered · late=no-downgrade"

    check("M4-08", "推送记录列表 / 统计 / 详情 / 回执与脱敏", m4_08)

    # ── M4-02 数据源（edge 通知中心消费 pushed）──────────────────
    def m4_02_source() -> str:
        db.expire_all()
        row = db.get(Recommendation, REC_ID)
        assert_equal(row.status, "pushed", "通知中心数据源应为 pushed")
        return "pushed 推荐已就绪（edge 侧由 m4-acceptance.mjs 走查）"

    check("M4-02S", "站内通知中心数据源（pushed 推荐）", m4_02_source)

    # ── 性能抽样 ─────────────────────────────────────────────────
    samples: list[float] = []
    for _ in range(PERF_SAMPLES):
        started = time.perf_counter()
        response = client.get("/api/push/records", params={"pageSize": 20}, headers=headers)
        samples.append((time.perf_counter() - started) * 1000)
        assert_equal(response.status_code, 200, "性能采样状态码")
    samples.sort()
    p50 = round(statistics.median(samples), 1)
    p95 = round(samples[max(0, int(len(samples) * 0.95) - 1)], 1)
    max_ms = round(max(samples), 1)
    perf_ok = p95 < PERF_BUDGET_MS
    CHECKS.append(
        {
            "id": "M4-P01",
            "title": f"推送记录列表性能 P95 < {PERF_BUDGET_MS:.0f}ms",
            "status": "PASS" if perf_ok else "FAIL",
            "detail": f"P50={p50}ms · P95={p95}ms · Max={max_ms}ms · n={PERF_SAMPLES}",
            "error": "" if perf_ok else f"P95 {p95}ms 超出预算",
            "durationMs": 0,
        }
    )
    print(f"{'✅' if perf_ok else '❌'} M4-P01 推送记录列表性能 · P50={p50}ms P95={p95}ms Max={max_ms}ms")

    db.close()

    # ── 汇总 ─────────────────────────────────────────────────────
    total = len(CHECKS)
    passed = sum(1 for item in CHECKS if item["status"] == "PASS")
    failed = sum(1 for item in CHECKS if item["status"] == "FAIL")
    gaps = sum(1 for item in CHECKS if item["status"] == "GAP")
    skipped = sum(1 for item in CHECKS if item["status"] == "SKIP")
    branch = _git(["rev-parse", "--abbrev-ref", "HEAD"]) or "unknown"
    commit = _git(["rev-parse", "--short", "HEAD"]) or "unknown"
    generated_at = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")

    report = {
        "requirement": "REQ-202610-0938",
        "milestone": "M4-09",
        "title": "M4 验收与回顾",
        "generatedAt": generated_at,
        "branch": branch,
        "commit": commit,
        "environment": {
            "database": "SQLite (temp)",
            "runtime": f"Python {sys.version.split()[0]}",
            "network": "none（通道客户端全部注入假实现）",
        },
        "summary": {
            "total": total,
            "passed": passed,
            "failed": failed,
            "gaps": gaps,
            "skipped": skipped,
        },
        "performance": {
            "samples": PERF_SAMPLES,
            "p50Ms": p50,
            "p95Ms": p95,
            "maxMs": max_ms,
            "budgetMs": PERF_BUDGET_MS,
        },
        "checks": CHECKS,
    }

    if args.report_json:
        Path(args.report_json).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.report_md:
        Path(args.report_md).write_text(_render_markdown(report), encoding="utf-8")

    print(f"\nM4 验收完成：{passed}/{total} PASS · {failed} FAIL · {gaps} GAP · {skipped} SKIP")
    if args.strict and (failed or gaps):
        return 1
    return 0


def _git(args: list[str]) -> str:
    try:
        output = subprocess.run(
            ["git", *args], cwd=ROOT.parent, check=True, capture_output=True, text=True
        )
        return output.stdout.strip()
    except Exception:  # noqa: BLE001 - 报告缺少 git 信息不影响验收
        return ""


def _render_markdown(report: dict) -> str:
    lines = [
        "# M4 验收原始报告",
        "",
        f"> 需求：{report['requirement']}（{report['milestone']}）｜生成时间：{report['generatedAt']}",
        f"> 分支：`{report['branch']}` @ `{report['commit']}`",
        "",
        "## 汇总",
        "",
        f"- 断言：{report['summary']['total']} 项 · PASS {report['summary']['passed']} · "
        f"FAIL {report['summary']['failed']} · GAP {report['summary']['gaps']} · SKIP {report['summary']['skipped']}",
        f"- 性能：P50 {report['performance']['p50Ms']}ms · P95 {report['performance']['p95Ms']}ms · "
        f"Max {report['performance']['maxMs']}ms（预算 < {report['performance']['budgetMs']:.0f}ms）",
        "",
        "## 断言明细",
        "",
        "| 编号 | 验收点 | 状态 | 证据 / 说明 |",
        "| --- | --- | --- | --- |",
    ]
    for item in report["checks"]:
        evidence = item["detail"] or item["error"] or ""
        lines.append(f"| {item['id']} | {item['title']} | {item['status']} | {evidence} |")
    lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    raise SystemExit(main())
