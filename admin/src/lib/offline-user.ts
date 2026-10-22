/**
 * 断网会话恢复：只保存最小用户信息（id / login / 名称 / 头像），
 * 不含任何令牌。在线会话仍由边缘服务的 httpOnly Cookie 维护。
 */

import type { AuthUser } from './api'

const OFFLINE_USER_KEY = 'of.offline.user'

interface OfflineUserRecord {
  user: AuthUser
  savedAt: number
}

export function saveOfflineUser(
  user: AuthUser,
  storage: Pick<Storage, 'setItem'> | null = safeStorage()
): void {
  if (!storage) return
  try {
    const record: OfflineUserRecord = { user, savedAt: Date.now() }
    storage.setItem(OFFLINE_USER_KEY, JSON.stringify(record))
  } catch {
    // 隐私模式 / 存储已满：忽略，不影响在线流程。
  }
}

export function readOfflineUser(
  storage: Pick<Storage, 'getItem'> | null = safeStorage()
): AuthUser | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(OFFLINE_USER_KEY)
    if (!raw) return null
    const record = JSON.parse(raw) as Partial<OfflineUserRecord>
    if (!record.user || typeof record.user.id !== 'string') return null
    return record.user
  } catch {
    return null
  }
}

export function clearOfflineUser(
  storage: Pick<Storage, 'removeItem'> | null = safeStorage()
): void {
  if (!storage) return
  try {
    storage.removeItem(OFFLINE_USER_KEY)
  } catch {
    // 忽略。
  }
}

function safeStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    return null
  }
}
