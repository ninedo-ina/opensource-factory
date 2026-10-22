/**
 * 离线数据页的数据访问与视图模型。
 *
 * 读取 IndexedDB 快照 / 队列，纯函数 `buildOfflineOverview` 负责汇总，
 * 便于在 Vitest 中稳定断言。
 */

import {
  formatBytes,
  formatSyncTime,
  snapshotItemCount,
  snapshotLabel,
  type OfflineMutation,
  type OfflineSnapshot,
} from '@/lib/offline-cache'
import {
  clearOfflineData,
  countMutations,
  estimateOfflineStorage,
  listMutations,
  listSnapshots,
  type OfflineStorageEstimate,
} from '@/lib/offline-db'
import {
  flushOfflineMutations,
  refreshPendingMutationCount,
  type FlushMutationsResult,
} from '@/lib/offline-mutations'
import { clearServiceWorkerCaches } from '@/lib/service-worker'
import { useAuthStore } from '@/stores/auth-store'
import { useOfflineStore } from '@/stores/offline-store'

export interface OfflineDatasetView {
  key: string
  path: string
  label: string
  itemCount: number | null
  savedAt: number
  savedAtLabel: string
}

export interface OfflineMutationView {
  id: string
  label: string
  method: string
  path: string
  createdAt: number
  createdAtLabel: string
}

export interface OfflineOverviewView {
  datasets: OfflineDatasetView[]
  mutations: OfflineMutationView[]
  totalItems: number
  latestAt: number | null
  latestLabel: string
  storageUsage: number
  storageQuota: number
  storageLabel: string
}

export function buildOfflineOverview(
  snapshots: OfflineSnapshot[],
  mutations: OfflineMutation[],
  storage: OfflineStorageEstimate | null,
  now = Date.now()
): OfflineOverviewView {
  const datasets = [...snapshots]
    .sort((a, b) => b.savedAt - a.savedAt)
    .map((snapshot) => ({
      key: snapshot.key,
      path: snapshot.path,
      label: snapshotLabel(snapshot.path),
      itemCount: snapshotItemCount(snapshot.data),
      savedAt: snapshot.savedAt,
      savedAtLabel: formatSyncTime(snapshot.savedAt, now),
    }))

  const mutationViews = [...mutations]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((mutation) => ({
      id: mutation.id,
      label: mutation.label,
      method: mutation.method,
      path: mutation.path,
      createdAt: mutation.createdAt,
      createdAtLabel: formatSyncTime(mutation.createdAt, now),
    }))

  const totalItems = datasets.reduce(
    (sum, dataset) => sum + (dataset.itemCount ?? 0),
    0
  )
  const latestAt = datasets[0]?.savedAt ?? null
  const usage = storage?.usage ?? 0
  const quota = storage?.quota ?? 0

  return {
    datasets,
    mutations: mutationViews,
    totalItems,
    latestAt,
    latestLabel: formatSyncTime(latestAt, now),
    storageUsage: usage,
    storageQuota: quota,
    storageLabel:
      quota > 0
        ? `${formatBytes(usage)} / ${formatBytes(quota)}`
        : formatBytes(usage),
  }
}

export async function loadOfflineOverview(): Promise<OfflineOverviewView> {
  const userId = useAuthStore.getState().auth.user?.id ?? null
  const [snapshots, mutations, storage] = await Promise.all([
    listSnapshots(userId),
    listMutations(userId),
    estimateOfflineStorage(),
  ])
  useOfflineStore.getState().setPendingMutations(mutations.length)
  return buildOfflineOverview(snapshots, mutations, storage)
}

export async function syncOfflineMutations(): Promise<FlushMutationsResult> {
  const result = await flushOfflineMutations()
  return result
}

export async function clearLocalOfflineData(): Promise<void> {
  const userId = useAuthStore.getState().auth.user?.id ?? null
  await clearOfflineData(userId)
  await refreshPendingMutationCount()
  useOfflineStore.getState().reset()
  clearServiceWorkerCaches()
}

export async function pendingMutationCount(): Promise<number> {
  const userId = useAuthStore.getState().auth.user?.id ?? null
  return countMutations(userId)
}
