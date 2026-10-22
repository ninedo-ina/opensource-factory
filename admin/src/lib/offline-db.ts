/**
 * 离线数据存储（IndexedDB）。
 *
 * - `snapshots`：只读接口的最近一次成功响应，按用户 + 路径隔离；
 * - `mutations`：离线写队列，联网后按创建顺序回放。
 *
 * 浏览器不支持 IndexedDB（隐私模式 / 旧环境）时所有方法安全降级：
 * 读返回 null / 空数组，写返回 false，不抛出异常。
 */

import {
  MUTATION_STORE,
  OFFLINE_CACHE_VERSION,
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  OFFLINE_MUTATION_LIMIT,
  OFFLINE_SNAPSHOT_MAX_BYTES,
  SNAPSHOT_STORE,
  serializedSize,
  type OfflineMutation,
  type OfflineSnapshot,
} from './offline-cache'

let dbPromise: Promise<IDBDatabase | null> | null = null

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined'
}

export function openOfflineDb(): Promise<IDBDatabase | null> {
  if (!hasIndexedDb()) return Promise.resolve(null)
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
          const store = db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'key' })
          store.createIndex('userId', 'userId')
        }
        if (!db.objectStoreNames.contains(MUTATION_STORE)) {
          const store = db.createObjectStore(MUTATION_STORE, { keyPath: 'id' })
          store.createIndex('userId', 'userId')
          store.createIndex('createdAt', 'createdAt')
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })

  return dbPromise
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB error'))
  })
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>
): Promise<T | null> {
  const db = await openOfflineDb()
  if (!db) return null
  try {
    const transaction = db.transaction(storeName, mode)
    const store = transaction.objectStore(storeName)
    return await run(store)
  } catch {
    return null
  }
}

export async function readSnapshot<T>(
  key: string
): Promise<OfflineSnapshot<T> | null> {
  const record = await withStore(SNAPSHOT_STORE, 'readonly', (store) =>
    requestResult<OfflineSnapshot<T> | undefined>(store.get(key))
  )
  if (!record || record.version !== OFFLINE_CACHE_VERSION) return null
  return record
}

export async function writeSnapshot<T>(
  snapshot: OfflineSnapshot<T>
): Promise<boolean> {
  if (serializedSize(snapshot.data) > OFFLINE_SNAPSHOT_MAX_BYTES) return false
  const result = await withStore(SNAPSHOT_STORE, 'readwrite', async (store) => {
    await requestResult(store.put(snapshot))
    return true
  })
  return result === true
}

export async function listSnapshots(
  userId?: string | null
): Promise<OfflineSnapshot[]> {
  const records = await withStore(SNAPSHOT_STORE, 'readonly', (store) =>
    userId
      ? requestResult<OfflineSnapshot[]>(store.index('userId').getAll(userId))
      : requestResult<OfflineSnapshot[]>(store.getAll())
  )
  return (records ?? []).filter(
    (record) => record.version === OFFLINE_CACHE_VERSION
  )
}

export async function deleteSnapshot(key: string): Promise<void> {
  await withStore(SNAPSHOT_STORE, 'readwrite', async (store) => {
    await requestResult(store.delete(key))
    return true
  })
}

/** 清空本地数据；传 userId 时只清理该用户，避免共用设备串号。 */
export async function clearOfflineData(userId?: string | null): Promise<void> {
  if (!userId) {
    await withStore(SNAPSHOT_STORE, 'readwrite', async (store) => {
      await requestResult(store.clear())
      return true
    })
    await withStore(MUTATION_STORE, 'readwrite', async (store) => {
      await requestResult(store.clear())
      return true
    })
    return
  }

  await withStore(SNAPSHOT_STORE, 'readwrite', async (store) => {
    const keys = await requestResult<IDBValidKey[]>(
      store.index('userId').getAllKeys(userId)
    )
    await Promise.all(keys.map((key) => requestResult(store.delete(key))))
    return true
  })
  await withStore(MUTATION_STORE, 'readwrite', async (store) => {
    const keys = await requestResult<IDBValidKey[]>(
      store.index('userId').getAllKeys(userId)
    )
    await Promise.all(keys.map((key) => requestResult(store.delete(key))))
    return true
  })
}

export interface OfflineStorageEstimate {
  usage: number
  quota: number
}

export async function estimateOfflineStorage(): Promise<OfflineStorageEstimate | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
      return null
    }
    const estimate = await navigator.storage.estimate()
    return {
      usage: estimate.usage ?? 0,
      quota: estimate.quota ?? 0,
    }
  } catch {
    return null
  }
}

export async function enqueueMutation(
  mutation: OfflineMutation
): Promise<boolean> {
  const count = await countMutations(mutation.userId)
  if (count >= OFFLINE_MUTATION_LIMIT) return false
  const result = await withStore(MUTATION_STORE, 'readwrite', async (store) => {
    await requestResult(store.put(mutation))
    return true
  })
  return result === true
}

export async function listMutations(
  userId?: string | null
): Promise<OfflineMutation[]> {
  const records = await withStore(MUTATION_STORE, 'readonly', (store) =>
    userId
      ? requestResult<OfflineMutation[]>(store.index('userId').getAll(userId))
      : requestResult<OfflineMutation[]>(store.getAll())
  )
  return (records ?? []).sort((a, b) => a.createdAt - b.createdAt)
}

export async function deleteMutation(id: string): Promise<void> {
  await withStore(MUTATION_STORE, 'readwrite', async (store) => {
    await requestResult(store.delete(id))
    return true
  })
}

export async function countMutations(userId?: string | null): Promise<number> {
  const records = await listMutations(userId)
  return records.length
}
