import { useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CloudOff,
  Database,
  HardDriveDownload,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ConfigDrawer } from '@/components/config-drawer'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import {
  clearLocalOfflineData,
  loadOfflineOverview,
  syncOfflineMutations,
} from './api'

function StatCard({
  title,
  icon,
  value,
  hint,
}: {
  title: string
  icon: ReactNode
  value: string
  hint: string
}) {
  return (
    <Card>
      <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
        <CardTitle className='text-sm font-medium'>{title}</CardTitle>
        <span className='text-muted-foreground' aria-hidden='true'>
          {icon}
        </span>
      </CardHeader>
      <CardContent>
        <div className='text-2xl font-bold'>{value}</div>
        <p className='mt-1 text-xs text-muted-foreground'>{hint}</p>
      </CardContent>
    </Card>
  )
}

export function OfflineData() {
  const queryClient = useQueryClient()
  const [syncing, setSyncing] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const { data, isFetching, refetch } = useQuery({
    queryKey: ['offline-overview'],
    queryFn: loadOfflineOverview,
  })

  const overview = data

  async function handleSync() {
    setSyncing(true)
    try {
      const result = await syncOfflineMutations()
      if (result.synced > 0) {
        toast.success(`已同步 ${result.synced} 项离线操作`)
      } else if (result.failed > 0) {
        toast.error(`${result.failed} 项操作同步失败，已从队列移除`)
      } else {
        toast('没有待同步的离线操作')
      }
      await queryClient.invalidateQueries()
      await refetch()
    } finally {
      setSyncing(false)
    }
  }

  async function handleClear() {
    setClearing(true)
    try {
      await clearLocalOfflineData()
      queryClient.clear()
      await refetch()
      toast.success('本地缓存与离线队列已清理')
    } finally {
      setClearing(false)
      setConfirmClear(false)
    }
  }

  return (
    <>
      <Header>
        <h1 className='me-auto text-lg font-semibold'>开源项目工厂</h1>
        <Search />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>

      <Main>
        <div className='mb-4 flex flex-wrap items-end justify-between gap-3'>
          <div>
            <h2 className='flex items-center gap-2 text-2xl font-bold tracking-tight'>
              <HardDriveDownload className='size-6 text-sky-500' />
              离线数据
            </h2>
            <p className='text-sm text-muted-foreground'>
              断网时使用本地快照查看收藏、分类、热榜与推荐；收藏操作会在联网后自动同步。
            </p>
          </div>
          <div className='flex gap-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              <RefreshCw
                className={isFetching ? 'size-4 animate-spin' : 'size-4'}
              />
              刷新
            </Button>
            <Button
              size='sm'
              onClick={() => void handleSync()}
              disabled={syncing || (overview?.mutations.length ?? 0) === 0}
            >
              <CloudOff className='size-4' />
              {syncing ? '同步中…' : '立即同步'}
            </Button>
            <Button
              variant='destructive'
              size='sm'
              onClick={() => setConfirmClear(true)}
              disabled={clearing}
            >
              <Trash2 className='size-4' />
              清理本地数据
            </Button>
          </div>
        </div>

        <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
          <StatCard
            title='缓存数据集'
            icon={<Database className='size-4' />}
            value={String(overview?.datasets.length ?? 0)}
            hint='仓库 / 分类 / 热榜 / 推荐'
          />
          <StatCard
            title='本地条目'
            icon={<HardDriveDownload className='size-4' />}
            value={String(overview?.totalItems ?? 0)}
            hint='按响应体估算'
          />
          <StatCard
            title='最近同步'
            icon={<RefreshCw className='size-4' />}
            value={overview?.latestLabel ?? '尚未同步'}
            hint='成功写入快照的时间'
          />
          <StatCard
            title='待同步操作'
            icon={<CloudOff className='size-4' />}
            value={String(overview?.mutations.length ?? 0)}
            hint='离线收藏 / 取消收藏'
          />
        </div>

        <Card className='mt-4'>
          <CardHeader className='flex flex-row items-center justify-between space-y-0'>
            <div>
              <CardTitle>本地缓存</CardTitle>
              <CardDescription>
                仅缓存白名单内的只读接口；退出登录会清理当前用户数据。
              </CardDescription>
            </div>
            <Badge variant='outline'>{overview?.storageLabel ?? '0 B'}</Badge>
          </CardHeader>
          <CardContent>
            {overview && overview.datasets.length > 0 ? (
              <div className='overflow-x-auto'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>数据集</TableHead>
                      <TableHead>接口</TableHead>
                      <TableHead className='text-right'>条目</TableHead>
                      <TableHead className='text-right'>同步时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.datasets.map((dataset) => (
                      <TableRow key={dataset.key}>
                        <TableCell className='font-medium'>
                          {dataset.label}
                        </TableCell>
                        <TableCell className='max-w-[320px] truncate text-xs text-muted-foreground'>
                          {dataset.path}
                        </TableCell>
                        <TableCell className='text-right'>
                          {dataset.itemCount ?? '—'}
                        </TableCell>
                        <TableCell className='text-right text-muted-foreground'>
                          {dataset.savedAtLabel}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className='py-8 text-center text-sm text-muted-foreground'>
                尚未缓存任何数据。联网后访问「我的仓库」「分类」「热榜」「推荐」等页面，
                会自动写入本地快照。
              </p>
            )}
          </CardContent>
        </Card>

        <Card className='mt-4'>
          <CardHeader>
            <CardTitle>离线操作队列</CardTitle>
            <CardDescription>
              断网时的收藏 / 取消收藏会暂存在本地，恢复联网后按顺序回放；业务失败会自动丢弃。
            </CardDescription>
          </CardHeader>
          <CardContent>
            {overview && overview.mutations.length > 0 ? (
              <div className='space-y-2'>
                {overview.mutations.map((mutation) => (
                  <div
                    key={mutation.id}
                    className='flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm'
                  >
                    <div className='min-w-0'>
                      <p className='font-medium'>{mutation.label}</p>
                      <p className='truncate text-xs text-muted-foreground'>
                        {mutation.method} {mutation.path}
                      </p>
                    </div>
                    <span className='text-xs text-muted-foreground'>
                      {mutation.createdAtLabel}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className='py-6 text-center text-sm text-muted-foreground'>
                队列为空，所有操作均已同步。
              </p>
            )}
          </CardContent>
        </Card>

        <Card className='mt-4'>
          <CardHeader>
            <CardTitle>离线能力说明</CardTitle>
          </CardHeader>
          <CardContent className='grid gap-3 text-sm text-muted-foreground sm:grid-cols-2'>
            <p>
              · 已缓存：我的仓库、分类与标签、仪表盘统计、热榜列表 / 日期 / 语言、推荐列表与统计。
            </p>
            <p>· 不缓存：登录会话、认证接口、写接口与内部令牌接口。</p>
            <p>· 离线可写：热榜收藏 / 取消收藏、推荐收藏；其他管理操作需要联网。</p>
            <p>· 数据隔离：快照按用户保存，退出登录或点击「清理本地数据」即删除。</p>
          </CardContent>
        </Card>
      </Main>

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title='清理本地数据'
        desc='将删除当前用户在本机缓存的所有快照与离线操作队列，且不可恢复。确定继续吗？'
        cancelBtnText='取消'
        confirmText='清理'
        destructive
        handleConfirm={() => void handleClear()}
        className='sm:max-w-sm'
      />
    </>
  )
}
