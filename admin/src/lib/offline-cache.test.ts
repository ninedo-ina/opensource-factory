import { describe, expect, it } from 'vitest'
import { ApiHttpError } from './api'
import {
  OFFLINE_CACHE_VERSION,
  formatBytes,
  formatSyncTime,
  isCacheablePath,
  isQueueableMutation,
  mutationLabel,
  offlineUserId,
  serializedSize,
  shouldFallbackToCache,
  shouldQueueOffline,
  snapshotItemCount,
  snapshotKey,
  snapshotLabel,
  summarizeSnapshots,
} from './offline-cache'

describe('snapshotKey', () => {
  it('scopes by user and cache version', () => {
    expect(snapshotKey('u1', '/api/repos')).toBe(
      `of:v${OFFLINE_CACHE_VERSION}:u1:/api/repos`
    )
    expect(snapshotKey(null, '/api/repos')).toContain(':anonymous:')
  })

  it('falls back to anonymous for blank user ids', () => {
    expect(offlineUserId('  ')).toBe('anonymous')
    expect(offlineUserId('u1')).toBe('u1')
  })
})

describe('isCacheablePath', () => {
  it('allows core read endpoints', () => {
    expect(isCacheablePath('/api/repos')).toBe(true)
    expect(isCacheablePath('/api/repos?q=react')).toBe(true)
    expect(isCacheablePath('/api/categories')).toBe(true)
    expect(isCacheablePath('/api/dashboard/stats')).toBe(true)
    expect(isCacheablePath('/api/trending?limit=100')).toBe(true)
    expect(isCacheablePath('/api/recommendations?status=new')).toBe(true)
  })

  it('rejects auth, writes and unknown endpoints', () => {
    expect(isCacheablePath('/api/auth/me')).toBe(false)
    expect(isCacheablePath('/api/repos/health/refresh')).toBe(false)
    expect(isCacheablePath('/api/search/semantic')).toBe(false)
    expect(isCacheablePath('/api/monitoring/overview')).toBe(false)
  })
})

describe('isQueueableMutation', () => {
  it('allows favorite and save mutations', () => {
    expect(isQueueableMutation('/api/trending/a/b/favorite', 'POST')).toBe(true)
    expect(isQueueableMutation('/api/trending/a/b/favorite', 'DELETE')).toBe(
      true
    )
    expect(isQueueableMutation('/api/recommendations/1/save', 'POST')).toBe(
      true
    )
  })

  it('rejects other writes and GET', () => {
    expect(isQueueableMutation('/api/categories', 'POST')).toBe(false)
    expect(isQueueableMutation('/api/recommendations/1/dismiss', 'POST')).toBe(
      false
    )
    expect(isQueueableMutation('/api/trending/a/b/favorite', 'GET')).toBe(false)
  })
})

describe('shouldFallbackToCache', () => {
  it('accepts network errors and 5xx', () => {
    expect(shouldFallbackToCache(new TypeError('Failed to fetch'))).toBe(true)
    expect(shouldFallbackToCache(new ApiHttpError(503, 'Service Unavailable'))).toBe(
      true
    )
  })

  it('rejects auth and business errors', () => {
    expect(shouldFallbackToCache(new ApiHttpError(401, 'Unauthorized'))).toBe(
      false
    )
    expect(shouldFallbackToCache(new ApiHttpError(404, 'Not Found'))).toBe(false)
    expect(shouldFallbackToCache(new Error('boom'))).toBe(false)
  })
})

describe('shouldQueueOffline', () => {
  it('queues network errors', () => {
    expect(shouldQueueOffline(new TypeError('Failed to fetch'))).toBe(true)
  })

  it('does not queue HTTP business errors', () => {
    expect(shouldQueueOffline(new ApiHttpError(409, 'Conflict'))).toBe(false)
  })
})

describe('mutationLabel', () => {
  it('describes favorite actions', () => {
    expect(mutationLabel('/api/trending/a/b/favorite', 'POST')).toBe('收藏项目')
    expect(mutationLabel('/api/trending/a/b/favorite', 'DELETE')).toBe(
      '取消收藏'
    )
    expect(mutationLabel('/api/recommendations/1/save', 'POST')).toBe(
      '收藏推荐'
    )
  })
})

describe('snapshotLabel', () => {
  it('maps known paths to dataset names', () => {
    expect(snapshotLabel('/api/repos')).toBe('我的仓库')
    expect(snapshotLabel('/api/categories')).toBe('分类与标签')
    expect(snapshotLabel('/api/trending?limit=100')).toBe('热榜列表')
    expect(snapshotLabel('/api/trending/dates')).toBe('热榜日期')
    expect(snapshotLabel('/api/recommendations/stats')).toBe('推荐统计')
    expect(snapshotLabel('/api/unknown')).toBe('本地数据')
  })
})

describe('snapshotItemCount / summarizeSnapshots', () => {
  it('counts arrays and wrapped payloads', () => {
    expect(snapshotItemCount([1, 2, 3])).toBe(3)
    expect(snapshotItemCount({ categories: [1, 2], tags: [1] })).toBe(3)
    expect(snapshotItemCount({ totalRepos: 10 })).toBeNull()
  })

  it('summarizes count, items and latest time', () => {
    const summary = summarizeSnapshots([
      { data: [1, 2], savedAt: 100 },
      { data: { items: [1, 2, 3] }, savedAt: 300 },
    ])
    expect(summary).toEqual({ count: 2, totalItems: 5, latestAt: 300 })
  })
})

describe('formatSyncTime', () => {
  const now = new Date('2026-10-22T12:00:00').getTime()

  it('formats recent times', () => {
    expect(formatSyncTime(null, now)).toBe('尚未同步')
    expect(formatSyncTime(now - 10_000, now)).toBe('刚刚')
    expect(formatSyncTime(now - 5 * 60_000, now)).toBe('5 分钟前')
    expect(formatSyncTime(now - 3 * 3_600_000, now)).toBe('3 小时前')
  })

  it('formats older dates', () => {
    expect(formatSyncTime(new Date('2026-10-20T08:05:00').getTime(), now)).toBe(
      '10-20 08:05'
    )
    expect(formatSyncTime(new Date('2025-12-31T23:59:00').getTime(), now)).toBe(
      '2025-12-31 23:59'
    )
  })
})

describe('formatBytes / serializedSize', () => {
  it('formats byte sizes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })

  it('measures UTF-8 JSON size', () => {
    expect(serializedSize({ a: 1 })).toBe(7)
    expect(serializedSize('中文')).toBeGreaterThan(2)
  })
})
