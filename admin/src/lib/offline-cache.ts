/**
 * 离线数据缓存：纯函数与类型。
 *
 * 浏览器存储实现见 `offline-db.ts`，请求封装见 `offline-fetch.ts`。
 * 这里保持无副作用，便于在 Vitest（浏览器模式）中直接断言。
 */


export const OFFLINE_CACHE_VERSION = 1
export const OFFLINE_DB_NAME = 'of-offline'
export const OFFLINE_DB_VERSION = 1
export const SNAPSHOT_STORE = 'snapshots'
export const MUTATION_STORE = 'mutations'

/** 单条快照最大序列化体积（512 KB），避免大响应撑爆浏览器存储。 */
export const OFFLINE_SNAPSHOT_MAX_BYTES = 512 * 1024
/** 离线写队列上限。 */
export const OFFLINE_MUTATION_LIMIT = 100

export interface OfflineSnapshot<T = unknown> {
  key: string
  userId: string
  path: string
  data: T
  savedAt: number
  version: number
}

export type OfflineMutationMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface OfflineMutation {
  id: string
  userId: string
  path: string
  method: OfflineMutationMethod
  body?: string
  label: string
  createdAt: number
}

/** 只缓存这些只读接口；认证、内部接口与写接口一律不落本地。 */
const CACHEABLE_PATHS = [
  '/api/repos',
  '/api/categories',
  '/api/dashboard/stats',
  '/api/trending',
  '/api/recommendations',
]

/** 可离线排队的写操作白名单（收藏类、幂等）。 */
const QUEUEABLE_PATHS = [/^\/api\/trending\/[^/]+\/[^/]+\/favorite$/, /^\/api\/recommendations\/[^/]+\/save$/]

export function offlineUserId(userId?: string | null): string {
  const value = userId?.trim()
  return value ? value : 'anonymous'
}

export function snapshotKey(userId: string | null | undefined, path: string): string {
  return `of:v${OFFLINE_CACHE_VERSION}:${offlineUserId(userId)}:${path}`
}

export function isCacheablePath(path: string): boolean {
  const clean = path.split('?')[0] ?? ''
  if (clean.includes('/health/')) return false
  return CACHEABLE_PATHS.some(
    (prefix) => clean === prefix || clean.startsWith(`${prefix}/`)
  )
}

export function isQueueableMutation(path: string, method: string): boolean {
  const upper = method.toUpperCase()
  if (upper !== 'POST' && upper !== 'DELETE' && upper !== 'PUT' && upper !== 'PATCH') {
    return false
  }
  const clean = path.split('?')[0] ?? ''
  return QUEUEABLE_PATHS.some((pattern) => pattern.test(clean))
}

/**
 * 是否应该退回本地快照：
 * - 网络错误（fetch 抛 TypeError）；
 * - 服务端 5xx（网关 / Worker 暂时不可用）。
 * 401 / 403 / 4xx 属于会话或业务错误，不展示缓存，沿用原有兜底逻辑。
 */
export function shouldFallbackToCache(error: unknown): boolean {
  if (error instanceof TypeError) return true
  // 不直接依赖 ApiHttpError 类，避免纯函数模块与 API 客户端形成循环依赖；
  // 任何带数字 status 的错误按 HTTP 状态判断。
  const status =
    typeof error === 'object' && error !== null
      ? (error as { status?: unknown }).status
      : undefined
  return typeof status === 'number' && status >= 500 && status <= 599
}

/** 断网或网络错误时，写操作进入本地队列。 */
export function shouldQueueOffline(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  return error instanceof TypeError
}

export function mutationLabel(path: string, method: string): string {
  const upper = method.toUpperCase()
  if (path.includes('/favorite')) {
    return upper === 'DELETE' ? '取消收藏' : '收藏项目'
  }
  if (path.includes('/save')) return '收藏推荐'
  return '离线操作'
}

/** 快照对应的中文数据集名称。 */
export function snapshotLabel(path: string): string {
  const clean = path.split('?')[0] ?? ''
  if (clean === '/api/repos') return '我的仓库'
  if (clean === '/api/categories') return '分类与标签'
  if (clean === '/api/dashboard/stats') return '仪表盘统计'
  if (clean.startsWith('/api/trending/dates')) return '热榜日期'
  if (clean.startsWith('/api/trending/languages')) return '热榜语言'
  if (clean.startsWith('/api/trending/')) return '热榜详情'
  if (clean === '/api/trending') return '热榜列表'
  if (clean.startsWith('/api/recommendations/stats')) return '推荐统计'
  if (clean.startsWith('/api/recommendations')) return '推荐列表'
  return '本地数据'
}

/** 从响应体估算条目数，用于离线数据页展示。 */
export function snapshotItemCount(data: unknown): number | null {
  if (Array.isArray(data)) return data.length
  if (!data || typeof data !== 'object') return null
  const record = data as Record<string, unknown>
  let total = 0
  let found = false
  for (const key of ['items', 'categories', 'tags', 'recommendations', 'repos', 'dates']) {
    const value = record[key]
    if (Array.isArray(value)) {
      total += value.length
      found = true
    }
  }
  return found ? total : null
}

export interface SnapshotSummary {
  count: number
  totalItems: number
  latestAt: number | null
}

export function summarizeSnapshots(
  snapshots: Array<Pick<OfflineSnapshot, 'data' | 'savedAt'>>
): SnapshotSummary {
  let totalItems = 0
  let latestAt: number | null = null
  for (const snapshot of snapshots) {
    totalItems += snapshotItemCount(snapshot.data) ?? 0
    if (latestAt === null || snapshot.savedAt > latestAt) {
      latestAt = snapshot.savedAt
    }
  }
  return { count: snapshots.length, totalItems, latestAt }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 把同步时间格式化成「刚刚 / N 分钟前 / MM-DD HH:mm」。 */
export function formatSyncTime(savedAt: number | null, now = Date.now()): string {
  if (!savedAt) return '尚未同步'
  const diff = Math.max(0, now - savedAt)
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  const date = new Date(savedAt)
  const current = new Date(now)
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (date.getFullYear() === current.getFullYear()) {
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`
  }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** 序列化后的字节数（UTF-8 近似），用于快照体积上限判断。 */
export function serializedSize(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length
  } catch {
    return Number.POSITIVE_INFINITY
  }
}
