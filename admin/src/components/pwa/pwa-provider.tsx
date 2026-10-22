import { useEffect, useState, type ReactNode } from 'react'
import { Download, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  PWA_UPDATE_EVENT,
  isIosDevice,
  isStandaloneApp,
  markInstallDismissed,
  readInstallDismissedAt,
  shouldShowInstallPrompt,
  type BeforeInstallPromptEvent,
} from '@/lib/pwa'
import { Button } from '@/components/ui/button'
import { formatSyncTime, summarizeSnapshots } from '@/lib/offline-cache'
import { listSnapshots } from '@/lib/offline-db'
import {
  OFFLINE_MUTATIONS_SYNCED_EVENT,
  flushOfflineMutations,
  initOfflineMutationSync,
  type FlushMutationsResult,
} from '@/lib/offline-mutations'
import { useOfflineStore } from '@/stores/offline-store'

function getStandalone(): boolean {
  return isStandaloneApp({
    displayModeStandalone:
      window.matchMedia?.('(display-mode: standalone)').matches ?? false,
    navigatorStandalone: (navigator as Navigator & { standalone?: boolean })
      .standalone,
  })
}

function readDismissedAt(): number | null {
  try {
    return readInstallDismissedAt(window.localStorage)
  } catch {
    return null
  }
}

function persistDismissedAt(now: number): void {
  try {
    markInstallDismissed(window.localStorage, now)
  } catch {
    // 隐私模式下 localStorage 可能不可写，忽略即可。
  }
}

/**
 * PWA 运行时体验：离线提示、安装引导、新版本刷新提示。
 *
 * Service Worker 本身在 `main.tsx` 中注册；本组件只负责界面与事件。
 */
export function PwaProvider({ children }: { children: ReactNode }) {
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null)
  const [standalone, setStandalone] = useState(getStandalone)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [dismissedAt, setDismissedAt] = useState<number | null>(readDismissedAt)
  const lastSyncAt = useOfflineStore((state) => state.lastSyncAt)
  const cacheUsedAt = useOfflineStore((state) => state.cacheUsedAt)
  const pendingMutations = useOfflineStore((state) => state.pendingMutations)

  const ios = isIosDevice(navigator.userAgent, navigator.maxTouchPoints)

  useEffect(() => {
    initOfflineMutationSync()
    void listSnapshots().then((snapshots) => {
      const latest = summarizeSnapshots(snapshots).latestAt
      if (latest) useOfflineStore.getState().markSynced(latest)
    })
  }, [])

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault()
      setInstallEvent(event as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setInstallEvent(null)
      setStandalone(true)
    }
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    const onMutationsSynced = (event: Event) => {
      const result = (event as CustomEvent<FlushMutationsResult>).detail
      if (!result) return
      if (result.synced > 0) {
        toast.success(`已同步 ${result.synced} 项离线操作`, {
          description:
            result.remaining > 0
              ? `还有 ${result.remaining} 项等待同步。`
              : '本地数据已与服务器对齐。',
        })
      } else if (result.failed > 0) {
        toast.error(`${result.failed} 项离线操作同步失败`, {
          description: '可能是项目已删除或没有权限，已从队列移除。',
        })
      }
    }
    const onUpdate = () => {
      toast('新版本已就绪', {
        description: '刷新页面后即可使用最新版本。',
        duration: Infinity,
        action: {
          label: '立即刷新',
          onClick: () => window.location.reload(),
        },
      })
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener(PWA_UPDATE_EVENT, onUpdate)
    window.addEventListener(OFFLINE_MUTATIONS_SYNCED_EVENT, onMutationsSynced)

    const media = window.matchMedia?.('(display-mode: standalone)')
    const onDisplayModeChange = () => setStandalone(getStandalone())
    media?.addEventListener('change', onDisplayModeChange)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener(PWA_UPDATE_EVENT, onUpdate)
      window.removeEventListener(OFFLINE_MUTATIONS_SYNCED_EVENT, onMutationsSynced)
      media?.removeEventListener('change', onDisplayModeChange)
    }
  }, [])

  const dismissInstall = () => {
    const now = Date.now()
    persistDismissedAt(now)
    setDismissedAt(now)
  }

  const handleInstall = async () => {
    if (!installEvent) return
    await installEvent.prompt()
    const choice = await installEvent.userChoice
    setInstallEvent(null)
    if (choice.outcome === 'accepted') {
      setStandalone(true)
    } else {
      dismissInstall()
    }
  }

  const showInstall =
    shouldShowInstallPrompt({ standalone, dismissedAt }) &&
    (installEvent !== null || ios)

  return (
    <>
      {children}

      {!online && (
        <div
          role='status'
          aria-live='polite'
          className='fixed inset-x-0 top-0 z-[70] bg-amber-500 px-4 py-1.5 text-center text-xs font-medium text-white shadow-sm'
        >
          当前离线 · 显示本地数据（{formatSyncTime(lastSyncAt ?? cacheUsedAt)}）
          {pendingMutations > 0 ? ` · ${pendingMutations} 项待同步` : ''}
          <button
            type='button'
            className='ml-2 underline underline-offset-2'
            onClick={() => {
              void flushOfflineMutations()
            }}
          >
            重试同步
          </button>
        </div>
      )}

      {showInstall && (
        <aside
          aria-label='安装开源项目工厂'
          data-testid='pwa-install-prompt'
          className='fixed inset-x-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-50 rounded-xl border bg-card p-4 text-card-foreground shadow-lg md:inset-x-auto md:right-6 md:bottom-6 md:w-80'
        >
          <div className='flex items-start gap-3'>
            <img
              src='/icons/icon-192.png'
              alt=''
              width={40}
              height={40}
              className='size-10 shrink-0 rounded-lg'
            />
            <div className='min-w-0 flex-1'>
              <p className='text-sm font-semibold'>安装开源项目工厂</p>
              <p className='mt-1 text-xs leading-5 text-muted-foreground'>
                {ios
                  ? '在 Safari 中点「分享」→「添加到主屏幕」，即可像应用一样打开。'
                  : '添加到主屏幕，像原生应用一样快速打开，并支持基础离线访问。'}
              </p>
            </div>
            <Button
              variant='ghost'
              size='icon'
              className='-me-2 -mt-2 size-8 shrink-0'
              aria-label='关闭安装提示'
              onClick={dismissInstall}
            >
              <X className='size-4' />
            </Button>
          </div>

          <div className='mt-3 flex justify-end gap-2'>
            {installEvent && !ios ? (
              <>
                <Button variant='ghost' size='sm' onClick={dismissInstall}>
                  以后再说
                </Button>
                <Button size='sm' onClick={handleInstall}>
                  <Download className='size-4' />
                  安装到桌面
                </Button>
              </>
            ) : (
              <Button variant='secondary' size='sm' onClick={dismissInstall}>
                知道了
              </Button>
            )}
          </div>
        </aside>
      )}
    </>
  )
}
