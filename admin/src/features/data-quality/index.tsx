import { useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  EyeOff,
  Link2Off,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Wand2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import {
  fetchDataQuality,
  fixDataQuality,
  ignoreQualityIssues,
  restoreQualityIssues,
  scanDataQuality,
  type QualityIssue,
  type QualityScanResponse,
  type QualityView,
  type StatusFilter,
  type TypeFilter,
} from './api'
import {
  fieldLabel,
  filterIssues,
  formatTime,
  isFixable,
  issueTypeCounts,
  linkCheckLabel,
  modeLabel,
  scoreLabel,
  scoreTone,
  severityLabel,
  statusLabel,
  summaryText,
  typeLabel,
} from './utils'

const STATUS_TABS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'open', label: '待处理' },
  { value: 'ignored', label: '已忽略' },
  { value: 'fixed', label: '已修复' },
  { value: 'all', label: '全部' },
]

const TYPE_FILTERS: Array<{ value: TypeFilter; label: string }> = [
  { value: 'all', label: '全部类型' },
  { value: 'duplicate', label: '重复条目' },
  { value: 'broken_link', label: '失效链接' },
  { value: 'missing_metadata', label: '元数据缺失' },
  { value: 'stale_metadata', label: '元数据陈旧' },
]

function severityVariant(severity: QualityIssue['severity']) {
  if (severity === 'critical') return 'destructive' as const
  if (severity === 'warning') return 'secondary' as const
  return 'outline' as const
}

function issueIcon(issue: QualityIssue) {
  if (issue.type === 'broken_link') return <Link2Off className='size-4' />
  if (issue.type === 'duplicate') return <Copy className='size-4' />
  if (issue.type === 'stale_metadata') return <Clock className='size-4' />
  return <AlertTriangle className='size-4' />
}

export function DataQuality() {
  const [view, setView] = useState<QualityView | null>(null)
  const [status, setStatus] = useState<StatusFilter>('open')
  const [type, setType] = useState<TypeFilter>('all')
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [fixing, setFixing] = useState<string | null>(null)
  const [busyIssue, setBusyIssue] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const data = await fetchDataQuality({ status: 'all', limit: 200 })
      setView(data)
    } catch {
      setError('数据质量信息加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    fetchDataQuality({ status: 'all', limit: 200 })
      .then((data) => {
        if (active) setView(data)
      })
      .catch(() => {
        if (active) setError('数据质量信息加载失败，请稍后重试')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const visibleIssues = useMemo(
    () => (view ? filterIssues(view.issues, status, type) : []),
    [view, status, type]
  )

  async function runScan() {
    setScanning(true)
    setError('')
    setNotice('')
    try {
      const result: QualityScanResponse = await scanDataQuality({
        checkLinks: true,
        maxRepos: 200,
      })
      setView(result)
      setNotice(
        `扫描完成：${result.scanned} 个仓库，发现 ${result.summary.open} 个待处理问题（${modeLabel(result.mode)}，${linkCheckLabel(result.linkCheck)}）`
      )
    } catch {
      setError('扫描失败，请稍后重试')
    } finally {
      setScanning(false)
    }
  }

  async function fixIssue(issue: QualityIssue) {
    if (!isFixable(issue)) return
    setFixing(issue.id)
    setError('')
    setNotice('')
    try {
      const result = await fixDataQuality({
        repoIds: [issue.repoId],
        fields: issue.field ? [issue.field] : undefined,
      })
      setNotice(
        result.updated > 0
          ? `已补全 ${result.updated} 个仓库的元数据（${result.status === 'vps' ? 'GitHub 同步' : 'README 摘要降级'}）`
          : '没有可回填的字段，请稍后重试'
      )
      await load()
    } catch {
      setError('补全失败，请稍后重试')
    } finally {
      setFixing(null)
    }
  }

  async function fixAll() {
    setFixing('all')
    setError('')
    setNotice('')
    try {
      const result = await fixDataQuality({})
      setNotice(
        `补全任务完成：更新 ${result.updated} 个仓库，跳过 ${result.skipped} 个（${result.status === 'vps' ? 'GitHub 同步' : '本地降级'}）`
      )
      await load()
    } catch {
      setError('补全失败，请稍后重试')
    } finally {
      setFixing(null)
    }
  }

  async function toggleIgnore(issue: QualityIssue) {
    setBusyIssue(issue.id)
    setError('')
    try {
      if (issue.status === 'ignored') {
        await restoreQualityIssues([issue.id])
      } else {
        await ignoreQualityIssues([issue.id])
      }
      setView((prev) =>
        prev
          ? {
              ...prev,
              issues: prev.issues.map((item) =>
                item.id === issue.id
                  ? {
                      ...item,
                      status: issue.status === 'ignored' ? 'open' : 'ignored',
                      resolvedAt:
                        issue.status === 'ignored'
                          ? null
                          : new Date().toISOString(),
                    }
                  : item
              ),
            }
          : prev
      )
    } catch {
      setError('操作失败，请稍后重试')
    } finally {
      setBusyIssue(null)
    }
  }

  const summary = view?.summary
  const typeCounts = summary ? issueTypeCounts(summary.byType) : []
  const statusCount = (value: StatusFilter) =>
    view
      ? value === 'all'
        ? view.issues.length
        : view.issues.filter((issue) => issue.status === value).length
      : 0

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
        <div className='mb-6 space-y-1'>
          <h2 className='flex items-center gap-2 text-2xl font-bold tracking-tight'>
            <ShieldCheck className='size-6 text-emerald-500' />
            数据质量
          </h2>
          <p className='text-sm text-muted-foreground'>
            定期体检收藏库：识别重复条目、失效链接与缺失 / 陈旧元数据，
            支持一键补全与问题忽略。扫描只读，不会自动删除仓库。
          </p>
        </div>

        <div className='mb-6 flex flex-wrap items-center gap-2'>
          <Button type='button' onClick={() => void runScan()} disabled={scanning}>
            {scanning ? (
              <Loader2 className='me-1 size-4 animate-spin' />
            ) : (
              <RefreshCw className='me-1 size-4' />
            )}
            {view ? '重新扫描' : '开始扫描'}
          </Button>
          <Button
            type='button'
            variant='outline'
            onClick={() => void fixAll()}
            disabled={fixing !== null || !summary?.open}
          >
            {fixing === 'all' ? (
              <Loader2 className='me-1 size-4 animate-spin' />
            ) : (
              <Wand2 className='me-1 size-4' />
            )}
            全部补全元数据
          </Button>
          {summary?.lastScanAt && (
            <span className='text-xs text-muted-foreground'>
              最近扫描：{formatTime(summary.lastScanAt)}
            </span>
          )}
        </div>

        {notice && (
          <div className='mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'>
            {notice}
          </div>
        )}
        {error && <p className='mb-4 text-sm text-destructive'>{error}</p>}

        {loading ? (
          <Card>
            <CardContent className='flex items-center gap-2 py-10 text-sm text-muted-foreground'>
              <Loader2 className='size-4 animate-spin' />
              正在加载数据质量报告…
            </CardContent>
          </Card>
        ) : summary ? (
          <>
            <div className='mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
              <Card>
                <CardHeader className='pb-2'>
                  <CardDescription>质量分</CardDescription>
                  <CardTitle className={`text-4xl ${scoreTone(summary.score)}`}>
                    {summary.score}
                    <span className='ms-2 text-sm font-normal text-muted-foreground'>
                      / 100 · {scoreLabel(summary.score)}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className='h-2 overflow-hidden rounded-full bg-muted'>
                    <div
                      className='h-full rounded-full bg-current transition-all'
                      style={{ width: `${Math.max(0, Math.min(100, summary.score))}%` }}
                    />
                  </div>
                  <p className='mt-2 text-xs text-muted-foreground'>
                    扫描 {summary.scanned.toLocaleString()} 个仓库
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className='pb-2'>
                  <CardDescription>待处理问题</CardDescription>
                  <CardTitle className='text-4xl'>{summary.open}</CardTitle>
                </CardHeader>
                <CardContent className='text-xs text-muted-foreground'>
                  {summaryText(summary)}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className='pb-2'>
                  <CardDescription>严重 / 警告</CardDescription>
                  <CardTitle className='text-4xl'>
                    {summary.critical}
                    <span className='mx-1 text-muted-foreground'>/</span>
                    {summary.warning}
                  </CardTitle>
                </CardHeader>
                <CardContent className='text-xs text-muted-foreground'>
                  失效链接与重复条目优先处理
                </CardContent>
              </Card>
              <Card>
                <CardHeader className='pb-2'>
                  <CardDescription>已修复 / 已忽略</CardDescription>
                  <CardTitle className='text-4xl'>
                    {summary.fixed}
                    <span className='mx-1 text-muted-foreground'>/</span>
                    {summary.ignored}
                  </CardTitle>
                </CardHeader>
                <CardContent className='text-xs text-muted-foreground'>
                  问题台账按用户隔离、重复扫描幂等
                </CardContent>
              </Card>
            </div>

            <Card className='mb-6'>
              <CardHeader className='pb-3'>
                <CardTitle className='text-base'>问题分布</CardTitle>
                <CardDescription>
                  按类型统计当前待处理问题；点击类型可筛选下方台账。
                </CardDescription>
              </CardHeader>
              <CardContent className='flex flex-wrap gap-2'>
                {typeCounts.length === 0 && (
                  <span className='text-sm text-muted-foreground'>
                    当前没有待处理问题 🎉
                  </span>
                )}
                {typeCounts.map((item) => (
                  <Button
                    key={item.type}
                    type='button'
                    size='sm'
                    variant={type === item.type ? 'default' : 'outline'}
                    onClick={() =>
                      setType((prev) => (prev === item.type ? 'all' : item.type))
                    }
                  >
                    {typeLabel(item.type)}
                    <Badge variant='secondary' className='ms-2'>
                      {item.count}
                    </Badge>
                  </Button>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className='gap-3'>
                <div className='flex flex-wrap items-start justify-between gap-3'>
                  <div>
                    <CardTitle className='text-base'>问题台账</CardTitle>
                    <CardDescription>
                      {view.latestScan
                        ? `最近一次扫描 ${formatTime(view.latestScan.createdAt)} · ${modeLabel(view.latestScan.mode)}`
                        : '尚未执行扫描'}
                    </CardDescription>
                  </div>
                  <div className='flex flex-wrap gap-1'>
                    {STATUS_TABS.map((tab) => (
                      <Button
                        key={tab.value}
                        type='button'
                        size='sm'
                        variant={status === tab.value ? 'default' : 'ghost'}
                        onClick={() => setStatus(tab.value)}
                      >
                        {tab.label}
                        <span className='ms-1 text-xs opacity-70'>
                          {statusCount(tab.value)}
                        </span>
                      </Button>
                    ))}
                  </div>
                </div>
                <div className='flex flex-wrap gap-1'>
                  {TYPE_FILTERS.map((item) => (
                    <Button
                      key={item.value}
                      type='button'
                      size='sm'
                      variant={type === item.value ? 'secondary' : 'ghost'}
                      onClick={() => setType(item.value)}
                    >
                      {item.label}
                    </Button>
                  ))}
                </div>
              </CardHeader>
              <CardContent className='space-y-3'>
                {visibleIssues.length === 0 && (
                  <div className='rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground'>
                    当前筛选下没有待处理问题
                  </div>
                )}
                {visibleIssues.map((issue) => (
                  <div key={issue.id} className='rounded-lg border p-4'>
                    <div className='flex flex-wrap items-start justify-between gap-3'>
                      <div className='min-w-0 space-y-1'>
                        <div className='flex flex-wrap items-center gap-2'>
                          <span className='text-muted-foreground'>
                            {issueIcon(issue)}
                          </span>
                          <span className='font-medium'>{issue.title}</span>
                          <Badge variant={severityVariant(issue.severity)}>
                            {severityLabel(issue.severity)}
                          </Badge>
                          <Badge variant='outline'>{typeLabel(issue.type)}</Badge>
                          <Badge variant='outline'>{statusLabel(issue.status)}</Badge>
                          {issue.field && (
                            <Badge variant='secondary'>
                              {fieldLabel(issue.field)}
                            </Badge>
                          )}
                        </div>
                        <a
                          href={issue.repoUrl}
                          target='_blank'
                          rel='noreferrer'
                          className='inline-flex items-center gap-1 text-sm font-medium hover:underline'
                        >
                          {issue.repoName}
                          <ExternalLink className='size-3' />
                        </a>
                        <p className='text-sm text-muted-foreground'>{issue.detail}</p>
                        <p className='text-xs text-muted-foreground'>
                          建议：{issue.suggestion}
                        </p>
                      </div>
                      <div className='flex shrink-0 flex-wrap items-center gap-2'>
                        {isFixable(issue) && (
                          <Button
                            type='button'
                            size='sm'
                            variant='outline'
                            disabled={fixing !== null || busyIssue !== null}
                            onClick={() => void fixIssue(issue)}
                          >
                            {fixing === issue.id ? (
                              <Loader2 className='me-1 size-3 animate-spin' />
                            ) : (
                              <Wand2 className='me-1 size-3' />
                            )}
                            补全
                          </Button>
                        )}
                        {issue.type === 'duplicate' && (
                          <Button type='button' size='sm' variant='outline' asChild>
                            <Link to='/duplicates'>去重复检测</Link>
                          </Button>
                        )}
                        <Button
                          type='button'
                          size='sm'
                          variant='ghost'
                          disabled={busyIssue === issue.id}
                          onClick={() => void toggleIgnore(issue)}
                        >
                          {busyIssue === issue.id ? (
                            <Loader2 className='me-1 size-3 animate-spin' />
                          ) : issue.status === 'ignored' ? (
                            <RotateCcw className='me-1 size-3' />
                          ) : (
                            <EyeOff className='me-1 size-3' />
                          )}
                          {issue.status === 'ignored' ? '恢复' : '忽略'}
                        </Button>
                      </div>
                    </div>
                    <p className='mt-2 text-[11px] text-muted-foreground'>
                      检测于 {formatTime(issue.detectedAt)}
                      {issue.resolvedAt
                        ? ` · 关闭于 ${formatTime(issue.resolvedAt)}`
                        : ''}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>

            {view.history.length > 0 && (
              <Card className='mt-6'>
                <CardHeader>
                  <CardTitle className='text-base'>扫描历史</CardTitle>
                  <CardDescription>最近 10 次质量扫描记录</CardDescription>
                </CardHeader>
                <CardContent className='space-y-2'>
                  {view.history.map((item) => (
                    <div
                      key={item.id}
                      className='flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm'
                    >
                      <span className='flex items-center gap-2'>
                        <CheckCircle2 className='size-4 text-muted-foreground' />
                        {formatTime(item.createdAt)}
                      </span>
                      <span className='text-muted-foreground'>
                        {modeLabel(item.mode)} · 扫描 {item.scanned} 个 · 问题{' '}
                        {item.issueCount} 个
                      </span>
                      <Badge variant='outline'>质量分 {item.score}</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        ) : (
          <Card>
            <CardContent className='py-10 text-center text-sm text-muted-foreground'>
              暂无数据质量报告，点击「开始扫描」生成第一份体检结果。
            </CardContent>
          </Card>
        )}
      </Main>
    </>
  )
}
