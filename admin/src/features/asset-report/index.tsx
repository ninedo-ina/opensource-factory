import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Download,
  ExternalLink,
  FolderGit2,
  Gauge,
  Layers,
  Lightbulb,
  Percent,
  RefreshCw,
  Star,
  TrendingUp,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { cn } from '@/lib/utils'
import { fetchAssetReport, type AssetInsightKind, type AssetReportResponse } from './api'
import { StarChart } from './components/star-chart'
import { VolumeChart } from './components/volume-chart'
import {
  buildAssetCsv,
  downloadTextFile,
  formatCompactNumber,
  formatGrowthRate,
  formatNumber,
  formatPercent,
  formatSignedNumber,
  monthLabel,
  normalizeMonths,
} from './utils'

const MONTH_OPTIONS = [6, 12, 24] as const

const INSIGHT_ICONS: Record<AssetInsightKind, ReactNode> = {
  volume: <FolderGit2 className='h-4 w-4' />,
  growth: <TrendingUp className='h-4 w-4' />,
  category: <Layers className='h-4 w-4' />,
  uncategorized: <Percent className='h-4 w-4' />,
  star: <Star className='h-4 w-4' />,
  coverage: <Gauge className='h-4 w-4' />,
}

const TREND_LABEL: Record<string, string> = {
  new: '新上榜',
  up: '上升',
  down: '回落',
  steady: '平稳',
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', { hour12: false })
}

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
        <div className='text-2xl font-bold tabular-nums'>{value}</div>
        <p className='mt-1 text-xs text-muted-foreground'>{hint}</p>
      </CardContent>
    </Card>
  )
}

/** 横向占比条 */
function ShareBar({
  label,
  value,
  max,
  meta,
}: {
  label: string
  value: number
  max: number
  meta: string
}) {
  return (
    <div role='listitem'>
      <div className='mb-1 flex items-baseline justify-between gap-2'>
        <span className='truncate text-sm font-medium'>{label}</span>
        <span className='shrink-0 text-xs tabular-nums text-muted-foreground'>
          {meta}
        </span>
      </div>
      <div
        className='h-2 w-full overflow-hidden rounded-full bg-muted'
        aria-hidden='true'
      >
        <div
          className='h-full rounded-full bg-[#2a78d6] dark:bg-[#3987e5]'
          style={{ width: `${Math.max(2, (value / Math.max(1, max)) * 100)}%` }}
        />
      </div>
    </div>
  )
}

function EmptyReport() {
  return (
    <Card className='mt-4'>
      <CardContent className='flex flex-col items-center justify-center gap-3 py-16 text-center'>
        <FolderGit2 className='h-10 w-10 text-muted-foreground' />
        <div>
          <p className='font-medium'>收藏库还是空的</p>
          <p className='mt-1 text-sm text-muted-foreground'>
            收藏仓库后，这里会自动汇总收录量、分类分布与 Star 趋势。
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

export function AssetReport() {
  const [months, setMonths] = useState(12)

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['asset-report', months],
    queryFn: () => fetchAssetReport(months),
  })

  const report: AssetReportResponse | undefined = data
  const csv = useMemo(() => (report ? buildAssetCsv(report) : ''), [report])

  if (!report) {
    return (
      <>
        <Header>
          <h1 className='me-auto text-lg font-semibold'>资产报表</h1>
          <Search />
          <ThemeSwitch />
          <ConfigDrawer />
          <ProfileDropdown />
        </Header>
        <Main>
          <p className='text-sm text-muted-foreground'>正在加载资产报表…</p>
        </Main>
      </>
    )
  }

  const { summary, volume, categories, languages, starTrend } = report
  const isEmpty = summary.totalRepos === 0
  const maxCategoryRepos = Math.max(1, ...categories.map((item) => item.repoCount))
  const maxLanguageRepos = Math.max(1, ...languages.map((item) => item.repoCount))

  const handleExport = () => {
    downloadTextFile(
      `asset-report-${report.period.startDate}-${report.period.endDate}.csv`,
      csv
    )
  }

  return (
    <>
      <Header>
        <h1 className='me-auto text-lg font-semibold'>资产报表</h1>
        <Search />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>

      <Main>
        <div className='mb-4 flex flex-wrap items-end justify-between gap-3'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>资产报表</h2>
            <p className='text-sm text-muted-foreground'>
              收录量、分类分布与 Star 趋势，一页看清开源资产结构。
            </p>
          </div>
          <div className='flex flex-wrap items-center gap-3'>
            <div
              className='flex items-center gap-1 rounded-lg border p-0.5'
              role='group'
              aria-label='统计窗口'
            >
              {MONTH_OPTIONS.map((option) => (
                <Button
                  key={option}
                  size='sm'
                  variant={months === option ? 'default' : 'ghost'}
                  onClick={() => setMonths(normalizeMonths(option))}
                  aria-pressed={months === option}
                >
                  {option} 个月
                </Button>
              ))}
            </div>
            <Button
              variant='outline'
              size='sm'
              onClick={handleExport}
              disabled={isEmpty}
            >
              <Download className='size-4' />
              导出 CSV
            </Button>
            <Button
              variant='outline'
              size='sm'
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={cn('size-4', isFetching && 'animate-spin')} />
              刷新
            </Button>
          </div>
        </div>

        {isEmpty ? (
          <EmptyReport />
        ) : (
          <>
            <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
              <StatCard
                title='收录总量'
                icon={<FolderGit2 className='h-4 w-4' />}
                value={formatNumber(summary.totalRepos)}
                hint={`近 30 天新增 ${summary.addedLast30d} 个 · ${formatGrowthRate(summary.growthRate30d)}`}
              />
              <StatCard
                title='Star 总量'
                icon={<Star className='h-4 w-4' />}
                value={formatCompactNumber(summary.totalStars)}
                hint={`平均每个仓库 ${formatNumber(summary.avgStars)} Star`}
              />
              <StatCard
                title='分类覆盖'
                icon={<Layers className='h-4 w-4' />}
                value={formatPercent(summary.categoryCoverage)}
                hint={`${summary.categorizedRepos} 个已分类 · ${summary.uncategorizedRepos} 个未分类`}
              />
              <StatCard
                title='近 90 天新增'
                icon={<TrendingUp className='h-4 w-4' />}
                value={formatNumber(summary.addedLast90d)}
                hint={`近 7 天 ${summary.addedLast7d} 个 · 近 365 天 ${summary.addedLast365d} 个`}
              />
            </div>

            <div className='mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12'>
              <Card className='lg:col-span-8'>
                <CardHeader>
                  <CardTitle>收录量趋势</CardTitle>
                  <CardDescription>
                    柱为每月新增收录，折线为累计收录；窗口 {months} 个月。
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <VolumeChart months={volume.months} />
                </CardContent>
              </Card>

              <Card className='lg:col-span-4'>
                <CardHeader>
                  <CardTitle className='flex items-center gap-2'>
                    <Lightbulb className='h-4 w-4' />
                    关键洞察
                  </CardTitle>
                  <CardDescription>由确定性规则生成，不依赖模型。</CardDescription>
                </CardHeader>
                <CardContent>
                  {report.insights.length === 0 ? (
                    <p className='text-sm text-muted-foreground'>
                      暂无足够数据生成洞察。
                    </p>
                  ) : (
                    <div className='space-y-3' role='list' aria-label='关键洞察'>
                      {report.insights.map((insight) => (
                        <div
                          key={`${insight.kind}-${insight.title}`}
                          role='listitem'
                          className='flex gap-3 rounded-lg border p-3'
                        >
                          <span className='mt-0.5 text-muted-foreground' aria-hidden='true'>
                            {INSIGHT_ICONS[insight.kind]}
                          </span>
                          <div>
                            <p className='text-sm font-medium'>{insight.title}</p>
                            <p className='mt-0.5 text-xs leading-relaxed text-muted-foreground'>
                              {insight.description}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className='mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12'>
              <Card className='lg:col-span-7'>
                <CardHeader>
                  <CardTitle>分类分布</CardTitle>
                  <CardDescription>
                    按仓库数排序，占比以全部收藏为分母。
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {categories.length === 0 ? (
                    <p className='text-sm text-muted-foreground'>暂无分类数据。</p>
                  ) : (
                    <div className='space-y-3' role='list' aria-label='分类分布'>
                      {categories.map((item) => (
                        <ShareBar
                          key={item.name}
                          label={item.name}
                          value={item.repoCount}
                          max={maxCategoryRepos}
                          meta={`${item.repoCount} 个 · ${formatPercent(item.share)} · ${formatCompactNumber(item.starCount)} Star`}
                        />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className='lg:col-span-5'>
                <CardHeader>
                  <CardTitle>语言分布</CardTitle>
                  <CardDescription>按仓库数排序，未标注语言不计入。</CardDescription>
                </CardHeader>
                <CardContent>
                  {languages.length === 0 ? (
                    <p className='text-sm text-muted-foreground'>暂无语言数据。</p>
                  ) : (
                    <div className='space-y-3' role='list' aria-label='语言分布'>
                      {languages.map((item) => (
                        <ShareBar
                          key={item.name}
                          label={item.name}
                          value={item.repoCount}
                          max={maxLanguageRepos}
                          meta={`${item.repoCount} 个 · ${formatPercent(item.share)}`}
                        />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className='mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12'>
              <Card className='lg:col-span-7'>
                <CardHeader>
                  <CardTitle>Star 趋势</CardTitle>
                  <CardDescription>
                    基于每日热榜快照；仅统计有快照的收藏仓库，覆盖率{' '}
                    {formatPercent(starTrend.summary.coverage)}。
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <StarChart series={starTrend.series} />
                </CardContent>
              </Card>

              <Card className='lg:col-span-5'>
                <CardHeader>
                  <CardTitle>Top Movers</CardTitle>
                  <CardDescription>窗口内 Star 净增最多的收藏仓库。</CardDescription>
                </CardHeader>
                <CardContent className='px-0'>
                  {starTrend.topMovers.length === 0 ? (
                    <p className='px-6 pb-4 text-sm text-muted-foreground'>
                      暂无 Star 快照数据。
                    </p>
                  ) : (
                    <div className='overflow-x-auto'>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className='ps-6'>仓库</TableHead>
                            <TableHead className='text-end'>净增</TableHead>
                            <TableHead className='pe-6 text-end'>趋势</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {starTrend.topMovers.slice(0, 8).map((item) => (
                            <TableRow key={item.repoId}>
                              <TableCell className='ps-6'>
                                <a
                                  href={item.url}
                                  target='_blank'
                                  rel='noreferrer'
                                  className='inline-flex items-center gap-1 font-medium hover:underline'
                                >
                                  <span className='max-w-[14rem] truncate'>
                                    {item.owner}/{item.name}
                                  </span>
                                  <ExternalLink
                                    className='h-3 w-3 shrink-0 text-muted-foreground'
                                    aria-hidden='true'
                                  />
                                </a>
                                <p className='mt-0.5 text-xs text-muted-foreground'>
                                  {item.language ?? '未知语言'} ·{' '}
                                  {formatCompactNumber(item.stars)} Star
                                </p>
                              </TableCell>
                              <TableCell className='text-end tabular-nums'>
                                {formatSignedNumber(item.gain)}
                              </TableCell>
                              <TableCell className='pe-6 text-end'>
                                <Badge variant='outline'>
                                  {TREND_LABEL[item.trend] ?? item.trend}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card className='mt-4'>
              <CardHeader>
                <CardTitle>分类明细</CardTitle>
                <CardDescription>
                  仓库数、Star 存量、平均 Star 与主要语言。
                </CardDescription>
              </CardHeader>
              <CardContent className='px-0'>
                <div className='overflow-x-auto'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className='ps-6'>分类</TableHead>
                        <TableHead className='text-end'>仓库数</TableHead>
                        <TableHead className='text-end'>占比</TableHead>
                        <TableHead className='text-end'>Star 总量</TableHead>
                        <TableHead className='text-end'>平均 Star</TableHead>
                        <TableHead className='pe-6'>主要语言</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {categories.map((item) => (
                        <TableRow key={item.name}>
                          <TableCell className='ps-6 font-medium'>{item.name}</TableCell>
                          <TableCell className='text-end tabular-nums'>
                            {item.repoCount}
                          </TableCell>
                          <TableCell className='text-end tabular-nums'>
                            {formatPercent(item.share)}
                          </TableCell>
                          <TableCell className='text-end tabular-nums'>
                            {formatNumber(item.starCount)}
                          </TableCell>
                          <TableCell className='text-end tabular-nums'>
                            {formatNumber(item.avgStars)}
                          </TableCell>
                          <TableCell className='pe-6'>
                            {item.topLanguage ? (
                              <Badge variant='outline'>{item.topLanguage}</Badge>
                            ) : (
                              '—'
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <p className='mt-4 text-xs text-muted-foreground'>
              收录量按 created_at 的自然月统计（UTC）；Star 存量为当前值，Star 趋势只覆盖上过热榜的收藏仓库。
              {volume.unknownCreated > 0 &&
                ` 另有 ${volume.unknownCreated} 个仓库缺少收录时间，未计入月度分布。`}
              {volume.peakMonth &&
                ` 收录高峰为 ${monthLabel(volume.peakMonth.month)}（${volume.peakMonth.added} 个）。`}
              {' '}报表生成于 {formatDateTime(report.generatedAt)}。
            </p>
          </>
        )}
      </Main>
    </>
  )
}
