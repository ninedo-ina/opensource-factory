#!/usr/bin/env node
/**
 * M1 验收 · 端到端走查 + 性能抽样（零第三方依赖）
 *
 * 在独立的本地 D1（wrangler dev）里种入固定数据集，用真实 HTTP 走查 M1 的关键链路：
 *   健康检查 → 登录态 → 仓库列表 / 筛选 → 分类树 → 仪表盘 → 热榜 → 推荐
 *   → 同步触发 / 任务查询 → 分类与标签写操作 → 登出
 * 然后对仓库列表做多轮请求采样，输出 P50 / P95，并按 spec §6 断言 P95 < 300ms。
 *
 * 设计为「可适配分阶段合并」：M1 各能力由不同需求分支交付，未合并的能力记为 GAP（阻塞），
 * 已存在但行为不正确的记为 FAIL（红灯）。合并完成后用 --strict 跑一遍，GAP 也视为失败。
 *
 * 用法（在 edge/ 下）：
 *   npm run test:m1
 *   node scripts/m1-acceptance.mjs --strict
 *   node scripts/m1-acceptance.mjs --report-md docs/planning/acceptance-m1-report.md
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const EDGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(EDGE_ROOT, '..');
const WRANGLER_BIN = join(EDGE_ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const DB_NAME = 'opensource-factory';
const ALLOWED_ORIGIN = 'http://localhost:5173';
const SESSION_TOKEN = 'e2e-m1-session-token';
const INTERNAL_TOKEN = 'e2e-m1-internal-token';
const USER_ID = '1001';
const REPO_COUNT = 1200;
const PERF_SAMPLES = 200;
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
  return {
    status: res.status,
    text,
    json,
    durationMs: performance.now() - started,
  };
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

function buildSeedSql() {
  const lines = [
    'PRAGMA foreign_keys = OFF;',
    `INSERT INTO users (id, login, name, email) VALUES (${sqlQuote(USER_ID)}, 'tester', 'M1 Tester', 'tester@example.com');`,
  ];

  const categories = [
    ['cat-pay', '支付系统', null, '支付与账务', 0],
    ['cat-ai', 'AI', null, '人工智能', 1],
    ['cat-infra', '基础设施', null, '云原生与运维', 2],
    ['cat-pay-gateway', '支付网关', 'cat-pay', '统一支付网关', 0],
    ['cat-ai-agent', 'Agent', 'cat-ai', '智能体框架', 0],
  ];
  for (const [id, name, parentId, description, sortOrder] of categories) {
    lines.push(
      `INSERT INTO categories (id, name, parent_id, description, sort_order) VALUES (${sqlQuote(id)}, ${sqlQuote(name)}, ${sqlQuote(parentId)}, ${sqlQuote(description)}, ${sortOrder});`
    );
  }

  const tags = [
    ['TypeScript', 42],
    ['Python', 37],
    ['React', 28],
    ['FastAPI', 21],
    ['支付', 12],
  ];
  for (const [name, count] of tags) {
    lines.push(`INSERT INTO tags (name, count) VALUES (${sqlQuote(name)}, ${count});`);
  }

  const languages = ['TypeScript', 'Python', 'Go', 'Rust', 'Java'];
  const categoryIds = ['cat-pay', 'cat-ai', 'cat-infra', 'cat-pay-gateway', 'cat-ai-agent'];
  for (let i = 0; i < REPO_COUNT; i += 1) {
    const serial = String(i + 1).padStart(4, '0');
    const id = `tester/repo-${serial}`;
    const name = `repo-${serial}`;
    const isPayment = i % 4 === 0;
    const description = isPayment
      ? `支付与账务示例项目 ${serial}`
      : `开源工具示例项目 ${serial}`;
    const language = languages[i % languages.length];
    const categoryId = categoryIds[i % categoryIds.length];
    const stars = REPO_COUNT - i;
    const updatedAt = `2026-10-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`;
    lines.push(
      `INSERT INTO my_repositories (id, platform, name, description, html_url, stars, language, category_id, user_id, owner, forks, updated_at, synced_at) VALUES (${sqlQuote(id)}, 'github', ${sqlQuote(name)}, ${sqlQuote(description)}, ${sqlQuote(`https://github.com/${id}`)}, ${stars}, ${sqlQuote(language)}, ${sqlQuote(categoryId)}, ${sqlQuote(USER_ID)}, 'tester', ${i % 17}, ${sqlQuote(updatedAt)}, ${sqlQuote(updatedAt)});`
    );
    if (i < 100) {
      lines.push(`INSERT INTO repo_tags (repo_id, tag_id) VALUES (${sqlQuote(id)}, ${(i % tags.length) + 1});`);
    }
  }

  for (let i = 0; i < 25; i += 1) {
    const serial = String(i + 1).padStart(3, '0');
    lines.push(
      `INSERT INTO trending_repositories (id, platform, name, html_url, stars_today, description, tech_stack, crawled_at, owner, language, stars) VALUES (${sqlQuote(`trend/repo-${serial}`)}, 'github', ${sqlQuote(`trend-${serial}`)}, ${sqlQuote(`https://github.com/trend/repo-${serial}`)}, ${1000 - i * 7}, '今日热榜示例', 'TypeScript,React', CURRENT_DATE, 'trend', 'TypeScript', ${50_000 - i * 100});`
    );
  }

  for (let i = 0; i < 10; i += 1) {
    const serial = String(i + 1).padStart(2, '0');
    lines.push(
      `INSERT INTO recommendations (id, user_id, owner, name, description, language, stars, score, reason, based_on, url, status) VALUES (${sqlQuote(`rec-${serial}`)}, ${sqlQuote(USER_ID)}, 'rec', ${sqlQuote(`rec-${serial}`)}, '推荐示例项目', 'TypeScript', ${9000 - i * 10}, ${0.95 - i * 0.03}, '与你收藏的支付项目相似', '["tag:支付"]', ${sqlQuote(`https://github.com/rec/rec-${serial}`)}, 'new');`
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

function startMockVps(port) {
  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (url.pathname === '/api/tasks/sync' && req.method === 'POST') {
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ taskId: 'm1-e2e-task-1', status: 'queued' }));
      return;
    }
    if (url.pathname === '/api/tasks/m1-e2e-task-1') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          taskId: 'm1-e2e-task-1',
          status: 'SUCCESS',
          progress: { percent: 100, phase: 'done' },
          result: { fetched: 12, created: 7, updated: 3, unchanged: 2 },
        })
      );
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });
  return new Promise((done) => {
    server.listen(port, '127.0.0.1', () => done(server));
  });
}

function formatMs(value) {
  return `${value.toFixed(1)}ms`;
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
  return `# M1 验收报告（自动生成）

- 生成时间：${meta.finishedAt}
- 分支 / 提交：${meta.branch} / ${meta.commit}
- 运行环境：${meta.platform} · Node ${meta.nodeVersion}
- 数据规模：${REPO_COUNT} 个仓库 / 5 个分类 / 5 个标签 / 25 条热榜 / 10 条推荐
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

function summarize() {
  const summary = { PASS: 0, GAP: 0, FAIL: 0, SKIP: 0 };
  for (const item of results) summary[item.status] = (summary[item.status] ?? 0) + 1;
  return summary;
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

  const persistDir = join(EDGE_ROOT, '.wrangler', `e2e-m1-${process.pid}`);
  rmSync(persistDir, { recursive: true, force: true });
  const tempDir = mkdtempSync(join(tmpdir(), 'm1-acceptance-'));

  const env = {
    ...process.env,
    CI: '1',
    WRANGLER_SEND_METRICS: 'false',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  };

  console.log('• 应用本地 D1 迁移…');
  await runWrangler(
    ['d1', 'migrations', 'apply', DB_NAME, '--local', '--persist-to', persistDir],
    env
  );

  console.log(`• 种入验收数据集（${REPO_COUNT} 仓库）…`);
  const seedFile = join(tempDir, 'seed.sql');
  writeFileSync(seedFile, buildSeedSql(), 'utf8');
  await runWrangler(
    ['d1', 'execute', DB_NAME, '--local', '--persist-to', persistDir, '--file', seedFile],
    env
  );

  const sessionId = createHash('sha256').update(SESSION_TOKEN).digest('hex');
  await runWrangler(
    [
      'd1',
      'execute',
      DB_NAME,
      '--local',
      '--persist-to',
      persistDir,
      '--command',
      `INSERT INTO sessions (id, user_id, expires_at) VALUES ('${sessionId}', '${USER_ID}', '2099-01-01T00:00:00.000Z');`,
    ],
    env
  );

  const workerPort = await getFreePort();
  const inspectorPort = await getFreePort();
  const vpsPort = await getFreePort();
  const workerUrl = `http://127.0.0.1:${workerPort}`;
  const vpsServer = await startMockVps(vpsPort);

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
      `VPS_NODE_URL:http://127.0.0.1:${vpsPort}`,
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
  const auth = { cookie };

  try {
    console.log('• 启动 wrangler dev（本地 D1 + mock VPS）…');
    await waitForHealth(workerUrl, wrangler, () => wranglerOutput);

    await check('M1-A01', '健康检查 /healthz', async () => {
      const res = await http(`${workerUrl}/healthz`);
      assertEqual(res.status, 200, '状态码');
      assertEqual(res.json?.status, 'ok', '响应');
      return { detail: '200 {"status":"ok"}' };
    });

    await check('M1-A02', '未登录访问 /api/auth/me 返回 401', async () => {
      const res = await http(`${workerUrl}/api/auth/me`);
      assertEqual(res.status, 401, '状态码');
      return { detail: '401 unauthorized' };
    });

    await check('M1-A03', '种子会话登录态 /api/auth/me', async () => {
      const res = await http(`${workerUrl}/api/auth/me`, auth);
      assertEqual(res.status, 200, '状态码');
      assertEqual(res.json?.login, 'tester', '登录名');
      return { detail: `200 ${res.json?.login}` };
    });

    await check('M1-B01', '仓库列表返回当前用户数据', async () => {
      const res = await http(`${workerUrl}/api/repos`, auth);
      assertEqual(res.status, 200, '状态码');
      assert(Array.isArray(res.json), '响应应为数组');
      assert(res.json.length > 0, '列表不应为空');
      return { detail: `${res.json.length} 条` };
    });

    await check('M1-B02', '仓库列表默认分页上限（M1-12）', async () => {
      const res = await http(`${workerUrl}/api/repos`, auth);
      assertEqual(res.status, 200, '状态码');
      if (!Array.isArray(res.json) || res.json.length > 200) {
        return {
          status: 'GAP',
          detail: `返回 ${Array.isArray(res.json) ? res.json.length : '非数组'} 条，未启用 limit（待 M1-12 合并）`,
        };
      }
      return { detail: `${res.json.length} 条（≤200）` };
    });

    await check('M1-B03', 'limit=5 精确返回 5 条（M1-12）', async () => {
      const res = await http(`${workerUrl}/api/repos?limit=5`, auth);
      assertEqual(res.status, 200, '状态码');
      if (!Array.isArray(res.json) || res.json.length !== 5) {
        return { status: 'GAP', detail: `返回 ${Array.isArray(res.json) ? res.json.length : '非数组'} 条，limit 未生效` };
      }
      return { detail: '5 条' };
    });

    await check('M1-B04', '关键字筛选 q=支付', async () => {
      const res = await http(`${workerUrl}/api/repos?q=${encodeURIComponent('支付')}`, auth);
      assertEqual(res.status, 200, '状态码');
      assert(Array.isArray(res.json), '响应应为数组');
      assert(res.json.length > 0, '应命中支付类仓库');
      const bad = res.json.filter(
        (item) =>
          !`${item.fullName} ${item.description ?? ''}`.includes('支付')
      );
      assertEqual(bad.length, 0, '不应返回不含关键字的仓库');
      return { detail: `${res.json.length} 条命中` };
    });

    await check('M1-B05', '分类筛选 categoryId=cat-pay', async () => {
      const res = await http(`${workerUrl}/api/repos?categoryId=cat-pay`, auth);
      assertEqual(res.status, 200, '状态码');
      assert(Array.isArray(res.json), '响应应为数组');
      assert(res.json.length > 0, '应命中分类仓库');
      const bad = res.json.filter((item) => item.category !== '支付系统' && item.category !== 'cat-pay');
      assertEqual(bad.length, 0, '不应返回其他分类');
      return { detail: `${res.json.length} 条` };
    });

    await check('M1-B06', 'LIKE 通配符转义 q=%（M1-12）', async () => {
      const res = await http(`${workerUrl}/api/repos?q=${encodeURIComponent('%')}`, auth);
      assertEqual(res.status, 200, '状态码');
      assert(Array.isArray(res.json), '响应应为数组');
      if (res.json.length >= REPO_COUNT) {
        return { status: 'GAP', detail: `返回全部 ${res.json.length} 条，% 未转义（待 M1-12 合并）` };
      }
      return { detail: `${res.json.length} 条（未放大）` };
    });

    await check('M1-C01', '分类列表与树字段（M1-09）', async () => {
      const res = await http(`${workerUrl}/api/categories`, auth);
      assertEqual(res.status, 200, '状态码');
      assert(Array.isArray(res.json?.categories), 'categories 应为数组');
      assertEqual(res.json.categories.length, 5, '分类数量');
      const hasTree = res.json.categories.every(
        (item) => Object.hasOwn(item, 'parentId') && Object.hasOwn(item, 'sortOrder')
      );
      if (!hasTree) {
        return { status: 'GAP', detail: '返回扁平结构，缺少 parentId / sortOrder（待 M1-09 合并）' };
      }
      const gateway = res.json.categories.find((item) => item.name === '支付网关');
      assertEqual(gateway?.parentId, 'cat-pay', '子分类 parentId');
      return { detail: '5 个分类，树字段完整' };
    });

    await check('M1-C02', '分类写操作 CRUD（M1-09）', async () => {
      const probe = await http(`${workerUrl}/api/categories`, {
        ...auth,
        method: 'POST',
        body: { name: '验收临时分类' },
      });
      if (probe.status === 404 || probe.status === 405) {
        return { status: 'GAP', detail: `POST /api/categories → ${probe.status}（待 M1-09 合并）` };
      }
      assertEqual(probe.status, 201, '新建状态码');
      const id = probe.json?.id;
      assert(id, '新建应返回 id');
      const renamed = await http(`${workerUrl}/api/categories/${id}`, {
        ...auth,
        method: 'PATCH',
        body: { name: '验收临时分类-改' },
      });
      assertEqual(renamed.status, 200, '编辑状态码');
      assertEqual(renamed.json?.name, '验收临时分类-改', '名称');
      const deleted = await http(`${workerUrl}/api/categories/${id}`, { ...auth, method: 'DELETE' });
      assertEqual(deleted.status, 204, '删除状态码');
      return { detail: '新建 / 编辑 / 删除通过' };
    });

    await check('M1-C03', '标签写操作（M1-10）', async () => {
      const probe = await http(`${workerUrl}/api/tags`, {
        ...auth,
        method: 'POST',
        body: { name: '验收标签' },
      });
      if (probe.status === 404 || probe.status === 405) {
        return { status: 'GAP', detail: `POST /api/tags → ${probe.status}（待 M1-10 合并）` };
      }
      assert(probe.status === 200 || probe.status === 201, `新建标签状态码 ${probe.status}`);
      const list = await http(`${workerUrl}/api/tags`, auth);
      assertEqual(list.status, 200, '标签列表状态码');
      return { detail: '标签新建 / 列表通过' };
    });

    await check('M1-D01', '仪表盘统计 /api/dashboard/stats', async () => {
      const res = await http(`${workerUrl}/api/dashboard/stats`, auth);
      assertEqual(res.status, 200, '状态码');
      assertEqual(res.json?.totalRepos, REPO_COUNT, '总仓库数');
      assertEqual(res.json?.categoryCount, 5, '分类数');
      return { detail: `totalRepos=${res.json.totalRepos}` };
    });

    await check('M1-D02', '热榜列表 /api/trending', async () => {
      const res = await http(`${workerUrl}/api/trending`);
      assertEqual(res.status, 200, '状态码');
      assert(Array.isArray(res.json), '响应应为数组');
      assertEqual(res.json.length, 20, '默认 limit');
      return { detail: `${res.json.length} 条` };
    });

    await check('M1-D03', '推荐列表 /api/recommendations', async () => {
      const res = await http(`${workerUrl}/api/recommendations`, auth);
      assertEqual(res.status, 200, '状态码');
      assert(Array.isArray(res.json), '响应应为数组');
      assertEqual(res.json.length, 10, '推荐条数');
      return { detail: `${res.json.length} 条` };
    });

    await check('M1-E01', '同步触发 /api/sync → mock VPS', async () => {
      const res = await http(`${workerUrl}/api/sync`, { ...auth, method: 'POST', body: {} });
      assertEqual(res.status, 202, '状态码');
      if (res.json?.status !== 'queued' || !res.json?.taskId) {
        return {
          status: 'GAP',
          detail: `返回 ${JSON.stringify(res.json)}，未回传 taskId（待 M1-08 合并）`,
        };
      }
      return { detail: `taskId=${res.json.taskId}` };
    });

    await check('M1-E02', '同步任务查询 /api/tasks（M1-08）', async () => {
      const list = await http(`${workerUrl}/api/tasks`, auth);
      if (list.status === 404) {
        return { status: 'GAP', detail: 'GET /api/tasks → 404（待 M1-08 合并）' };
      }
      assertEqual(list.status, 200, '任务列表状态码');
      const detail = await http(`${workerUrl}/api/tasks/m1-e2e-task-1`, auth);
      assertEqual(detail.status, 200, '任务详情状态码');
      assert(detail.json?.status, '任务详情应包含 status');
      return { detail: `任务状态 ${detail.json.status}` };
    });

    console.log('\n• 性能抽样（顺序请求，排除冷启动）…');
    const perfCases = [
      { path: '/api/repos?limit=100', label: '仓库列表 limit=100' },
      { path: `/api/repos?q=${encodeURIComponent('支付')}`, label: '关键字检索 q=支付' },
      { path: '/api/repos?categoryId=cat-pay', label: '分类筛选 cat-pay' },
      { path: '/api/dashboard/stats', label: '仪表盘统计' },
    ];
    for (const item of perfCases) {
      const sampleResult = await sample(workerUrl, item.path, cookie);
      perf.push({ ...sampleResult, label: item.label });
      console.log(
        `  · ${item.label}：P50 ${formatMs(sampleResult.p50)} / P95 ${formatMs(sampleResult.p95)} / Max ${formatMs(sampleResult.max)}`
      );
    }
    const slow = perf.filter((item) => item.p95 >= PERF_BUDGET_MS);
    results.push({
      id: 'M1-P01',
      title: `性能抽样 P95 < ${PERF_BUDGET_MS}ms`,
      status: slow.length === 0 ? 'PASS' : 'FAIL',
      detail:
        slow.length === 0
          ? perf.map((item) => `${item.label} P95 ${formatMs(item.p95)}`).join('；')
          : slow.map((item) => `${item.label} P95 ${formatMs(item.p95)}`).join('；'),
      durationMs: perf.reduce((sum, item) => sum + item.p95, 0),
    });

    await check('M1-F01', '登出 /api/auth/logout 清除会话', async () => {
      const res = await http(`${workerUrl}/api/auth/logout`, { ...auth, method: 'POST' });
      assertEqual(res.status, 204, '登出状态码');
      const me = await http(`${workerUrl}/api/auth/me`, auth);
      assertEqual(me.status, 401, '登出后 /me');
      return { detail: '204 → 401' };
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
    await new Promise((done) => vpsServer.close(done));
    if (!KEEP) rmSync(persistDir, { recursive: true, force: true });
    else console.log(`• 保留本地 D1 目录：${persistDir}`);
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`\n✖ ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
