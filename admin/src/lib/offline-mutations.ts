/**
 * 离线写队列：断网时把幂等的收藏类操作暂存在 IndexedDB，
 * 恢复联网后按创建顺序回放。
 */

import { apiFetch } from './api'
import {
  mutationLabel,
  type OfflineMutation,
  type OfflineMutationMethod,
} from './offline-cache'
import {
  countMutations,
  deleteMutation,
  enqueueMutation,
  listMutations,
} from './offline-db'
import { useAuthStore } from '@/stores/auth-store'
import { useOfflineStore } from '@/stores/offline-store'

export const OFFLINE_MUTATIONS_SYNCED_EVENT = 'of:offline-mutations-synced'

export interface FlushMutationsResult {
  synced: number
  failed: number
  remaining: number
}

let flushing: Promise<FlushMutationsResult> | null = null
let initialized = false

function currentUserId(): string | null {
  return useAuthStore.getState().auth.user?.id ?? null
}

export async function refreshPendingMutationCount(): Promise<number> {
  const count = await countMutations(currentUserId())
  useOfflineStore.getState().setPendingMutations(count)
  return count
}

/** 写入队列；超过上限或 IndexedDB 不可用时返回 false。 */
export async function queueOfflineMutation(
  path: string,
  method: OfflineMutationMethod,
  options: { body?: string; label?: string } = {}
): Promise<boolean> {
  const mutation: OfflineMutation = {
    id: `mut_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId: currentUserId() ?? 'anonymous',
    path,
    method,
    body: options.body,
    label: options.label ?? mutationLabel(path, method),
    createdAt: Date.now(),
  }
  const queued = await enqueueMutation(mutation)
  await refreshPendingMutationCount()
  return queued
}

export async function flushOfflineMutations(): Promise<FlushMutationsResult> {
  if (flushing) return flushing
  flushing = runFlush().finally(() => {
    flushing = null
  })
  return flushing
}

async function runFlush(): Promise<FlushMutationsResult> {
  const userId = currentUserId()
  const queue = await listMutations(userId)
  let synced = 0
  let failed = 0

  for (const mutation of queue) {
    try {
      await apiFetch(mutation.path, {
        method: mutation.method,
        ...(mutation.body
          ? {
              headers: { 'Content-Type': 'application/json' },
              body: mutation.body,
            }
          : {}),
      })
      await deleteMutation(mutation.id)
      synced += 1
    } catch (error) {
      const status =
        typeof error === 'object' && error !== null
          ? (error as { status?: unknown }).status
          : undefined
      if (typeof status === 'number' && status >= 400 && status < 500) {
        // 业务失败（如仓库已被删除）不重试，丢弃并计数。
        await deleteMutation(mutation.id)
        failed += 1
        continue
      }
      // 网络错误 / 5xx：保留队列，等待下次联网。
      break
    }
  }

  const remaining = await countMutations(userId)
  useOfflineStore.getState().setPendingMutations(remaining)
  return { synced, failed, remaining }
}

/**
 * 应用启动时调用：刷新待同步数量，并在联网时自动回放。
 * 重复调用无副作用。
 */
export function initOfflineMutationSync(): void {
  if (initialized || typeof window === 'undefined') return
  initialized = true

  void refreshPendingMutationCount()
  if (navigator.onLine !== false) {
    void flushOfflineMutations().then((result) => {
      if (result.synced > 0) {
        window.dispatchEvent(
          new CustomEvent<FlushMutationsResult>(OFFLINE_MUTATIONS_SYNCED_EVENT, {
            detail: result,
          })
        )
      }
    })
  }

  window.addEventListener('online', () => {
    void flushOfflineMutations().then((result) => {
      if (result.synced > 0 || result.failed > 0) {
        window.dispatchEvent(
          new CustomEvent<FlushMutationsResult>(OFFLINE_MUTATIONS_SYNCED_EVENT, {
            detail: result,
          })
        )
      }
    })
  })
}
