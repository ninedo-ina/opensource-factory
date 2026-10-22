import { describe, expect, it } from 'vitest'
import {
  OFFLINE_CACHE_VERSION,
  type OfflineMutation,
  type OfflineSnapshot,
} from '@/lib/offline-cache'
import { buildOfflineOverview } from './api'

const now = new Date('2026-10-22T12:00:00').getTime()

function snapshot(
  path: string,
  data: unknown,
  savedAt: number
): OfflineSnapshot {
  return {
    key: `of:v${OFFLINE_CACHE_VERSION}:u1:${path}`,
    userId: 'u1',
    path,
    data,
    savedAt,
    version: OFFLINE_CACHE_VERSION,
  }
}

function mutation(id: string, createdAt: number): OfflineMutation {
  return {
    id,
    userId: 'u1',
    path: `/api/trending/a/${id}/favorite`,
    method: 'POST',
    label: '收藏项目',
    createdAt,
  }
}

describe('buildOfflineOverview', () => {
  it('sorts datasets and mutations by time', () => {
    const view = buildOfflineOverview(
      [
        snapshot('/api/repos', [{ id: '1' }, { id: '2' }], now - 10 * 60_000),
        snapshot('/api/categories', { categories: [1, 2, 3] }, now - 1000),
      ],
      [mutation('old', now - 5000), mutation('new', now - 1000)],
      { usage: 2048, quota: 1024 * 1024 },
      now
    )

    expect(view.datasets.map((item) => item.label)).toEqual([
      '分类与标签',
      '我的仓库',
    ])
    expect(view.totalItems).toBe(5)
    expect(view.latestAt).toBe(now - 1000)
    expect(view.latestLabel).toBe('刚刚')
    expect(view.mutations.map((item) => item.id)).toEqual(['new', 'old'])
    expect(view.storageLabel).toBe('2.0 KB / 1.0 MB')
  })

  it('handles empty local data', () => {
    const view = buildOfflineOverview([], [], null, now)
    expect(view.datasets).toHaveLength(0)
    expect(view.mutations).toHaveLength(0)
    expect(view.latestLabel).toBe('尚未同步')
    expect(view.storageLabel).toBe('0 B')
  })
})
