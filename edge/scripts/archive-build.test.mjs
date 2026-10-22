import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ARCHIVE_EXCLUDED,
  archiveFileName,
  archiveId,
  buildArchive,
  buildArchiveManifest,
  normalizeArchiveOptions,
} from '../src/archive/build.ts';
import { sha256Hex } from '../src/archive/hash.ts';

const NOW = '2026-10-22T13:45:00.000Z';
const USER = {
  id: 'u1',
  login: 'fntp',
  name: 'Fntp',
  email: 'fntp@example.com',
  avatarUrl: 'https://avatars.example.com/u1',
  createdAt: '2026-10-01 08:00:00',
};

const DATASETS = [
  { key: 'profile', label: '账号资料', records: [{ id: 'u1', login: 'fntp' }] },
  {
    key: 'repositories',
    label: '收藏仓库',
    records: [{ id: 'acme/alpha', stars: 120, category_name: '支付系统' }],
  },
  { key: 'categories', label: '分类', records: [{ id: 'cat-pay', name: '支付系统' }] },
  { key: 'tags', label: '标签', records: [{ id: 1, name: '支付', repoIds: ['acme/alpha'] }] },
  { key: 'recommendations', label: '智能推荐', records: [] },
  {
    key: 'notifications',
    label: '站内通知',
    records: [{ id: 'n1', title: '今日推荐', user_id: 'u1' }],
  },
];

function input(overrides = {}) {
  return {
    generatedAt: NOW,
    scope: 'full',
    format: 'zip',
    user: USER,
    datasets: DATASETS,
    ...overrides,
  };
}

/** 解析 store 模式 ZIP 的本地文件条目（测试专用）。 */
function readZipFiles(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const files = new Map();
  let offset = 0;
  while (offset + 4 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = decoder.decode(bytes.slice(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength + extraLength;
    files.set(name, decoder.decode(bytes.slice(start, start + size)));
    offset = start + size;
  }
  return files;
}

test('normalizeArchiveOptions 默认完整 ZIP，非法值回退', () => {
  assert.deepEqual(normalizeArchiveOptions({}), { scope: 'full', format: 'zip' });
  assert.deepEqual(normalizeArchiveOptions({ scope: 'knowledge', format: 'json' }), {
    scope: 'knowledge',
    format: 'json',
  });
  assert.equal(normalizeArchiveOptions({ scope: 'unknown' }).scope, 'full');
  assert.equal(normalizeArchiveOptions({ format: 'tar' }).format, 'zip');
});

test('archiveId / archiveFileName 稳定且可读', () => {
  assert.equal(archiveId(NOW, 'full'), 'arc-20261022134500-full');
  assert.equal(archiveFileName('zip', NOW), 'openfactory-archive-2026-10-22.zip');
  assert.equal(archiveFileName('json', NOW), 'openfactory-archive-2026-10-22.json');
});

test('buildArchiveManifest 输出数据集清单、统计与隐私排除项', async () => {
  const manifest = await buildArchiveManifest(input());
  assert.equal(manifest.schema, 'openfactory.archive.v1');
  assert.equal(manifest.version, 1);
  assert.equal(manifest.scope, 'full');
  assert.equal(manifest.format, 'zip');
  assert.equal(manifest.user.login, 'fntp');
  assert.equal(manifest.stats.datasets, DATASETS.length);
  assert.equal(manifest.stats.records, 5);
  assert.equal(manifest.stats.files, DATASETS.length + 3);
  assert.equal(manifest.datasets[0].path, 'data/profile.json');
  assert.equal(manifest.datasets[0].sha256.length, 64);
  assert.ok(ARCHIVE_EXCLUDED.includes('sessions'));
  assert.ok(ARCHIVE_EXCLUDED.includes('extension_tokens'));
  assert.ok(manifest.privacy.excluded.includes('telegram_link_codes'));
  assert.equal(manifest.checksums.file, 'checksums.sha256');
});

test('buildArchive ZIP 包含 manifest / README / checksums / data 且校验和一致', async () => {
  const bundle = await buildArchive(input());
  assert.equal(bundle.contentType, 'application/zip');
  assert.equal(bundle.fileName, 'openfactory-archive-2026-10-22.zip');
  assert.ok(bundle.body.length > 0);

  const files = readZipFiles(bundle.body);
  assert.ok(files.has('manifest.json'));
  assert.ok(files.has('README.md'));
  assert.ok(files.has('checksums.sha256'));
  assert.ok(files.has('data/profile.json'));
  assert.ok(files.has('data/repositories.json'));
  assert.ok(files.has('data/notifications.json'));

  const manifest = JSON.parse(files.get('manifest.json'));
  assert.equal(manifest.schema, 'openfactory.archive.v1');
  assert.equal(manifest.stats.datasets, DATASETS.length);
  assert.equal(manifest.datasets.length, DATASETS.length);
  assert.equal(JSON.parse(files.get('data/repositories.json'))[0].id, 'acme/alpha');

  const checksumLines = files.get('checksums.sha256').trim().split('\n');
  assert.equal(checksumLines.length, DATASETS.length + 2);
  for (const line of checksumLines) {
    const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    assert.ok(match, `校验行格式：${line}`);
    assert.equal(await sha256Hex(files.get(match[2])), match[1], `${match[2]} 摘要一致`);
  }

  assert.match(files.get('README.md'), /OpenFactory 全量归档/);
  assert.match(files.get('README.md'), /sha256sum -c checksums\.sha256/);
  assert.match(files.get('README.md'), /sessions/);
});

test('buildArchive JSON 单文件包含 manifest / checksums / data', async () => {
  const bundle = await buildArchive(input({ format: 'json' }));
  assert.equal(bundle.contentType, 'application/json; charset=utf-8');
  const doc = JSON.parse(new TextDecoder().decode(bundle.body));
  assert.equal(doc.manifest.schema, 'openfactory.archive.v1');
  assert.equal(doc.manifest.format, 'json');
  assert.equal(doc.manifest.checksums.embedded, true);
  assert.equal(doc.data.repositories[0].id, 'acme/alpha');
  assert.equal(doc.data.profile[0].login, 'fntp');
  assert.equal(doc.checksums['data/repositories.json'].length, 64);
  assert.equal(
    doc.checksums['data/repositories.json'],
    await sha256Hex(JSON.stringify(doc.data.repositories, null, 2) + '\n')
  );
});

test('buildArchive 对空数据集仍生成稳定的空文件与清单', async () => {
  const bundle = await buildArchive(input({ datasets: [], scope: 'knowledge' }));
  const files = readZipFiles(bundle.body);
  const manifest = JSON.parse(files.get('manifest.json'));
  assert.equal(manifest.scope, 'knowledge');
  assert.equal(manifest.stats.datasets, 0);
  assert.equal(manifest.stats.records, 0);
  assert.equal(manifest.stats.files, 3);
  assert.equal(files.get('checksums.sha256').trim().split('\n').length, 2);
});
