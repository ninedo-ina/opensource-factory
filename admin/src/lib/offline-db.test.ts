import { afterAll, describe, expect, it } from 'vitest'
import {
  OFFLINE_CACHE_VERSION,
  type OfflineMutation,
  type OfflineSnapshot,
} from './offline-cache'
import {
  clearOfflineData,
  countMutations,
  deleteMutation,
  deleteSnapshot,
  enqueueMutation,
  listMutations,
  listSnapshots,
  readSnapshot,
  writeSnapshot,
} from './offline-db'

const userId = `vitest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

function snapshot(
  path: string,
  data: unknown,
  savedAt = Date.now()
): OfflineSnapshot {
  return {
    key: `of:v${OFFLINE_CACHE_VERSION}:${userId}:${path}`,
    userId,
    path,
    data,
    savedAt,
    version: OFFLINE_CACHE_VERSION,
  }
}

function mutation(
  id: string,
  createdAt: number,
  label = '收藏项目'
): OfflineMutation {
  return {
    id,
    userId,
    path: `/api/trending/a/${id}/favorite`,
    method: 'POST',
    label,
    createdAt,
  }
}

afterAll(async () => {
  await clearOfflineData(userId)
})

describe('offline snapshots', () => {
  it('writes and reads a snapshot', async () => {
    const record = snapshot('/api/repos', [{ id: 'a' }, { id: 'b' }], 1000)
    expect(await writeSnapshot(record)).toBe(true)

    const cached = await readSnapshot<Array<{ id: string }>>(record.key)
    expect(cached?.data).toHaveLength(2)
    expect(cached?.savedAt).toBe(1000)
  })

  it('lists snapshots scoped by user', async () => {
    await writeSnapshot(snapshot('/api/categories', { categories: [] }, 2000))
    const records = await listSnapshots(userId)
    expect(records.length).toBeGreaterThanOrEqual(2)
    expect(records.every((item) => item.userId === userId)).toBe(true)
    expect(await listSnapshots('another-user')).toHaveLength(0)
  })

  it('rejects oversized payloads', async () => {
    const big = 'x'.repeat(600 * 1024)
    expect(await writeSnapshot(snapshot('/api/trending', big, 3000))).toBe(false)
  })

  it('deletes a snapshot', async () => {
    const record = snapshot('/api/dashboard/stats', { totalRepos: 1 }, 4000)
    await writeSnapshot(record)
    await deleteSnapshot(record.key)
    expect(await readSnapshot(record.key)).toBeNull()
  })
})

describe('offline mutation queue', () => {
  it('enqueues and lists by createdAt order', async () => {
    await enqueueMutation(mutation('b', 200))
    await enqueueMutation(mutation('a', 100))
    const queue = await listMutations(userId)
    expect(queue.map((item) => item.id)).toEqual(['a', 'b'])
    expect(await countMutations(userId)).toBe(2)
  })

  it('deletes a mutation', async () => {
    await deleteMutation('a')
    expect(await countMutations(userId)).toBe(1)
  })

  it('clears all data for the user', async () => {
    await clearOfflineData(userId)
    expect(await listSnapshots(userId)).toHaveLength(0)
    expect(await listMutations(userId)).toHaveLength(0)
  })
})
