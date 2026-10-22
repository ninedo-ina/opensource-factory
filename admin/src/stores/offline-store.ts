import { create } from 'zustand'

/**
 * 离线运行状态（仅内存）：
 * - `lastSyncAt`：最近一次成功写入快照的时间；
 * - `cacheUsedAt`：最近一次读取本地快照的时间（用于横幅提示）；
 * - `pendingMutations`：离线写队列待同步数量。
 */
interface OfflineState {
  lastSyncAt: number | null
  cacheUsedAt: number | null
  pendingMutations: number
  markSynced: (at: number) => void
  markCacheUsed: (at: number) => void
  setPendingMutations: (count: number) => void
  reset: () => void
}

export const useOfflineStore = create<OfflineState>()((set) => ({
  lastSyncAt: null,
  cacheUsedAt: null,
  pendingMutations: 0,
  markSynced: (at) => set({ lastSyncAt: at }),
  markCacheUsed: (at) => set({ cacheUsedAt: at }),
  setPendingMutations: (count) => set({ pendingMutations: count }),
  reset: () =>
    set({ lastSyncAt: null, cacheUsedAt: null, pendingMutations: 0 }),
}))
