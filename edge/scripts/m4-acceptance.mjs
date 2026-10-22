#!/usr/bin/env node
/**
 * M4 验收 · 站内通知中心与推送偏好端到端走查（零第三方依赖）
 *
 * 在独立的本地 D1（wrangler dev）里种入固定推荐 / 通知数据集，用真实 HTTP 走查：
 *   M4-02 站内通知中心：pushed 推荐惰性物化 / 幂等 / 未读计数 / 筛选 / 分页 /
 *         单条已读 / 全部已读 / 忽略联动推荐状态 / 内部推送去重 / 用户隔离
 *   M4-06 推送偏好：默认值 / 保存回读 / 参数校验 / 内部批量与单用户读取 / 令牌校验
 *
 * M4-01/03/04/05/07/08 属于 VPS / 推送链路，由 `vps/scripts/m4_acceptance.py` 覆盖；
 * 本脚本负责 edge / D1 侧对外契约，验收矩阵见 docs/planning/acceptance-m4.md。
 *
 * 用法（在 edge/ 下）：
 *   npm run test:m4
 *   node scripts/m4-acceptance.mjs --strict
 *   node scripts/m4-acceptance.mjs --report-md docs/planning/acceptance-m4-report.md --report-json docs/planning/acceptance-m4-report.json
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const EDGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(EDGE_ROOT, '..');
const WRANGLER_BIN = join(EDGE_ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const DB_NAME = 'opensource-factory';
const ALLOWED_ORIGIN = 'http://localhost:5173';
const SESSION_TOKEN = 'e2e-m4-session-token';
const SESSION_TOKEN_OTHER = 'e2e-m4-session-token-other';
const INTERNAL_TOKEN = 'e2e-m4-internal-token';
const USER_ID = '3001';
const OTHER_USER_ID = '3002';
const PERF_SAMPLES = 100;
const PERF_BUDGET_MS = 300;

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((arg) => arg.startsWith('--')));
const STRICT = flags.has('--strict');
const KEEP = flags.has('--keep');
const REPORT_MD = readOption('--report-md');
const REPORT_JSON = readOption('--report-json');

function readOption(name) {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  return argv[index + 1] ?? null;
}

const delay = (ms) => new Promise((done) => setTimeout(done, ms));

function getFreePort() {
  return new Promise((done, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => done(port));
    });
  });
}

async function http(url, options = {}) {
  const headers = {};
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.token) headers['X-Internal-Token'] = options.token;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const started = performance.now();
  const res = await fetch(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, text, json, durationMs: performance.now() - started };
}

function runWrangler(argsList, env) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [WRANGLER_BIN, ...argsList], {
      cwd: EDGE_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) done(output);
      else reject(new Error(`wrangler ${argsList.join(' ')} 失败（exit ${code}）：\n${output}`));
    });
  });
}

async function waitForHealth(workerUrl, child, getOutput, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`wrangler dev 提前退出（exit ${child.exitCode}）：\n${getOutput()}`);
    }
    try {
      const res = await fetch(`${workerUrl}/healthz`);
      if (res.ok) return;
    } catch {
      // 尚未就绪
    }
    await delay(500);
  }
  throw new Error(`等待 wrangler dev 就绪超时：\n${getOutput()}`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
    else child.kill('SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  await Promise.race([once(child, 'exit'), delay(5_000)]);
  if (child.exitCode === null) {
    try {
      if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch {
      // 已退出
    }
  }
}

function sqlQuote(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

/**
 * 推荐数据集：
 * - p1 / p2：用户 3001 的 pushed 推荐，应物化为通知；
 * - global：全局 pushed 推荐，所有用户可见；
 * - fresh：status=new，不应物化；
 * - other：用户 3002 的 pushed 推荐，3001 不可见。
 */
const RECOMMENDATIONS = [
  {
    id: 'rec-m4-p1',
    userId: USER_ID,
    owner: 'trend',
    name: 'alpha',
    description: 'Alpha 项目：支付网关示例',
    language: 'Python',
    stars: 52_000,
    score: 0.82,
    reason: '与你收藏的 Python 项目相似度 0.82',
    basedOn: '["lang:python","tag:web"]',
    url: 'https://github.com/trend/alpha',
    status: 'pushed',
    repoId: 'trend/alpha',
    createdAt: '2026-10-20T09:00:00.000Z',
  },
  {
    id: 'rec-m4-p2',
    userId: USER_ID,
    owner: 'trend',
    name: 'beta',
    description: 'Beta 前端工具集',
    language: 'TypeScript',
    stars: 41_000,
    score: 0.76,
    reason: '与你收藏的前端项目相似度 0.76',
    basedOn: '["lang:typescript"]',
    url: 'https://github.com/trend/beta',
    status: 'pushed',
    repoId: 'trend/beta',
    createdAt: '2026-10-21T09:00:00.000Z',
  },
  {
    id: 'rec-m4-global',
    userId: null,
    owner: 'trend',
    name: 'gamma',
    description: 'Gamma 数据管道',
    language: 'Go',
    stars: 33_000,
    score: 0.9,
    reason: '全站热门推荐',
    basedOn: '[]',
    url: 'https://github.com/trend/gamma',
    status: 'pushed',
    repoId: 'trend/gamma',
    createdAt: '2026-10-22T09:00:00.000Z',
  },
  {
    id: 'rec-m4-fresh',
    userId: USER_ID,
    owner: 'trend',
    name: 'delta',
    description: 'Delta 高性能运行时',
    language: 'Rust',
    stars: 28_000,
    score: 0.7,
    reason: '尚未推送',
    basedOn: '[]',
    url: 'https://github.com/trend/delta',
    status: 'new',
    repoId: 'trend/delta',
    createdAt: '2026-10-22T10:00:00.000Z',
  },
  {
    id: 'rec-m4-other',
    userId: OTHER_USER_ID,
    owner: 'trend',
    name: 'epsilon',
    description: 'Epsilon 数据工具',
    language: 'Python',
    stars: 21_000,
    score: 0.65,
    reason: '其他用户的推荐',
    basedOn: '[]',
    url: 'https://github.com/trend/epsilon',
    status: 'pushed',
    repoId: 'trend/epsilon',
    createdAt: '2026-10-22T11:00:00.000Z',
  },
];

function buildSeedSql() {
  const lines = [
    'PRAGMA foreign_keys = OFF;',
    `INSERT INTO users (id, login, name, email) VALUES (${sqlQuote(USER_ID)}, 'm4-tester', 'M4 Tester', 'm4@example.com');`,
    `INSERT INTO users (id, login, name, email) VALUES (${sqlQuote(OTHER_USER_ID)}, 'm4-other', 'M4 Other', 'm4-other@example.com');`,
  ];

  for (const row of RECOMMENDATIONS) {
    lines.push(
      `INSERT INTO recommendations (id, user_id, owner, name, description, language, stars, score, reason, based_on, url, status, created_at, repo_id, updated_at) VALUES (${[
        sqlQuote(row.id),
        sqlQuote(row.userId),
        sqlQuote(row.owner),
        sqlQuote(row.name),
        sqlQuote(row.description),
        sqlQuote(row.language),
        row.stars,
        row.score,
        sqlQuote(row.reason),
        sqlQuote(row.basedOn),
        sqlQuote(row.url),
        sqlQuote(row.status),
        sqlQuote(row.createdAt),
        sqlQuote(row.repoId),
        sqlQuote(row.createdAt),
      ].join(', ')});`
    );
  }

  return `${lines.join('\n')}\n`;
}

const results = [];
const perf = [];

async function check(id, title, fn) {
  const started = performance.now();
  try {
    const outcome = await fn();
    const status = outcome?.status ?? 'PASS';
    const detail = outcome?.detail ?? '';
    results.push({ id, title, status, detail, durationMs: performance.now() - started });
    const icon = status === 'PASS' ? '✔' : status === 'GAP' ? '○' : status === 'SKIP' ? '–' : '✖';
    console.log(`  ${icon} [${status}] ${title}${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ id, title, status: 'FAIL', detail, durationMs: performance.now() - started });
    console.log(`  ✖ [FAIL] ${title} — ${detail}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}：期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

async function sample(workerUrl, path, cookie, samples = PERF_SAMPLES) {
  const durations = [];
  for (let i = 0; i < samples; i += 1) {
    const res = await http(`${workerUrl}${path}`, { cookie });
    assertEqual(res.status, 200, `性能采样 ${path} 应 200`);
    durations.push(res.durationMs);
  }
  durations.sort((a, b) => a - b);
  return {
    path,
    samples,
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    max: durations[durations.length - 1],
  };
}

function formatMs(value) {
  return `${value.toFixed(1)}ms`;
}

function summarize() {
  const summary = { PASS: 0, GAP: 0, FAIL: 0, SKIP: 0 };
  for (const item of results) summary[item.status] = (summary[item.status] ?? 0) + 1;
  return summary;
}

function buildMarkdown(meta) {
  const summary = summarize();
  const rows = results
    .map(
      (item) =>
        `| ${item.id} | ${item.title} | ${item.status} | ${item.detail.replaceAll('|', '\\|') || '—'} | ${formatMs(item.durationMs)} |`
    )
    .join('\n');
  const perfRows = perf
    .map(
      (item) =>
        `| \`${item.path}\` | ${item.samples} | ${formatMs(item.p50)} | ${formatMs(item.p95)} | ${formatMs(item.max)} | ${item.p95 < PERF_BUDGET_MS ? 'PASS' : 'FAIL'} |`
    )
    .join('\n');
  const gaps = results.filter((item) => item.status === 'GAP');
  return `# M4 验收报告 · edge 侧（自动生成）

- 生成时间：${meta.finishedAt}
- 分支 / 提交：${meta.branch} / ${meta.commit}
- 运行环境：${meta.platform} · Node ${meta.nodeVersion}
- 数据规模：5 条推荐（3 条 pushed、1 条 new、1 条他人）/ 2 个测试用户
- 判定口径：PASS 通过 · GAP 能力未集成（阻塞） · FAIL 行为错误 · SKIP 跳过

## 检查结果

| # | 检查 | 结果 | 说明 | 耗时 |
| --- | --- | --- | --- | --- |
${rows}

## 性能抽样（预算 P95 < ${PERF_BUDGET_MS}ms）

| 场景 | 样本数 | P50 | P95 | Max | 结果 |
| --- | --- | --- | --- | --- | --- |
${perfRows}

## 汇总

- PASS：${summary.PASS}
- GAP：${summary.GAP}
- FAIL：${summary.FAIL}
- SKIP：${summary.SKIP}
- 结论：${summary.FAIL > 0 ? '存在失败项，验收不通过' : summary.GAP > 0 ? '已交付能力通过；存在未集成能力，整体验收待合并后复跑' : '全部通过'}

${gaps.length > 0 ? `## 未集成能力（GAP）\n\n${gaps.map((item) => `- ${item.id} ${item.title}：${item.detail || '能力未合入当前分支'}`).join('\n')}\n` : ''}`;
}

async function gitInfo() {
  const runGit = (args) =>
    new Promise((done) => {
      const child = spawn('git', args, { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'] });
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk.toString();
      });
      child.on('exit', () => done(output.trim()));
    });
  return {
    branch: (await runGit(['rev-parse', '--abbrev-ref', 'HEAD'])) || 'unknown',
    commit: (await runGit(['rev-parse', '--short', 'HEAD'])) || 'unknown',
  };
}

async function main() {
  if (!existsSync(WRANGLER_BIN)) {
    throw new Error('未找到 wrangler，请先在 edge/ 下执行 npm ci');
  }

  const persistDir = join(EDGE_ROOT, '.wrangler', `e2e-m4-${process.pid}`);
  rmSync(persistDir, { recursive: true, force: true });
  const tempDir = mkdtempSync(join(tmpdir(), 'm4-acceptance-'));

  const env = {
    ...process.env,
    CI: '1',
    WRANGLER_SEND_METRICS: 'false',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  };

  console.log('• 应用本地 D1 迁移（0001~0011）…');
  await runWrangler(
    ['d1', 'migrations', 'apply', DB_NAME, '--local', '--persist-to', persistDir],
    env
  );

  console.log('• 种入 M4 验收数据集…');
  const seedFile = join(tempDir, 'seed.sql');
  writeFileSync(seedFile, buildSeedSql(), 'utf8');
  await runWrangler(
    ['d1', 'execute', DB_NAME, '--local', '--persist-to', persistDir, '--file', seedFile],
    env
  );

  const sessionId = createHash('sha256').update(SESSION_TOKEN).digest('hex');
  const otherSessionId = createHash('sha256').update(SESSION_TOKEN_OTHER).digest('hex');
  await runWrangler(
    [
      'd1',
      'execute',
      DB_NAME,
      '--local',
      '--persist-to',
      persistDir,
      '--command',
      `INSERT INTO sessions (id, user_id, expires_at) VALUES ('${sessionId}', '${USER_ID}', '2099-01-01T00:00:00.000Z'), ('${otherSessionId}', '${OTHER_USER_ID}', '2099-01-01T00:00:00.000Z');`,
    ],
    env
  );

  const workerPort = await getFreePort();
  const inspectorPort = await getFreePort();
  const workerUrl = `http://127.0.0.1:${workerPort}`;

  let wranglerOutput = '';
  const wrangler = spawn(
    process.execPath,
    [
      WRANGLER_BIN,
      'dev',
      '--ip',
      '127.0.0.1',
      '--port',
      String(workerPort),
      '--inspector-port',
      String(inspectorPort),
      '--persist-to',
      persistDir,
      '--var',
      `ALLOWED_ORIGIN:${ALLOWED_ORIGIN}`,
      '--var',
      `INTERNAL_TOKEN:${INTERNAL_TOKEN}`,
    ],
    {
      cwd: EDGE_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    }
  );
  wrangler.stdout.on('data', (chunk) => {
    wranglerOutput += chunk.toString();
  });
  wrangler.stderr.on('data', (chunk) => {
    wranglerOutput += chunk.toString();
  });

  const cookie = `of_session=${SESSION_TOKEN}`;
  const otherCookie = `of_session=${SESSION_TOKEN_OTHER}`;
  const auth = { cookie };
  const internal = { token: INTERNAL_TOKEN };

  try {
    console.log('• 启动 wrangler dev（本地 D1）…');
    await waitForHealth(workerUrl, wrangler, () => wranglerOutput);

    // ── A 站内通知中心（M4-02）──────────────────────────────────
    await check('M4-02-01', '通知接口未登录返回 401', async () => {
      const list = await http(`${workerUrl}/api/notifications`);
      assertEqual(list.status, 401, '列表状态码');
      const unread = await http(`${workerUrl}/api/notifications/unread-count`);
      assertEqual(unread.status, 401, '未读计数状态码');
      return { detail: '401 unauthorized' };
    });

    await check('M4-02-02', 'pushed 推荐惰性物化为通知（本人 2 + 全局 1）', async () => {
      const res = await http(`${workerUrl}/api/notifications`, auth);
      assertEqual(res.status, 200, '状态码');
      assertEqual(res.json?.total, 3, '通知总数');
      assertEqual(res.json?.unread, 3, '未读数');
      const items = res.json?.items ?? [];
      assertEqual(items.length, 3, '列表条数');
      assertEqual(items[0]?.repoId, 'trend/gamma', '最新一条（全局推荐）');
      assertEqual(items[0]?.title, 'trend/gamma', '标题 owner/name');
      assertEqual(items[0]?.type, 'recommendation', '类型');
      assertEqual(items[0]?.score, 0.9, '分数');
      assertEqual(items[0]?.language, 'Go', '语言');
      assertEqual(items[0]?.stars, 33_000, 'Star 数');
      assertEqual(items[1]?.repoId, 'trend/beta', '第二条');
      assertEqual(items[2]?.repoId, 'trend/alpha', '第三条');
      assert(
        items.every((item) => item.status === 'unread'),
        '新物化通知应全部未读'
      );
      return { detail: '3 条 · 未读 3' };
    });

    await check('M4-02-03', '重复读取不重复物化（幂等）', async () => {
      const res = await http(`${workerUrl}/api/notifications`, auth);
      assertEqual(res.status, 200, '状态码');
      assertEqual(res.json?.total, 3, '重复读取后总数');
      const fresh = await http(`${workerUrl}/api/notifications?status=all`, auth);
      assertEqual(fresh.json?.total, 3, 'all 筛选总数');
      return { detail: 'total 保持 3' };
    });

    await check('M4-02-04', '未读计数接口与列表一致', async () => {
      const res = await http(`${workerUrl}/api/notifications/unread-count`, auth);
      assertEqual(res.status, 200, '状态码');
      assertEqual(res.json?.unread, 3, '未读数');
      return { detail: 'unread=3' };
    });

    await check('M4-02-05', '状态筛选与分页（limit / offset / hasMore）', async () => {
      const unread = await http(`${workerUrl}/api/notifications?status=unread`, auth);
      assertEqual(unread.json?.total, 3, '未读筛选总数');
      const page1 = await http(`${workerUrl}/api/notifications?limit=2`, auth);
      assertEqual(page1.json?.items?.length, 2, '第一页条数');
      assertEqual(page1.json?.hasMore, true, '第一页 hasMore');
      const page2 = await http(`${workerUrl}/api/notifications?limit=2&offset=2`, auth);
      assertEqual(page2.json?.items?.length, 1, '第二页条数');
      assertEqual(page2.json?.hasMore, false, '第二页 hasMore');
      const read = await http(`${workerUrl}/api/notifications?status=read`, auth);
      assertEqual(read.json?.total, 0, '已读筛选总数');
      return { detail: 'unread 3 · 2+1 分页' };
    });

    let globalNotificationId = null;
    let betaNotificationId = null;

    await check('M4-02-06', '单条已读：状态与 readAt 生效', async () => {
      const list = await http(`${workerUrl}/api/notifications`, auth);
      globalNotificationId = list.json?.items?.[0]?.id ?? null;
      betaNotificationId = list.json?.items?.[1]?.id ?? null;
      assert(globalNotificationId && betaNotificationId, '应能取到通知 id');
      const res = await http(`${workerUrl}/api/notifications/${globalNotificationId}/read`, {
        ...auth,
        method: 'POST',
      });
      assertEqual(res.status, 200, '状态码');
      assertEqual(res.json?.status, 'read', '状态');
      assert(res.json?.readAt, 'readAt 应写入');
      const unread = await http(`${workerUrl}/api/notifications/unread-count`, auth);
      assertEqual(unread.json?.unread, 2, '已读后未读数');
      const readList = await http(`${workerUrl}/api/notifications?status=read`, auth);
      assertEqual(readList.json?.total, 1, '已读筛选总数');
      return { detail: 'read · unread 3 → 2' };
    });

    await check('M4-02-07', '忽略通知：从列表移除并联动推荐 dismissed', async () => {
      const res = await http(`${workerUrl}/api/notifications/${betaNotificationId}/dismiss`, {
        ...auth,
        method: 'POST',
      });
      assertEqual(res.status, 200, '状态码');
      assertEqual(res.json?.status, 'dismissed', '状态');
      const list = await http(`${workerUrl}/api/notifications`, auth);
      assertEqual(list.json?.total, 2, '忽略后列表总数');
      const dismissed = await http(
        `${workerUrl}/api/recommendations?status=dismissed`,
        auth
      );
      assert(
        (dismissed.json ?? []).some((item) => item.id === 'rec-m4-p2'),
        '推荐状态应联动为 dismissed'
      );
      const again = await http(`${workerUrl}/api/notifications/${betaNotificationId}/read`, {
        ...auth,
        method: 'POST',
      });
      assertEqual(again.status, 404, '已忽略通知不可再标已读');
      const missing = await http(`${workerUrl}/api/notifications/not-exist/read`, {
        ...auth,
        method: 'POST',
      });
      assertEqual(missing.status, 404, '不存在通知返回 404');
      return { detail: 'dismissed · 推荐联动 · 404 边界' };
    });

    await check('M4-02-08', '全部已读清空未读计数', async () => {
      const res = await http(`${workerUrl}/api/notifications/read-all`, {
        ...auth,
        method: 'POST',
      });
      assertEqual(res.status, 200, '状态码');
      assertEqual(res.json?.updated, 1, '更新条数');
      assertEqual(res.json?.unread, 0, '返回未读数');
      const unread = await http(`${workerUrl}/api/notifications/unread-count`, auth);
      assertEqual(unread.json?.unread, 0, '未读计数');
      return { detail: 'updated=1 · unread=0' };
    });

    await check('M4-02-09', '内部推送接口：令牌校验 + dedupeKey 幂等', async () => {
      const unauthorized = await http(`${workerUrl}/api/internal/notifications`, {
        method: 'POST',
        body: { notifications: [{ userId: USER_ID, title: '未授权' }] },
      });
      assertEqual(unauthorized.status, 401, '无令牌状态码');
      const payload = {
        notifications: [
          {
            userId: USER_ID,
            type: 'system',
            title: 'M4 验收维护通知',
            body: '这是一条系统通知',
            dedupeKey: 'system:m4-acceptance',
          },
        ],
      };
      const first = await http(`${workerUrl}/api/internal/notifications`, {
        ...internal,
        method: 'POST',
        body: payload,
      });
      assertEqual(first.status, 200, '首次状态码');
      assertEqual(first.json?.created, 1, '首次 created');
      const second = await http(`${workerUrl}/api/internal/notifications`, {
        ...internal,
        method: 'POST',
        body: payload,
      });
      assertEqual(second.status, 200, '重复状态码');
      assertEqual(second.json?.created, 0, '重复 created');
      assertEqual(second.json?.skipped, 1, '重复 skipped');
      const list = await http(`${workerUrl}/api/notifications`, auth);
      assertEqual(list.json?.total, 3, '系统通知已计入列表');
      return { detail: 'created 1 → 0 · skipped 1' };
    });

    await check('M4-02-10', '内部同步推荐：按用户物化且用户隔离', async () => {
      const unauthorized = await http(`${workerUrl}/api/internal/notifications/sync-recommendations`, {
        method: 'POST',
        body: { userId: OTHER_USER_ID },
      });
      assertEqual(unauthorized.status, 401, '无令牌状态码');
      const res = await http(`${workerUrl}/api/internal/notifications/sync-recommendations`, {
        ...internal,
        method: 'POST',
        body: { userId: OTHER_USER_ID },
      });
      assertEqual(res.status, 200, '状态码');
      assertEqual(res.json?.created, 2, '其他用户应物化 2 条（本人 + 全局）');
      const otherList = await http(`${workerUrl}/api/notifications`, { cookie: otherCookie });
      assertEqual(otherList.json?.total, 2, '其他用户列表总数');
      assert(
        (otherList.json?.items ?? []).every((item) => item.repoId !== 'trend/alpha'),
        '不应看到用户 3001 的通知'
      );
      return { detail: 'created=2 · 用户隔离' };
    });

    // ── B 推送偏好（M4-06）──────────────────────────────────────
    await check('M4-06-01', '未保存时返回默认偏好', async () => {
      const res = await http(`${workerUrl}/api/push-preferences`, auth);
      assertEqual(res.status, 200, '状态码');
      assertEqual(res.json?.isDefault, true, 'isDefault');
      const prefs = res.json?.preferences ?? {};
      assertEqual(prefs.enabled, true, 'enabled');
      assertEqual(prefs.timeOfDay, '09:00', 'timeOfDay');
      assertEqual(prefs.timezone, 'Asia/Shanghai', 'timezone');
      assertEqual(prefs.minScore, 0.35, 'minScore');
      assertEqual(prefs.minQualityScore, 0.55, 'minQualityScore');
      assertEqual(prefs.channels?.inapp, true, 'channels.inapp');
      assertEqual(prefs.channels?.bark, false, 'channels.bark');
      assertEqual(prefs.channels?.telegram, false, 'channels.telegram');
      assertEqual(prefs.channels?.email, false, 'channels.email');
      assertEqual(res.json?.availableChannels?.length, 4, '可用通道数');
      return { detail: '09:00 · 0.35 / 0.55 · 仅站内' };
    });

    await check('M4-06-02', '保存偏好后回读一致', async () => {
      const payload = {
        preferences: {
          enabled: true,
          timeOfDay: '07:30',
          timezone: 'Asia/Tokyo',
          minScore: 0.5,
          minQualityScore: 0.6,
          channels: { inapp: true, bark: true, telegram: false, email: true },
        },
      };
      const saved = await http(`${workerUrl}/api/push-preferences`, {
        ...auth,
        method: 'PUT',
        body: payload,
      });
      assertEqual(saved.status, 200, '保存状态码');
      assertEqual(saved.json?.isDefault, false, '保存后 isDefault');
      assert(saved.json?.preferences?.updatedAt, 'updatedAt 应写入');
      const read = await http(`${workerUrl}/api/push-preferences`, auth);
      assertEqual(read.status, 200, '回读状态码');
      assertEqual(read.json?.isDefault, false, '回读 isDefault');
      const prefs = read.json?.preferences ?? {};
      assertEqual(prefs.timeOfDay, '07:30', 'timeOfDay');
      assertEqual(prefs.timezone, 'Asia/Tokyo', 'timezone');
      assertEqual(prefs.minScore, 0.5, 'minScore');
      assertEqual(prefs.minQualityScore, 0.6, 'minQualityScore');
      assertEqual(prefs.channels?.bark, true, 'channels.bark');
      assertEqual(prefs.channels?.email, true, 'channels.email');
      return { detail: '07:30 Asia/Tokyo · bark/email 开启' };
    });

    await check('M4-06-03', '非法参数返回 400 与中文提示', async () => {
      const badTime = await http(`${workerUrl}/api/push-preferences`, {
        ...auth,
        method: 'PUT',
        body: { preferences: { timeOfDay: '25:00' } },
      });
      assertEqual(badTime.status, 400, '非法时间状态码');
      assertEqual(badTime.json?.error, 'invalid_preferences', '错误码');
      const badScore = await http(`${workerUrl}/api/push-preferences`, {
        ...auth,
        method: 'PUT',
        body: { preferences: { minScore: 1.5 } },
      });
      assertEqual(badScore.status, 400, '非法阈值状态码');
      const badChannel = await http(`${workerUrl}/api/push-preferences`, {
        ...auth,
        method: 'PUT',
        body: { preferences: { channels: { bark: 'yes' } } },
      });
      assertEqual(badChannel.status, 400, '非法通道状态码');
      const badBody = await http(`${workerUrl}/api/push-preferences`, {
        ...auth,
        method: 'PUT',
        body: [],
      });
      assertEqual(badBody.status, 400, '非法请求体状态码');
      const stillSaved = await http(`${workerUrl}/api/push-preferences`, auth);
      assertEqual(stillSaved.json?.preferences?.timeOfDay, '07:30', '校验失败不应覆盖已保存值');
      return { detail: '4 类非法输入 → 400' };
    });

    await check('M4-06-04', '内部接口按用户读取与批量列表', async () => {
      const unauthorized = await http(`${workerUrl}/api/internal/push-preferences?userId=${USER_ID}`);
      assertEqual(unauthorized.status, 401, '无令牌状态码');
      const single = await http(
        `${workerUrl}/api/internal/push-preferences?userId=${USER_ID}`,
        internal
      );
      assertEqual(single.status, 200, '单用户状态码');
      assertEqual(single.json?.isDefault, false, '单用户 isDefault');
      assertEqual(single.json?.preferences?.timeOfDay, '07:30', '单用户 timeOfDay');
      const unknown = await http(
        `${workerUrl}/api/internal/push-preferences?userId=no-such-user`,
        internal
      );
      assertEqual(unknown.status, 200, '未知用户状态码');
      assertEqual(unknown.json?.isDefault, true, '未知用户回退默认');
      const batch = await http(`${workerUrl}/api/internal/push-preferences`, internal);
      assertEqual(batch.status, 200, '批量状态码');
      assert(
        (batch.json?.items ?? []).some((item) => item.userId === USER_ID),
        '批量列表应包含已保存用户'
      );
      return { detail: '单用户 / 未知回退 / 批量命中' };
    });

    await check('M4-06-05', '偏好接口未登录返回 401', async () => {
      const read = await http(`${workerUrl}/api/push-preferences`);
      assertEqual(read.status, 401, '读取状态码');
      const write = await http(`${workerUrl}/api/push-preferences`, {
        method: 'PUT',
        body: { preferences: { timeOfDay: '08:00' } },
      });
      assertEqual(write.status, 401, '保存状态码');
      return { detail: 'GET / PUT 均 401' };
    });

    // ── C 性能抽样 ──────────────────────────────────────────────
    console.log('• 种入 60 条系统通知用于性能抽样…');
    const bulk = await http(`${workerUrl}/api/internal/notifications`, {
      ...internal,
      method: 'POST',
      body: {
        notifications: Array.from({ length: 60 }, (_, index) => ({
          userId: USER_ID,
          type: 'system',
          title: `性能样例通知 ${index + 1}`,
          body: '用于通知列表性能抽样',
          dedupeKey: `system:perf:${index + 1}`,
        })),
      },
    });
    assertEqual(bulk.status, 200, '批量种入状态码');
    assertEqual(bulk.json?.created, 60, '批量种入条数');

    console.log('• 性能抽样…');
    const sampleResult = await sample(workerUrl, '/api/notifications?limit=20', cookie);
    perf.push({ ...sampleResult, label: '通知列表 limit=20' });
    console.log(
      `  · 通知列表：P50 ${formatMs(sampleResult.p50)} / P95 ${formatMs(sampleResult.p95)} / Max ${formatMs(sampleResult.max)}`
    );
    results.push({
      id: 'M4-P01',
      title: `性能抽样 P95 < ${PERF_BUDGET_MS}ms`,
      status: sampleResult.p95 < PERF_BUDGET_MS ? 'PASS' : 'FAIL',
      detail: `P50 ${formatMs(sampleResult.p50)} / P95 ${formatMs(sampleResult.p95)} · 64 条通知`,
      durationMs: sampleResult.p95,
    });

    const summary = summarize();
    console.log(
      `\n汇总：PASS ${summary.PASS} · GAP ${summary.GAP} · FAIL ${summary.FAIL} · SKIP ${summary.SKIP}`
    );

    const git = await gitInfo();
    const meta = {
      ...git,
      finishedAt: new Date().toISOString(),
      platform: `${process.platform} ${process.arch}`,
      nodeVersion: process.version,
    };
    if (REPORT_MD) {
      const target = resolve(REPO_ROOT, REPORT_MD);
      writeFileSync(target, buildMarkdown(meta), 'utf8');
      console.log(`• 已写入 Markdown 报告：${target}`);
    }
    if (REPORT_JSON) {
      const target = resolve(REPO_ROOT, REPORT_JSON);
      writeFileSync(target, JSON.stringify({ meta, results, perf }, null, 2), 'utf8');
      console.log(`• 已写入 JSON 报告：${target}`);
    }

    if (summary.FAIL > 0 || (STRICT && summary.GAP > 0)) {
      process.exitCode = 1;
    }
  } finally {
    await stopChild(wrangler);
    if (!KEEP) rmSync(persistDir, { recursive: true, force: true });
    else console.log(`• 保留本地 D1 目录：${persistDir}`);
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`\n✖ ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
