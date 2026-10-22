import { useNavigate, useLocation } from '@tanstack/react-router'
import { logout } from '@/lib/api'
import { clearOfflineData } from '@/lib/offline-db'
import { clearServiceWorkerCaches } from '@/lib/service-worker'
import { clearOfflineUser } from '@/lib/offline-user'
import { useAuthStore } from '@/stores/auth-store'
import { useOfflineStore } from '@/stores/offline-store'
import { ConfirmDialog } from '@/components/confirm-dialog'

interface SignOutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SignOutDialog({ open, onOpenChange }: SignOutDialogProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { auth } = useAuthStore()

  const handleSignOut = () => {
    // 清理本地缓存与离线队列，避免共用设备串号。
    void clearOfflineData(auth.user?.id)
    clearOfflineUser()
    useOfflineStore.getState().reset()
    clearServiceWorkerCaches()
    void logout() // 通知边缘服务清除会话（失败不影响本地退出）
    auth.reset()
    // 记录当前位置，登录后可跳回
    const currentPath = location.href
    navigate({
      to: '/sign-in',
      search: { redirect: currentPath },
      replace: true,
    })
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title='退出登录'
      desc='确定要退出当前账号吗？退出后需要重新使用 GitHub 登录。'
      cancelBtnText='取消'
      confirmText='退出登录'
      destructive
      handleConfirm={handleSignOut}
      className='sm:max-w-sm'
    />
  )
}
