import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Archive,
  DatabaseBackup,
  Download,
  FileJson,
  Loader2,
  Lock,
  PackageCheck,
  ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
  downloadArchive,
  fetchArchiveSummary,
  MOCK_ARCHIVE_SUMMARY,
  saveBlob,
} from './api'
import type { ArchiveFormat, ArchiveScope } from './types'
import {
  FORMAT_OPTIONS,
  SCOPE_OPTIONS,
  fallbackArchiveFileName,
  formatBytes,
  formatCount,
  formatLabel,
  scopedRecordCount,
  visibleDatasets,
} from './utils'

const FORMAT_ICONS = {
  zip: Archive,
  json: FileJson,
} as const

const EXCLUDED_DATA = [
  '登录会话（sessions）',
  '扩展令牌（extension_tokens）',
  'Telegram 绑定与验证码',
  '安全事件 / 登录尝试',
]

export function FullArchive() {
  const { data } = useQuery({
    queryKey: ['archive-summary'],
    queryFn: fetchArchiveSummary,
  })
  const summary = data ?? MOCK_ARCHIVE_SUMMARY
  const [scope, setScope] = useState<ArchiveScope>('full')
  const [format, setFormat] = useState<ArchiveFormat>('zip')
  const [downloading, setDownloading] = useState(false)

  const datasets = visibleDatasets(summary, scope)
  const records = scopedRecordCount(summary, scope)
  const previewName = fallbackArchiveFileName(format, summary.generatedAt)

  async function handleDownload() {
    if (downloading) return
    setDownloading(true)
    try {
      const { blob, fileName } = await downloadArchive({ scope, format })
      saveBlob(blob, fileName)
      toast.success(`已生成 ${fileName}`)
    } catch {
      toast.error('归档生成失败，请稍后重试')
    } finally {
      setDownloading(false)
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
        <div className='mb-4 flex flex-wrap items-start justify-between gap-4'>
          <div>
            <h2 className='flex items-center gap-2 text-2xl font-bold tracking-tight'>
              <DatabaseBackup className='size-6 text-emerald-600' />
              全量导出与归档
            </h2>
            <p className='text-sm text-muted-foreground'>
              按 openfactory.archive.v1 规范打包账号数据，带 manifest 与 SHA-256
              校验，可长期保存或跨部署迁移。
            </p>
          </div>
          <Badge variant='outline' className='mt-1'>
            <ShieldCheck className='me-1 size-3.5' />
            只读导出 · 不含密钥
          </Badge>
        </div>

        <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
          <StatCard label='数据集' value={String(datasets.length)} />
          <StatCard label='记录总数' value={formatCount(records)} />
          <StatCard
            label='预计大小'
            value={formatBytes(
              datasets.length === summary.datasets.length
                ? summary.estimatedBytes
                : Math.round(
                    (summary.estimatedBytes * records) /
                      Math.max(summary.totalRecords, 1)
                  )
            )}
          />
          <StatCard label='归档格式' value={formatLabel(format)} />
        </div>

        <div className='mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3'>
          <div className='space-y-3 lg:col-span-2'>
            <Card>
              <CardHeader>
                <CardTitle>归档范围</CardTitle>
                <CardDescription>
                  完整归档覆盖全部数据集；知识库归档只保留收藏与组织信息。
                </CardDescription>
              </CardHeader>
              <CardContent className='grid gap-3 sm:grid-cols-2'>
                {SCOPE_OPTIONS.map((option) => {
                  const selected = scope === option.key
                  const count = scopedRecordCount(summary, option.key)
                  return (
                    <button
                      key={option.key}
                      type='button'
                      aria-pressed={selected}
                      onClick={() => setScope(option.key)}
                      className={cn(
                        'rounded-xl border bg-card p-4 text-left transition-colors',
                        selected
                          ? 'border-primary ring-2 ring-primary/20'
                          : 'hover:border-muted-foreground/30'
                      )}
                    >
                      <span className='flex items-center justify-between gap-2'>
                        <span className='font-semibold'>{option.label}</span>
                        <Badge variant='secondary'>
                          {formatCount(count)} 条
                        </Badge>
                      </span>
                      <span className='mt-1 block text-sm text-muted-foreground'>
                        {option.description}
                      </span>
                      <span className='mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground'>
                        {option.bullets.map((bullet) => (
                          <span key={bullet}>· {bullet}</span>
                        ))}
                      </span>
                    </button>
                  )
                })}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>归档格式</CardTitle>
                <CardDescription>
                  ZIP 适合人工保存与校验；JSON 适合脚本处理与二次导入。
                </CardDescription>
              </CardHeader>
              <CardContent className='grid gap-3 sm:grid-cols-2'>
                {FORMAT_OPTIONS.map((option) => {
                  const Icon = FORMAT_ICONS[option.key]
                  const selected = format === option.key
                  return (
                    <button
                      key={option.key}
                      type='button'
                      aria-pressed={selected}
                      onClick={() => setFormat(option.key)}
                      className={cn(
                        'flex items-start gap-3 rounded-xl border bg-card p-4 text-left transition-colors',
                        selected
                          ? 'border-primary ring-2 ring-primary/20'
                          : 'hover:border-muted-foreground/30'
                      )}
                    >
                      <span
                        className={cn(
                          'flex size-9 shrink-0 items-center justify-center rounded-lg',
                          selected
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground'
                        )}
                      >
                        <Icon className='size-4.5' />
                      </span>
                      <span className='min-w-0 flex-1'>
                        <span className='flex items-center gap-2'>
                          <span className='font-semibold'>{option.label}</span>
                          <Badge variant='secondary'>{option.extension}</Badge>
                        </span>
                        <span className='mt-1 block text-xs text-muted-foreground'>
                          {option.description}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </CardContent>
            </Card>
          </div>

          <Card className='h-fit'>
            <CardHeader>
              <CardTitle>生成归档</CardTitle>
              <CardDescription>
                归档在请求时实时生成，服务端不会留存副本。
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground'>
                <div className='flex items-center gap-1.5 font-medium text-foreground'>
                  <PackageCheck className='size-3.5' />
                  文件名
                </div>
                <code className='mt-1 block break-all'>{previewName}</code>
              </div>
              <dl className='space-y-2 text-sm'>
                <div className='flex items-center justify-between'>
                  <dt className='text-muted-foreground'>范围</dt>
                  <dd className='font-medium'>
                    {SCOPE_OPTIONS.find((item) => item.key === scope)?.label}
                  </dd>
                </div>
                <div className='flex items-center justify-between'>
                  <dt className='text-muted-foreground'>数据集</dt>
                  <dd className='font-medium'>{datasets.length} 个</dd>
                </div>
                <div className='flex items-center justify-between'>
                  <dt className='text-muted-foreground'>记录</dt>
                  <dd className='font-medium'>{formatCount(records)} 条</dd>
                </div>
                <div className='flex items-center justify-between'>
                  <dt className='text-muted-foreground'>校验</dt>
                  <dd className='font-medium'>SHA-256</dd>
                </div>
              </dl>
              <p className='rounded-lg border border-dashed p-3 text-xs text-muted-foreground'>
                <Lock className='me-1 inline size-3.5' />
                会话、令牌、Telegram 验证码与安全事件不会进入归档。
              </p>
            </CardContent>
            <CardFooter>
              <Button
                className='w-full'
                onClick={handleDownload}
                disabled={downloading}
              >
                {downloading ? (
                  <Loader2 className='animate-spin' />
                ) : (
                  <Download />
                )}
                {downloading ? '正在打包…' : `下载 ${formatLabel(format)}`}
              </Button>
            </CardFooter>
          </Card>
        </div>

        <Card className='mt-4'>
          <CardHeader>
            <CardTitle>数据集清单</CardTitle>
            <CardDescription>
              当前范围共 {datasets.length} 个数据集、{formatCount(records)}{' '}
              条记录。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>数据集</TableHead>
                  <TableHead>键名</TableHead>
                  <TableHead>归类</TableHead>
                  <TableHead className='text-right'>记录数</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {datasets.map((dataset) => (
                  <TableRow key={dataset.key}>
                    <TableCell className='font-medium'>
                      {dataset.label}
                    </TableCell>
                    <TableCell>
                      <code className='text-xs text-muted-foreground'>
                        data/{dataset.key}.json
                      </code>
                    </TableCell>
                    <TableCell>
                      {dataset.knowledge ? (
                        <Badge variant='secondary'>知识库</Badge>
                      ) : (
                        <Badge variant='outline'>活动数据</Badge>
                      )}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {formatCount(dataset.records)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className='mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2'>
          <Card>
            <CardHeader>
              <CardTitle>归档结构</CardTitle>
              <CardDescription>openfactory.archive.v1</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className='overflow-x-auto rounded-lg bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground'>
                {`openfactory-archive-YYYY-MM-DD.zip
├── manifest.json      # 元数据、数据集清单、统计
├── README.md          # 恢复与校验说明
├── checksums.sha256   # 每个文件的 SHA-256
└── data/
    ├── profile.json
    ├── repositories.json
    └── …`}
              </pre>
              <p className='mt-3 text-xs text-muted-foreground'>
                校验：<code>sha256sum -c checksums.sha256</code>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>隐私边界</CardTitle>
              <CardDescription>以下数据永不进入归档。</CardDescription>
            </CardHeader>
            <CardContent className='space-y-2 text-sm'>
              {EXCLUDED_DATA.map((item) => (
                <div key={item} className='flex items-center gap-2'>
                  <ShieldCheck className='size-4 text-emerald-600' />
                  <span>{item}</span>
                </div>
              ))}
              <p className='pt-2 text-xs text-muted-foreground'>
                归档文件由浏览器直接保存，平台不保留副本；请自行按组织的数据保留策略保管。
              </p>
            </CardContent>
          </Card>
        </div>

        <p className='mt-4 text-xs text-muted-foreground'>
          统计生成于 {new Date(summary.generatedAt).toLocaleString('zh-CN')}
          。归档为只读操作，不会写入或修改任何数据。
        </p>
      </Main>
    </>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className='py-4'>
      <CardContent className='px-4'>
        <div className='text-xs text-muted-foreground'>{label}</div>
        <div className='mt-1 text-2xl font-semibold tracking-tight'>
          {value}
        </div>
      </CardContent>
    </Card>
  )
}
