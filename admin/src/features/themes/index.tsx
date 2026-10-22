import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ExternalLink,
  Layers,
  Loader2,
  RefreshCw,
  Shapes,
  Sparkles,
  Star,
  Tag,
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
import { ScrollArea } from '@/components/ui/scroll-area'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import {
  applyThemeTag,
  clusterThemes,
  type ThemeCluster,
} from './api'
import {
  DEFAULT_MIN_CLUSTER_SIZE,
  DEFAULT_MIN_SIMILARITY,
  formatCohesion,
  formatCoverage,
  modeLabel,
  sortThemes,
  unclusteredLabel,
  unclusteredSummary,
} from './utils'

function StatCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string | number
  hint?: string
}) {
  return (
    <Card>
      <CardContent className='pt-6'>
        <p className='text-xs text-muted-foreground'>{label}</p>
        <p className='mt-1 text-2xl font-semibold tracking-tight'>{value}</p>
        {hint && <p className='mt-1 text-xs text-muted-foreground'>{hint}</p>}
      </CardContent>
    </Card>
  )
}

function ThemeCard({
  theme,
  applying,
  onApply,
}: {
  theme: ThemeCluster
  applying: string
  onApply: (theme: ThemeCluster, tag: string) => void
}) {
  return (
    <Card className='flex flex-col'>
      <CardHeader>
        <div className='flex items-start justify-between gap-2'>
          <div className='min-w-0'>
            <CardTitle className='flex items-center gap-2 text-base'>
              <Shapes className='size-4 shrink-0 text-violet-500' />
              <span className='truncate'>{theme.name}</span>
            </CardTitle>
            <CardDescription className='mt-1'>
              {theme.repoCount} 个仓库 · 凝聚度 {formatCohesion(theme.cohesion)}
            </CardDescription>
          </div>
          <Badge variant='secondary' className='shrink-0'>
            {theme.repoCount}
          </Badge>
        </div>
        <div className='flex flex-wrap gap-1.5 pt-2'>
          {theme.keywords.map((keyword) => (
            <Badge key={keyword} variant='outline' className='font-normal'>
              {keyword}
            </Badge>
          ))}
        </div>
      </CardHeader>

      <CardContent className='flex flex-1 flex-col gap-4'>
        <div className='space-y-2'>
          <p className='text-xs font-medium text-muted-foreground'>建议标签</p>
          {theme.suggestedTags.length > 0 ? (
            <div className='flex flex-wrap gap-2'>
              {theme.suggestedTags.map((tag) => {
                const key = `${theme.id}:${tag}`
                const busy = applying === key
                return (
                  <Button
                    key={tag}
                    size='sm'
                    variant='secondary'
                    disabled={busy}
                    onClick={() => onApply(theme, tag)}
                  >
                    {busy ? (
                      <Loader2 className='me-1 size-3 animate-spin' />
                    ) : (
                      <Tag className='me-1 size-3' />
                    )}
                    应用「{tag}」
                  </Button>
                )
              })}
            </div>
          ) : (
            <p className='text-xs text-muted-foreground'>
              关键词与现有标签重合，暂无可应用的新标签。
            </p>
          )}
        </div>

        <ScrollArea className='max-h-64 rounded-md border'>
          <div className='divide-y'>
            {theme.repos.map((repo) => (
              <div key={repo.id} className='space-y-1 px-3 py-2'>
                <div className='flex items-center justify-between gap-2'>
                  <a
                    href={`https://github.com/${repo.id}`}
                    target='_blank'
                    rel='noreferrer'
                    className='min-w-0 truncate text-sm font-medium hover:underline'
                  >
                    {repo.id}
                    <ExternalLink className='ms-1 inline size-3' />
                  </a>
                  <span className='inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground'>
                    <Star className='size-3' />
                    {repo.stars.toLocaleString()}
                  </span>
                </div>
                <p className='line-clamp-1 text-xs text-muted-foreground'>
                  {repo.description || repo.summary || '暂无项目简介'}
                </p>
                <div className='flex flex-wrap items-center gap-1.5'>
                  {repo.language && (
                    <Badge variant='outline' className='text-[10px]'>
                      {repo.language}
                    </Badge>
                  )}
                  {repo.tags.map((tag) => (
                    <Badge key={tag} variant='secondary' className='text-[10px]'>
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

export function Themes() {
  const queryClient = useQueryClient()
  const [minSimilarity, setMinSimilarity] = useState(DEFAULT_MIN_SIMILARITY)
  const [minClusterSize, setMinClusterSize] = useState(DEFAULT_MIN_CLUSTER_SIZE)
  const [applying, setApplying] = useState('')

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['themes', minSimilarity, minClusterSize],
    queryFn: () =>
      clusterThemes({ minSimilarity, minClusterSize, maxClusters: 12 }),
  })

  const themes = useMemo(() => sortThemes(data?.themes ?? []), [data])
  const summary = useMemo(
    () => unclusteredSummary(data?.unclustered ?? []),
    [data]
  )

  async function handleApply(theme: ThemeCluster, tag: string) {
    const key = `${theme.id}:${tag}`
    setApplying(key)
    try {
      const result = await applyThemeTag(
        tag,
        theme.repos.map((repo) => repo.id)
      )
      const skipped = result.skipped > 0 ? `，跳过 ${result.skipped} 个` : ''
      toast.success(`已为 ${result.applied} 个仓库添加标签「${result.tag}」${skipped}`)
      await queryClient.invalidateQueries({ queryKey: ['themes'] })
    } catch {
      toast.error('应用标签失败，请稍后重试')
    } finally {
      setApplying('')
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
        <div className='mb-6 flex flex-wrap items-start justify-between gap-4'>
          <div className='space-y-1'>
            <h2 className='flex items-center gap-2 text-2xl font-bold tracking-tight'>
              <Layers className='size-6 text-violet-500' />
              主题聚类
            </h2>
            <p className='text-sm text-muted-foreground'>
              基于向量相似度把你的收藏自动归成主题，确认后一键补充标签。
            </p>
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            {data && <Badge variant='secondary'>{modeLabel(data.mode)}</Badge>}
            {data && (
              <span className='text-xs text-muted-foreground'>
                {data.tookMs} ms
                {data.stats.model ? ` · ${data.stats.model}` : ''}
              </span>
            )}
            <Button
              variant='outline'
              size='sm'
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              {isFetching ? (
                <Loader2 className='me-1 size-4 animate-spin' />
              ) : (
                <RefreshCw className='me-1 size-4' />
              )}
              重新聚类
            </Button>
          </div>
        </div>

        <Card className='mb-6'>
          <CardContent className='flex flex-col gap-5 pt-6 sm:flex-row sm:items-center sm:gap-8'>
            <label className='flex flex-1 flex-col gap-2 text-sm'>
              <span className='flex items-center justify-between gap-2'>
                <span className='font-medium'>相似度阈值</span>
                <span className='font-mono text-xs text-muted-foreground'>
                  {minSimilarity.toFixed(2)}
                </span>
              </span>
              <input
                type='range'
                min={0.3}
                max={0.95}
                step={0.05}
                value={minSimilarity}
                onChange={(event) =>
                  setMinSimilarity(Number(event.target.value))
                }
                className='accent-primary'
                aria-label='相似度阈值'
              />
              <span className='text-xs text-muted-foreground'>
                调高更严格，主题更聚焦；调低会把更多仓库并在一起。
              </span>
            </label>

            <label className='flex flex-1 flex-col gap-2 text-sm'>
              <span className='flex items-center justify-between gap-2'>
                <span className='font-medium'>每主题最少仓库</span>
                <span className='font-mono text-xs text-muted-foreground'>
                  {minClusterSize}
                </span>
              </span>
              <input
                type='range'
                min={1}
                max={10}
                step={1}
                value={minClusterSize}
                onChange={(event) =>
                  setMinClusterSize(Number(event.target.value))
                }
                className='accent-primary'
                aria-label='每主题最少仓库'
              />
              <span className='text-xs text-muted-foreground'>
                小于该数量的仓库会进入「未聚类」，便于单独整理。
              </span>
            </label>
          </CardContent>
        </Card>

        {isLoading && (
          <Card>
            <CardContent className='flex h-40 items-center justify-center gap-2 text-muted-foreground'>
              <Loader2 className='size-5 animate-spin' />
              正在分析收藏库的向量…
            </CardContent>
          </Card>
        )}

        {error && !isLoading && (
          <Card className='mb-6'>
            <CardContent className='flex h-32 flex-col items-center justify-center gap-2 text-muted-foreground'>
              <p>主题聚类暂时不可用，请稍后重试。</p>
              <Button size='sm' variant='outline' onClick={() => void refetch()}>
                重试
              </Button>
            </CardContent>
          </Card>
        )}

        {data && !isLoading && (
          <>
            <div className='mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4'>
              <StatCard label='收藏仓库' value={data.stats.totalRepos} />
              <StatCard
                label='主题数'
                value={data.stats.themeCount}
                hint={`${data.stats.clusteredRepos} 个仓库已归类`}
              />
              <StatCard
                label='聚类覆盖'
                value={formatCoverage(data.stats)}
                hint={`已向量化 ${data.stats.vectorized} 个`}
              />
              <StatCard
                label='向量模型'
                value={data.stats.model || '—'}
                hint={data.stats.backend || '本地兜底'}
              />
            </div>

            {themes.length === 0 ? (
              <Card>
                <CardContent className='flex h-40 flex-col items-center justify-center gap-2 text-center text-muted-foreground'>
                  <Sparkles className='size-6' />
                  <p>暂未形成主题。</p>
                  <p className='text-xs'>
                    收藏更多仓库，或等待向量化任务完成后再来聚类。
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className='grid gap-4 xl:grid-cols-2'>
                {themes.map((theme) => (
                  <ThemeCard
                    key={theme.id}
                    theme={theme}
                    applying={applying}
                    onApply={(item, tag) => void handleApply(item, tag)}
                  />
                ))}
              </div>
            )}

            {data.unclustered.length > 0 && (
              <Card className='mt-6'>
                <CardHeader>
                  <CardTitle className='text-base'>未聚类仓库</CardTitle>
                  <CardDescription>
                    共 {data.unclustered.length} 个，可先单独整理或等待向量化。
                  </CardDescription>
                </CardHeader>
                <CardContent className='space-y-3'>
                  <div className='flex flex-wrap gap-2'>
                    {summary.map((item) => (
                      <Badge key={item.reason} variant='outline'>
                        {item.label} · {item.count}
                      </Badge>
                    ))}
                  </div>
                  <div className='flex flex-wrap gap-2'>
                    {data.unclustered.slice(0, 30).map((item) => (
                      <Badge
                        key={item.id}
                        variant='secondary'
                        title={unclusteredLabel(item.reason)}
                      >
                        {item.id}
                      </Badge>
                    ))}
                    {data.unclustered.length > 30 && (
                      <Badge variant='outline'>
                        还有 {data.unclustered.length - 30} 个
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </Main>
    </>
  )
}
