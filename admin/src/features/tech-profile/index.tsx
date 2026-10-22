import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  Activity,
  Boxes,
  CalendarClock,
  Code2,
  ExternalLink,
  FolderGit2,
  Gauge,
  GitFork,
  Languages,
  Layers,
  Lightbulb,
  Radar,
  RefreshCw,
  Sparkles,
  Star,
} from 'lucide-react'
import { cn } from '@/lib/utils'
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
import {
  fetchTechProfile,
  MOCK_TECH_PROFILE,
  type TechProfileInsight,
  type TechProfileMonthPoint,
} from './api'
import {
  activityLevelClass,
  activityLevelText,
  foldLanguages,
  formatCompactNumber,
  formatDate,
  formatDateTime,
  formatMonthFull,
  formatMonthLabel,
  formatPercent,
  healthStatusText,
  maxMonthAdded,
  profileTypeHint,
} from './utils'

const MONTH_OPTIONS = [6, 12, 24] as const

const INSIGHT_ICONS: Record<TechProfileInsight['kind'], ReactNode> = {
  language: <Languages className='h-4 w-4' />,
  framework: <Boxes className='h-4 w-4' />,
  activity: <Activity className='h-4 w-4' />,
  rhythm: <CalendarClock className='h-4 w-4' />,
  diversity: <Layers className='h-4 w-4' />,
  empty: <Lightbulb className='h-4 w-4' />,
}

const BUCKET_COLORS = [
  'bg-[#2a78d6] dark:bg-[#3987e5]',
  'bg-[#4ba3e3] dark:bg-[#5cb0ea]',
  'bg-[#7cc4e8] dark:bg-[#8acdeb]',
  'bg-[#f2b134] dark:bg-[#f5bd4f]',
  'bg-[#e07b39] dark:bg-[#e88b4d]',
  'bg-[#c2413b] dark:bg-[#d1554f]',
  'bg-muted-foreground/40',
]

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

function MonthlyChart({
  months,
}: {
  months: readonly TechProfileMonthPoint[]
}) {
  const max = maxMonthAdded(months)
  return (
    <div
      className='flex items-end gap-1.5 pt-2'
      role='img'
      aria-label={`近 ${months.length} 个月每月新增收藏柱状图`}
    >
      {months.map((point) => {
        const height = Math.max(2, (point.added / max) * 100)
        return (
          <div
            key={point.month}
            className='flex min-w-0 flex-1 flex-col items-center'
          >
            <span className='mb-1 h-4 text-[10px] text-muted-foreground tabular-nums'>
              {point.added > 0 ? point.added : ''}
            </span>
            <div className='flex h-40 w-full items-end'>
              <div
                className='w-full rounded-t bg-[#2a78d6] transition-colors hover:bg-[#1f63b4] dark:bg-[#3987e5] dark:hover:bg-[#2f78d2]'
                style={{ height: `${height}%` }}
                title={`${formatMonthFull(point.month)}：新增 ${point.added} 个，累计 ${point.cumulative} 个`}
              />
            </div>
            <span className='mt-2 truncate text-[10px] text-muted-foreground'>
              {formatMonthLabel(point.month)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function EmptyState() {
  return (
    <Card className='mt-4'>
      <CardContent className='flex flex-col items-center justify-center gap-3 py-16 text-center'>
        <Radar className='h-10 w-10 text-muted-foreground' />
        <div>
          <p className='font-medium'>还没有可生成画像的收藏</p>
          <p className='mt-1 text-sm text-muted-foreground'>
            先同步 GitHub Starred 或从热榜收藏项目，语言 /
            框架分布与活跃度会自动生成。
          </p>
        </div>
        <Button asChild>
          <Link to='/repos'>去管理仓库</Link>
        </Button>
      </CardContent>
    </Card>
  )
}

export function TechProfile() {
  const [months, setMonths] = useState<number>(12)

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['tech-profile', months],
    queryFn: () => fetchTechProfile(months),
  })

  const profile = data ?? MOCK_TECH_PROFILE
  const { summary, activity } = profile
  const isEmpty = summary.totalRepos === 0
  const languageBars = foldLanguages(profile.languages)
  const maxLanguageShare = Math.max(1, languageBars[0]?.share ?? 1)
  const maxFrameworkCount = Math.max(
    1,
    ...profile.frameworks.map((item) => item.repoCount)
  )
  const maxCategoryCount = Math.max(
    1,
    ...profile.categories.map((item) => item.repoCount)
  )
  const frameworkTop = profile.frameworks.slice(0, 8)
  const latestMonth = activity.months[activity.months.length - 1]
  const pushTotal = activity.pushBuckets.reduce(
    (sum, item) => sum + item.repoCount,
    0
  )

  return (
    <>
      <Header>
        <h1 className='me-auto text-lg font-semibold'>技术画像</h1>
        <Search />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>

      <Main>
        <div className='mb-4 flex flex-wrap items-end justify-between gap-3'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>个人技术画像</h2>
            <p className='text-sm text-muted-foreground'>
              从收藏库自动聚合语言 / 框架分布与活跃度，无需手工维护。
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
                  onClick={() => setMonths(option)}
                  aria-pressed={months === option}
                >
                  {option} 个月
                </Button>
              ))}
            </div>
            <Button
              variant='outline'
              size='sm'
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              <RefreshCw
                className={cn('size-4', isFetching && 'animate-spin')}
              />
              刷新
            </Button>
          </div>
        </div>

        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
          <StatCard
            title='收藏仓库'
            icon={<FolderGit2 className='h-4 w-4' />}
            value={String(summary.totalRepos)}
            hint={`语言覆盖 ${summary.withLanguage} · 框架识别 ${summary.withFramework}`}
          />
          <StatCard
            title='语言 / 框架'
            icon={<Code2 className='h-4 w-4' />}
            value={`${summary.languageCount} / ${summary.frameworkCount}`}
            hint={`主力 ${summary.topLanguage ?? '—'} · ${summary.topFramework ?? '—'}`}
          />
          <StatCard
            title='活跃度分'
            icon={<Gauge className='h-4 w-4' />}
            value={String(summary.activityScore)}
            hint={`${activityLevelText(summary.activityLevel)} · 近 90 天有推送 ${formatPercent(summary.activeRatio)}`}
          />
          <StatCard
            title='近 90 天新增'
            icon={<Sparkles className='h-4 w-4' />}
            value={String(activity.recent.last90d)}
            hint={`连续 ${activity.streakMonths} 个月有新增 · 高峰 ${
              activity.peakMonth
                ? formatMonthFull(activity.peakMonth.month)
                : '—'
            }`}
          />
        </div>

        {isEmpty ? (
          <EmptyState />
        ) : (
          <>
            <Card className='mt-4'>
              <CardContent className='grid gap-6 py-6 md:grid-cols-3'>
                <div>
                  <p className='text-xs font-medium text-muted-foreground'>
                    画像类型
                  </p>
                  <div className='mt-2 flex items-center gap-2'>
                    <Radar className='h-5 w-5 text-[#2a78d6] dark:text-[#3987e5]' />
                    <span className='text-xl font-bold'>
                      {summary.profileType}
                    </span>
                  </div>
                  <p className='mt-2 text-xs leading-relaxed text-muted-foreground'>
                    {profileTypeHint(summary.profileType)}
                  </p>
                </div>
                <div>
                  <div className='flex items-center justify-between'>
                    <p className='text-xs font-medium text-muted-foreground'>
                      活跃度
                    </p>
                    <Badge
                      variant='outline'
                      className={activityLevelClass(summary.activityLevel)}
                    >
                      {activityLevelText(summary.activityLevel)}
                    </Badge>
                  </div>
                  <div className='mt-3 flex items-baseline gap-2'>
                    <span className='text-3xl font-bold tabular-nums'>
                      {summary.activityScore}
                    </span>
                    <span className='text-xs text-muted-foreground'>/ 100</span>
                  </div>
                  <div
                    className='mt-2 h-2 w-full overflow-hidden rounded-full bg-muted'
                    role='img'
                    aria-label={`活跃度分 ${summary.activityScore} / 100`}
                  >
                    <div
                      className='h-full rounded-full bg-[#2a78d6] dark:bg-[#3987e5]'
                      style={{ width: `${summary.activityScore}%` }}
                    />
                  </div>
                  <p className='mt-2 text-xs text-muted-foreground'>
                    活跃 {summary.activeRepos} · 沉寂 {summary.staleRepos} ·
                    归档 {summary.archivedRepos}
                  </p>
                </div>
                <div>
                  <p className='text-xs font-medium text-muted-foreground'>
                    收藏概览
                  </p>
                  <div className='mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm'>
                    <span className='text-muted-foreground'>总 Star</span>
                    <span className='text-end font-medium tabular-nums'>
                      {formatCompactNumber(summary.totalStars)}
                    </span>
                    <span className='text-muted-foreground'>总 Fork</span>
                    <span className='text-end font-medium tabular-nums'>
                      {formatCompactNumber(summary.totalForks)}
                    </span>
                    <span className='text-muted-foreground'>分类分组</span>
                    <span className='text-end font-medium tabular-nums'>
                      {summary.categoryCount}
                    </span>
                    <span className='text-muted-foreground'>首次收藏</span>
                    <span className='text-end font-medium'>
                      {formatDate(activity.firstCollectedAt)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className='mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12'>
              <Card className='lg:col-span-7'>
                <CardHeader>
                  <CardTitle className='flex items-center gap-2'>
                    <Languages className='h-4 w-4' />
                    语言分布
                  </CardTitle>
                  <CardDescription>
                    按仓库数排序；占比以收藏总数为分母，与「技术栈图谱」同口径。
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {languageBars.length === 0 ? (
                    <p className='text-sm text-muted-foreground'>
                      收藏仓库还没有语言信息。
                    </p>
                  ) : (
                    <div
                      className='space-y-3'
                      role='list'
                      aria-label='语言分布'
                    >
                      {languageBars.map((item) => (
                        <div key={item.name} role='listitem'>
                          <div className='mb-1 flex items-baseline justify-between gap-2'>
                            <span className='truncate text-sm font-medium'>
                              {item.name}
                            </span>
                            <span className='shrink-0 text-xs text-muted-foreground tabular-nums'>
                              {item.repoCount} 个 · {formatPercent(item.share)}
                            </span>
                          </div>
                          <div
                            className='h-2 w-full overflow-hidden rounded-full bg-muted'
                            aria-hidden='true'
                          >
                            <div
                              className={cn(
                                'h-full rounded-full',
                                item.isOther
                                  ? 'bg-muted-foreground/40'
                                  : 'bg-[#2a78d6] dark:bg-[#3987e5]'
                              )}
                              style={{
                                width: `${Math.max(2, (item.share / maxLanguageShare) * 100)}%`,
                              }}
                            />
                          </div>
                          <p className='mt-1 text-xs text-muted-foreground'>
                            平均{' '}
                            {formatCompactNumber(
                              item.starCount / Math.max(1, item.repoCount)
                            )}{' '}
                            Star / 仓库
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className='lg:col-span-5'>
                <CardHeader>
                  <CardTitle className='flex items-center gap-2'>
                    <Boxes className='h-4 w-4' />
                    框架分布
                  </CardTitle>
                  <CardDescription>
                    来自语言、描述、README 摘要与标签的确定性识别，最多展示 8
                    个。
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {frameworkTop.length === 0 ? (
                    <p className='text-sm text-muted-foreground'>
                      暂未识别到框架，可在仓库标签中补充。
                    </p>
                  ) : (
                    <div
                      className='space-y-3'
                      role='list'
                      aria-label='框架分布'
                    >
                      {frameworkTop.map((item) => (
                        <div key={item.name} role='listitem'>
                          <div className='mb-1 flex items-baseline justify-between gap-2'>
                            <span className='flex min-w-0 items-center gap-2'>
                              <span className='truncate text-sm font-medium'>
                                {item.name}
                              </span>
                              <Badge
                                variant='outline'
                                className='shrink-0 text-[10px]'
                              >
                                {item.category}
                              </Badge>
                            </span>
                            <span className='shrink-0 text-xs text-muted-foreground tabular-nums'>
                              {item.repoCount} 个 · {formatPercent(item.share)}
                            </span>
                          </div>
                          <div
                            className='h-1.5 w-full overflow-hidden rounded-full bg-muted'
                            aria-hidden='true'
                          >
                            <div
                              className='h-full rounded-full bg-[#4ba3e3] dark:bg-[#5cb0ea]'
                              style={{
                                width: `${Math.max(2, (item.repoCount / maxFrameworkCount) * 100)}%`,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className='mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12'>
              <Card className='lg:col-span-8'>
                <CardHeader>
                  <CardTitle>收藏趋势</CardTitle>
                  <CardDescription>
                    近 {activity.periodMonths} 个月每月新增收藏；当前累计{' '}
                    {latestMonth?.cumulative ?? summary.totalRepos} 个。
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <MonthlyChart months={activity.months} />
                  <div className='mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground'>
                    <span>
                      近 7 天新增 {activity.recent.last7d} · 30 天{' '}
                      {activity.recent.last30d} · 90 天{' '}
                      {activity.recent.last90d} · 一年{' '}
                      {activity.recent.last365d}
                    </span>
                    <span>
                      最近入库 {formatDate(activity.latestCollectedAt)}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card className='lg:col-span-4'>
                <CardHeader>
                  <CardTitle className='flex items-center gap-2'>
                    <Lightbulb className='h-4 w-4' />
                    关键洞察
                  </CardTitle>
                  <CardDescription>
                    由确定性规则生成，不依赖模型。
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {profile.insights.length === 0 ? (
                    <p className='text-sm text-muted-foreground'>
                      暂无足够数据生成洞察。
                    </p>
                  ) : (
                    <div
                      className='space-y-3'
                      role='list'
                      aria-label='关键洞察'
                    >
                      {profile.insights.map((insight) => (
                        <div
                          key={`${insight.kind}-${insight.title}`}
                          role='listitem'
                          className='flex gap-3 rounded-lg border p-3'
                        >
                          <span
                            className='mt-0.5 text-muted-foreground'
                            aria-hidden='true'
                          >
                            {INSIGHT_ICONS[insight.kind]}
                          </span>
                          <div>
                            <p className='text-sm font-medium'>
                              {insight.title}
                            </p>
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
              <Card className='lg:col-span-8'>
                <CardHeader>
                  <CardTitle className='flex items-center gap-2'>
                    <Star className='h-4 w-4' />
                    Top 收藏仓库
                  </CardTitle>
                  <CardDescription>
                    按 Star、Fork 排序，取前 5 个。
                  </CardDescription>
                </CardHeader>
                <CardContent className='px-0'>
                  {profile.topRepos.length === 0 ? (
                    <p className='px-6 pb-4 text-sm text-muted-foreground'>
                      暂无收藏仓库。
                    </p>
                  ) : (
                    <div className='overflow-x-auto'>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className='ps-6 text-center'>
                              #
                            </TableHead>
                            <TableHead>仓库</TableHead>
                            <TableHead>语言</TableHead>
                            <TableHead className='text-end'>Star</TableHead>
                            <TableHead className='text-end'>Fork</TableHead>
                            <TableHead>最近推送</TableHead>
                            <TableHead className='pe-6 text-end'>
                              健康度
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {profile.topRepos.map((item, index) => (
                            <TableRow key={item.id}>
                              <TableCell className='ps-6 text-center text-muted-foreground tabular-nums'>
                                {index + 1}
                              </TableCell>
                              <TableCell>
                                <a
                                  href={item.url}
                                  target='_blank'
                                  rel='noreferrer'
                                  className='inline-flex items-center gap-1 font-medium hover:underline'
                                >
                                  <span className='max-w-[20rem] truncate'>
                                    {item.name}
                                  </span>
                                  <ExternalLink
                                    className='h-3 w-3 shrink-0 text-muted-foreground'
                                    aria-hidden='true'
                                  />
                                </a>
                              </TableCell>
                              <TableCell>
                                {item.language ? (
                                  <Badge variant='outline'>
                                    {item.language}
                                  </Badge>
                                ) : (
                                  '—'
                                )}
                              </TableCell>
                              <TableCell className='text-end tabular-nums'>
                                {formatCompactNumber(item.stars)}
                              </TableCell>
                              <TableCell className='text-end tabular-nums'>
                                {formatCompactNumber(item.forks)}
                              </TableCell>
                              <TableCell className='tabular-nums'>
                                {formatDate(item.pushedAt)}
                              </TableCell>
                              <TableCell className='pe-6 text-end'>
                                {healthStatusText(item.healthStatus)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className='space-y-4 lg:col-span-4'>
                <Card>
                  <CardHeader>
                    <CardTitle className='flex items-center gap-2'>
                      <Activity className='h-4 w-4' />
                      推送活跃度
                    </CardTitle>
                    <CardDescription>
                      按最近一次推送距今天数分桶。
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {pushTotal === 0 ? (
                      <p className='text-sm text-muted-foreground'>
                        收藏仓库还没有推送时间。
                      </p>
                    ) : (
                      <>
                        <div
                          className='flex h-3 w-full overflow-hidden rounded-full bg-muted'
                          role='img'
                          aria-label='推送活跃度分桶占比'
                        >
                          {activity.pushBuckets
                            .map((item, index) => ({ item, index }))
                            .filter(({ item }) => item.repoCount > 0)
                            .map(({ item, index }) => (
                              <div
                                key={item.key}
                                className={
                                  BUCKET_COLORS[index % BUCKET_COLORS.length]
                                }
                                style={{ width: `${item.share}%` }}
                                title={`${item.label}：${item.repoCount} 个（${formatPercent(item.share)}）`}
                              />
                            ))}
                        </div>
                        <div
                          className='mt-3 grid grid-cols-2 gap-x-4 gap-y-2'
                          role='list'
                        >
                          {activity.pushBuckets.map((item, index) => (
                            <div
                              key={item.key}
                              role='listitem'
                              className='flex items-center justify-between gap-2 text-xs'
                            >
                              <span className='flex min-w-0 items-center gap-1.5'>
                                <span
                                  className={cn(
                                    'h-2 w-2 shrink-0 rounded-full',
                                    BUCKET_COLORS[index % BUCKET_COLORS.length]
                                  )}
                                  aria-hidden='true'
                                />
                                <span className='truncate text-muted-foreground'>
                                  {item.label}
                                </span>
                              </span>
                              <span className='shrink-0 tabular-nums'>
                                {item.repoCount} · {formatPercent(item.share)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className='flex items-center gap-2'>
                      <GitFork className='h-4 w-4' />
                      分类分布
                    </CardTitle>
                    <CardDescription>
                      按收藏仓库的分类分组统计。
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {profile.categories.length === 0 ? (
                      <p className='text-sm text-muted-foreground'>
                        暂无分类数据。
                      </p>
                    ) : (
                      <div
                        className='space-y-2.5'
                        role='list'
                        aria-label='分类分布'
                      >
                        {profile.categories.slice(0, 6).map((item) => (
                          <div key={item.name} role='listitem'>
                            <div className='mb-1 flex items-baseline justify-between gap-2'>
                              <span className='truncate text-sm'>
                                {item.name}
                              </span>
                              <span className='shrink-0 text-xs text-muted-foreground tabular-nums'>
                                {item.repoCount} 个 ·{' '}
                                {formatPercent(item.share)}
                              </span>
                            </div>
                            <div
                              className='h-1.5 w-full overflow-hidden rounded-full bg-muted'
                              aria-hidden='true'
                            >
                              <div
                                className='h-full rounded-full bg-[#7cc4e8] dark:bg-[#8acdeb]'
                                style={{
                                  width: `${Math.max(2, (item.repoCount / maxCategoryCount) * 100)}%`,
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </>
        )}

        <p className='mt-4 text-xs text-muted-foreground'>
          数据来源：D1 my_repositories / categories /
          repo_tags，只读聚合；更新于 {formatDateTime(profile.generatedAt)}
          。收藏趋势按入库时间统计，不是 GitHub Star 时间。
        </p>
      </Main>
    </>
  )
}
