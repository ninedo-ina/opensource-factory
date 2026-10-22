/**
 * 离线优先的只读请求：
 * 1. 在线：正常请求，成功后把响应写入 IndexedDB 快照；
 * 2. 断网 / 5xx：读取同一用户、同一路径的快照；
 * 3. 没有快照：回退到调用方提供的演示数据（保持原有行为）。
 *
 * 只缓存 `offline-cache.ts` 白名单内的 GET 接口；认证与写接口不经过这里。
 */

import { DEMO_MODE, apiFetch } from './api'
import {
  OFFLINE_CACHE_VERSION,
  isCacheablePath,
  shouldFallbackToCache,
  snapshotKey,
  type OfflineSnapshot,
} from './offline-cache'
import { readSnapshot, writeSnapshot } from './offline-db'
import { useAuthStore } from '@/stores/auth-store'
import { useOfflineStore } from '@/stores/offline-store'

export type OfflineDataSource = 'network' | 'cache' | 'fallback'

export interface OfflineFetchResult<T> {
  data: T
  source: OfflineDataSource
  savedAt: number | null
}

function currentUserId(): string | null {
  return useAuthStore.getState().auth.user?.id ?? null
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

export async function fetchWithOfflineResult<T>(
  path: string,
  fallback: T
): Promise<OfflineFetchResult<T>> {
  if (DEMO_MODE) {
    return { data: fallback, source: 'fallback', savedAt: null }
  }

  const userId = currentUserId()
  const cacheable = isCacheablePath(path)
  const key = snapshotKey(userId, path)

  if (isOffline()) {
    const cached = cacheable ? await readSnapshot<T>(key) : null
    if (cached) {
      useOfflineStore.getState().markCacheUsed(cached.savedAt)
      return { data: cached.data, source: 'cache', savedAt: cached.savedAt }
    }
    return { data: fallback, source: 'fallback', savedAt: null }
  }

  try {
    const data = await apiFetch<T>(path)
    if (cacheable) {
      const savedAt = Date.now()
      const snapshot: OfflineSnapshot<T> = {
        key,
        userId: userId ?? 'anonymous',
        path,
        data,
        savedAt,
        version: OFFLINE_CACHE_VERSION,
      }
      const stored = await writeSnapshot(snapshot)
      if (stored) useOfflineStore.getState().markSynced(savedAt)
    }
    return { data, source: 'network', savedAt: null }
  } catch (error) {
    if (!shouldFallbackToCache(error)) {
      // eslint-disable-next-line no-console
      console.info(`[opensource-factory] API 不可用，使用演示数据：${path}`)
      return { data: fallback, source: 'fallback', savedAt: null }
    }
    const cached = cacheable ? await readSnapshot<T>(key) : null
    if (cached) {
      useOfflineStore.getState().markCacheUsed(cached.savedAt)
      return { data: cached.data, source: 'cache', savedAt: cached.savedAt }
    }
    // eslint-disable-next-line no-console
    console.info(`[opensource-factory] 无本地快照，使用演示数据：${path}`)
    return { data: fallback, source: 'fallback', savedAt: null }
  }
}

/** 兼容原 `fetchWithFallback` 的返回类型。 */
export async function fetchWithOffline<T>(
  path: string,
  fallback: T
): Promise<T> {
  const result = await fetchWithOfflineResult(path, fallback)
  return result.data
}
