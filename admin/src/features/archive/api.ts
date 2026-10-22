import { API_BASE, ApiHttpError, DEMO_MODE, fetchWithFallback } from '@/lib/api'
import { buildStoreZip, type ZipEntry } from '@/features/export/zip'
import type {
  ArchiveDownload,
  ArchiveFormat,
  ArchiveRequest,
  ArchiveSummary,
} from './types'
import { fallbackArchiveFileName } from './utils'

/** 演示模式下的归档统计（与演示仓库 / 活动数据保持一致） */
export const MOCK_ARCHIVE_SUMMARY: ArchiveSummary = {
  schema: 'openfactory.archive.v1',
  version: 1,
  generatedAt: '2026-10-22T13:45:00.000Z',
  datasets: [
    { key: 'profile', label: '账号资料', knowledge: true, records: 1 },
    { key: 'repositories', label: '收藏仓库', knowledge: true, records: 4 },
    { key: 'categories', label: '分类', knowledge: true, records: 3 },
    { key: 'tags', label: '标签', knowledge: true, records: 11 },
    { key: 'recommendations', label: '智能推荐', knowledge: false, records: 6 },
    {
      key: 'recommendation-feedback',
      label: '推荐反馈',
      knowledge: false,
      records: 2,
    },
    { key: 'notifications', label: '站内通知', knowledge: false, records: 3 },
    {
      key: 'push-preferences',
      label: '推送偏好',
      knowledge: false,
      records: 1,
    },
    { key: 'reports', label: '精选报告', knowledge: false, records: 2 },
    { key: 'repo-updates', label: '更新提醒', knowledge: false, records: 1 },
    {
      key: 'duplicate-dismissals',
      label: '重复检测忽略记录',
      knowledge: false,
      records: 0,
    },
  ],
  totalRecords: 34,
  estimatedBytes: 17408,
  scopes: [
    { key: 'full', label: '完整归档', datasets: 11 },
    { key: 'knowledge', label: '知识库归档', datasets: 4 },
  ],
  formats: ['zip', 'json'],
}

export function fetchArchiveSummary(): Promise<ArchiveSummary> {
  return fetchWithFallback<ArchiveSummary>(
    '/api/export/archive/summary',
    MOCK_ARCHIVE_SUMMARY
  )
}

function parseFileName(header: string | null, fallback: string): string {
  if (!header) return fallback
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header)
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1])
    } catch {
      // 忽略非法编码，继续尝试普通 filename
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header)
  return plain?.[1]?.trim() || fallback
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function jsonContent(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

/** 演示模式：按真实归档格式在浏览器本地生成同构文件。 */
async function buildDemoArchive(
  request: ArchiveRequest
): Promise<ArchiveDownload> {
  const generatedAt = new Date().toISOString()
  const full = request.scope === 'full'
  const profile = [{ id: 'u-demo', login: 'fntp', name: 'fntp' }]
  const repositories = [
    {
      id: 'acme/alpha',
      fullName: 'acme/alpha',
      stars: 1200,
      category: 'AI/LLM',
      tags: ['llm', 'agent'],
    },
    {
      id: 'acme/beta',
      fullName: 'acme/beta',
      stars: 80,
      category: '工具',
      tags: ['cli'],
    },
  ]
  const data: Record<string, unknown[]> = {
    profile,
    repositories,
    categories: [{ id: 'cat-1', name: 'AI/LLM' }],
    tags: [{ name: 'llm', repoIds: ['acme/alpha'] }],
  }
  if (full) {
    data.recommendations = [{ id: 'rec-1', repoId: 'acme/alpha', score: 0.92 }]
    data.notifications = [{ id: 'n-1', title: '今日推荐' }]
    data.reports = [{ id: 'rpt-1', kind: 'weekly', title: '每周精选' }]
    data['repo-updates'] = [
      { id: 'up-1', repoId: 'acme/alpha', version: 'v1.2.0' },
    ]
  }

  const entries: Array<ZipEntry & { sha256: string }> = []
  for (const [key, records] of Object.entries(data)) {
    const content = jsonContent(records)
    entries.push({
      name: `data/${key}.json`,
      content,
      sha256: await sha256Hex(content),
    })
  }
  const manifest = {
    schema: 'openfactory.archive.v1',
    version: 1,
    archiveId: `arc-demo-${request.scope}`,
    generatedAt,
    generator: {
      name: 'OpenFactory',
      url: 'https://github.com/fntp/opensource-factory',
    },
    format: request.format,
    scope: request.scope,
    user: { id: 'u-demo', login: 'fntp', name: 'fntp', email: null },
    stats: {
      datasets: entries.length,
      records: Object.values(data).reduce((sum, rows) => sum + rows.length, 0),
      bytes: entries.reduce((sum, entry) => sum + entry.content.length, 0),
      files: request.format === 'zip' ? entries.length + 3 : entries.length,
    },
    datasets: entries.map((entry) => ({
      key: entry.name.replace(/^data\//, '').replace(/\.json$/, ''),
      label: entry.name,
      path: entry.name,
      records:
        data[entry.name.replace(/^data\//, '').replace(/\.json$/, '')]
          ?.length ?? 0,
      bytes: entry.content.length,
      sha256: entry.sha256,
    })),
    privacy: {
      excluded: [
        'sessions',
        'extension_tokens',
        'telegram_links',
        'telegram_link_codes',
      ],
      notes: ['演示数据，仅用于本地预览'],
    },
    restore: { mode: 'logical', instructions: '演示模式不提供恢复。' },
    checksums: {
      algorithm: 'sha256',
      file: 'checksums.sha256',
      embedded: false,
    },
  }

  if (request.format === 'json') {
    const checksums = Object.fromEntries(
      entries.map((entry) => [entry.name, entry.sha256])
    )
    const body = jsonContent({
      manifest: {
        ...manifest,
        checksums: { algorithm: 'sha256', embedded: true },
      },
      checksums,
      data,
    })
    return {
      blob: new Blob([body], { type: 'application/json; charset=utf-8' }),
      fileName: fallbackArchiveFileName('json', generatedAt),
    }
  }

  const readme = [
    '# OpenFactory 全量归档（演示）',
    '',
    `> 格式：openfactory.archive.v1 · 生成时间：${generatedAt}`,
    '',
    '## 数据集',
    '',
    ...entries.map(
      (entry) => `- \`${entry.name}\`：${entry.sha256.slice(0, 12)}…`
    ),
    '',
  ].join('\n')
  const manifestContent = jsonContent(manifest)
  const allEntries: ZipEntry[] = [
    { name: 'manifest.json', content: manifestContent },
    { name: 'README.md', content: readme },
    {
      name: 'checksums.sha256',
      content:
        [
          `${await sha256Hex(manifestContent)}  manifest.json`,
          `${await sha256Hex(readme)}  README.md`,
          ...entries.map((entry) => `${entry.sha256}  ${entry.name}`),
        ].join('\n') + '\n',
    },
    ...entries.map((entry) => ({ name: entry.name, content: entry.content })),
  ]

  const zipBytes = buildStoreZip(allEntries)
  const zipBuffer = zipBytes.buffer.slice(
    zipBytes.byteOffset,
    zipBytes.byteOffset + zipBytes.byteLength
  ) as ArrayBuffer
  return {
    blob: new Blob([zipBuffer], { type: 'application/zip' }),
    fileName: fallbackArchiveFileName('zip', generatedAt),
  }
}

/** 下载全量归档；演示模式下由前端本地生成同构文件。 */
export async function downloadArchive(
  request: ArchiveRequest
): Promise<ArchiveDownload> {
  if (DEMO_MODE) {
    return buildDemoArchive(request)
  }

  const params = new URLSearchParams({
    scope: request.scope,
    format: request.format,
  })
  const res = await fetch(
    `${API_BASE}/api/export/archive?${params.toString()}`,
    {
      credentials: 'include',
      headers: { Accept: '*/*' },
    }
  )
  if (!res.ok) {
    throw new ApiHttpError(res.status, res.statusText)
  }
  const fallback = fallbackArchiveFileName(
    request.format,
    new Date().toISOString()
  )
  return {
    blob: await res.blob(),
    fileName: parseFileName(res.headers.get('Content-Disposition'), fallback),
  }
}

/** 触发浏览器下载并释放临时对象 URL */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export type { ArchiveFormat }
