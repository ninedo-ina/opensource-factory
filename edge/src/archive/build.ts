/**
 * 全量导出与归档（M9-04）：构建 `openfactory.archive.v1`。
 *
 * 设计约束：
 * - 不访问 D1 / 网络，输入为按 user_id 查好的数据集，便于 node:test 直接覆盖；
 * - ZIP 复用 M6-08 的最小 store writer，不引入第三方压缩依赖；
 * - manifest / checksums 使用 SHA-256，可被 `sha256sum -c` 直接校验；
 * - 格式只加字段、不改语义，见 docs/guides/full-export-archive.md。
 */
import { buildStoreZip, type ZipEntry } from '../export/build';
import { sha256Hex } from './hash';

export type ArchiveScope = 'full' | 'knowledge';
export type ArchiveFormat = 'zip' | 'json';

export interface ArchiveUser {
  id: string;
  login: string;
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  createdAt?: string | null;
}

export interface ArchiveDatasetInput {
  key: string;
  label: string;
  records: unknown[];
}

export interface ArchiveOptions {
  scope: ArchiveScope;
  format: ArchiveFormat;
}

export interface ArchiveDatasetEntry {
  key: string;
  label: string;
  path: string;
  records: number;
  bytes: number;
  sha256: string;
}

export interface ArchiveManifest {
  schema: 'openfactory.archive.v1';
  version: 1;
  archiveId: string;
  generatedAt: string;
  generator: { name: string; url: string };
  format: ArchiveFormat;
  scope: ArchiveScope;
  user: {
    id: string;
    login: string;
    name: string | null;
    email: string | null;
  };
  stats: { datasets: number; records: number; bytes: number; files: number };
  datasets: ArchiveDatasetEntry[];
  privacy: { excluded: string[]; notes: string[] };
  restore: { mode: 'logical'; instructions: string };
  checksums: { algorithm: 'sha256'; file?: string; embedded: boolean };
}

export interface ArchiveBundle {
  body: Uint8Array;
  contentType: string;
  fileName: string;
  manifest: ArchiveManifest;
}

export interface ArchiveInput extends ArchiveOptions {
  generatedAt: string;
  user: ArchiveUser;
  datasets: ArchiveDatasetInput[];
}

export const ARCHIVE_SCHEMA = 'openfactory.archive.v1';
export const ARCHIVE_VERSION = 1;
const GENERATOR_URL = 'https://github.com/fntp/opensource-factory';

/** 归档明确排除的运维 / 秘密数据。 */
export const ARCHIVE_EXCLUDED = [
  'sessions',
  'extension_tokens',
  'telegram_links',
  'telegram_link_codes',
  'login_attempts',
  'security_events',
  'worker_metrics',
  'rate_limit_counters',
] as const;

const RESTORE_INSTRUCTIONS =
  '按 data/*.json 中的 user_id 归属导入：先导入 profile，再导入 categories / tags，最后导入 repositories 与活动数据；导入前先用 sha256sum -c checksums.sha256 校验。';

const encoder = new TextEncoder();

export function normalizeArchiveOptions(input: {
  scope?: string | null;
  format?: string | null;
}): ArchiveOptions {
  return {
    scope: input.scope === 'knowledge' ? 'knowledge' : 'full',
    format: input.format === 'json' ? 'json' : 'zip',
  };
}

/** 归档 id 只由生成时间与范围决定，同一时刻重放可得到相同 id。 */
export function archiveId(generatedAt: string, scope: ArchiveScope): string {
  const compact = generatedAt.replace(/[^0-9]/g, '').slice(0, 14) || 'unknown';
  return `arc-${compact}-${scope}`;
}

export function archiveFileName(format: ArchiveFormat, generatedAt: string): string {
  const date = generatedAt.slice(0, 10) || 'archive';
  return format === 'json'
    ? `openfactory-archive-${date}.json`
    : `openfactory-archive-${date}.zip`;
}

function jsonContent(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function totalRecords(datasets: ArchiveDatasetEntry[]): number {
  return datasets.reduce((sum, dataset) => sum + dataset.records, 0);
}

function totalBytes(datasets: ArchiveDatasetEntry[]): number {
  return datasets.reduce((sum, dataset) => sum + dataset.bytes, 0);
}

async function prepareDatasets(
  datasets: ArchiveDatasetInput[]
): Promise<Array<ArchiveDatasetEntry & { content: string }>> {
  const prepared: Array<ArchiveDatasetEntry & { content: string }> = [];
  for (const dataset of datasets) {
    const content = jsonContent(dataset.records);
    const bytes = encoder.encode(content).length;
    prepared.push({
      key: dataset.key,
      label: dataset.label,
      path: `data/${dataset.key}.json`,
      records: dataset.records.length,
      bytes,
      sha256: await sha256Hex(content),
      content,
    });
  }
  return prepared;
}

function buildManifest(
  input: ArchiveInput,
  datasets: ArchiveDatasetEntry[],
  format: ArchiveFormat
): ArchiveManifest {
  return {
    schema: ARCHIVE_SCHEMA,
    version: ARCHIVE_VERSION,
    archiveId: archiveId(input.generatedAt, input.scope),
    generatedAt: input.generatedAt,
    generator: { name: 'OpenFactory', url: GENERATOR_URL },
    format,
    scope: input.scope,
    user: {
      id: input.user.id,
      login: input.user.login,
      name: input.user.name ?? null,
      email: input.user.email ?? null,
    },
    stats: {
      datasets: datasets.length,
      records: totalRecords(datasets),
      bytes: totalBytes(datasets),
      files: format === 'zip' ? datasets.length + 3 : datasets.length,
    },
    datasets,
    privacy: {
      excluded: [...ARCHIVE_EXCLUDED],
      notes: [
        '不包含任何明文令牌、会话、Telegram 绑定码或登录安全事件',
        '邮箱仅来自用户自己的 GitHub 资料，随归档由用户自行保管',
      ],
    },
    restore: { mode: 'logical', instructions: RESTORE_INSTRUCTIONS },
    checksums:
      format === 'zip'
        ? { algorithm: 'sha256', file: 'checksums.sha256', embedded: false }
        : { algorithm: 'sha256', embedded: true },
  };
}

/** 仅构建 manifest（用于 /manifest 预览接口）。 */
export async function buildArchiveManifest(input: ArchiveInput): Promise<ArchiveManifest> {
  const prepared = await prepareDatasets(input.datasets);
  return buildManifest(
    input,
    prepared.map(({ content: _content, ...entry }) => entry),
    input.format
  );
}

function buildReadme(manifest: ArchiveManifest): string {
  const lines: string[] = [];
  lines.push('# OpenFactory 全量归档');
  lines.push('');
  lines.push(`> 格式：\`${manifest.schema}\` v${manifest.version} · 生成时间：${manifest.generatedAt}`);
  lines.push(`> 账号：${manifest.user.login} · 范围：${manifest.scope} · 数据集：${manifest.stats.datasets} 个 · 记录：${manifest.stats.records} 条`);
  lines.push('');
  lines.push('## 数据集');
  lines.push('');
  lines.push('| 数据集 | 记录数 | 文件 | SHA-256 |');
  lines.push('| --- | ---: | --- | --- |');
  for (const dataset of manifest.datasets) {
    lines.push(
      `| ${dataset.label} | ${dataset.records} | \`${dataset.path}\` | \`${dataset.sha256}\` |`
    );
  }
  lines.push('');
  lines.push('## 校验');
  lines.push('');
  lines.push('```bash');
  lines.push('sha256sum -c checksums.sha256');
  lines.push('```');
  lines.push('');
  lines.push('## 恢复');
  lines.push('');
  lines.push(manifest.restore.instructions);
  lines.push('');
  lines.push('## 隐私边界');
  lines.push('');
  lines.push(`本归档不包含：${manifest.privacy.excluded.map((item) => `\`${item}\``).join('、')}。`);
  lines.push('');
  return lines.join('\n');
}

interface HashedEntry {
  name: string;
  content: string;
  sha256: string;
}

function buildChecksums(entries: HashedEntry[]): string {
  // 只对实际文件内容计算，manifest 自身也纳入校验。
  const lines = entries.map((entry) => `${entry.sha256}  ${entry.name}`);
  return `${lines.join('\n')}\n`;
}

/** 构建完整归档（ZIP 或单文件 JSON）。 */
export async function buildArchive(input: ArchiveInput): Promise<ArchiveBundle> {
  const prepared = await prepareDatasets(input.datasets);
  const datasets = prepared.map(({ content: _content, ...entry }) => entry);
  const manifest = buildManifest(input, datasets, input.format);
  const fileName = archiveFileName(input.format, input.generatedAt);

  if (input.format === 'json') {
    const checksums = Object.fromEntries(
      prepared.map((dataset) => [dataset.path, dataset.sha256])
    );
    const body = jsonContent({
      manifest,
      checksums,
      data: Object.fromEntries(
        prepared.map((dataset) => [dataset.key, JSON.parse(dataset.content) as unknown])
      ),
    });
    return {
      body: encoder.encode(body),
      contentType: 'application/json; charset=utf-8',
      fileName,
      manifest,
    };
  }

  const readme = buildReadme(manifest);
  const manifestContent = jsonContent(manifest);

  const withHashes: HashedEntry[] = [
    { name: 'manifest.json', content: manifestContent, sha256: await sha256Hex(manifestContent) },
    { name: 'README.md', content: readme, sha256: await sha256Hex(readme) },
    ...prepared.map((dataset) => ({
      name: dataset.path,
      content: dataset.content,
      sha256: dataset.sha256,
    })),
  ];

  const checksums = buildChecksums(withHashes);
  withHashes.push({
    name: 'checksums.sha256',
    content: checksums,
    sha256: await sha256Hex(checksums),
  });

  const zipEntries: ZipEntry[] = withHashes.map(({ name, content }) => ({ name, content }));
  const body = buildStoreZip(zipEntries, new Date(input.generatedAt));

  return {
    body,
    contentType: 'application/zip',
    fileName,
    manifest,
  };
}
