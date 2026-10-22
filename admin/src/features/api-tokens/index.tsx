import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, KeyRound, Loader2, Plus, ShieldCheck, Trash2 } from 'lucide-react'
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
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { ContentSection } from '../settings/components/content-section'
import {
  createApiToken,
  fetchApiTokens,
  revokeApiToken,
  type ApiTokenItem,
  type ApiTokenScope,
  type CreateApiTokenResult,
} from './api'
import {
  buildCliLoginCommand,
  canCreateMore,
  formatDateTime,
  scopesLabel,
  tokenStatus,
  tokenStatusLabel,
} from './utils'

export function ApiTokens() {
  const queryClient = useQueryClient()
  const [label, setLabel] = useState('')
  const [scopes, setScopes] = useState<Record<ApiTokenScope, boolean>>({
    read: true,
    write: true,
  })
  const [created, setCreated] = useState<CreateApiTokenResult | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['api-tokens'],
    queryFn: fetchApiTokens,
  })
  const items = data?.items ?? []

  const createMutation = useMutation({
    mutationFn: createApiToken,
    onSuccess: (result) => {
      setCreated(result)
      setLabel('')
      toast.success('令牌已创建；明文只显示这一次，请立即复制保存')
      void queryClient.invalidateQueries({ queryKey: ['api-tokens'] })
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : '创建令牌失败')
    },
  })

  const revokeMutation = useMutation({
    mutationFn: revokeApiToken,
    onSuccess: () => {
      toast.success('令牌已撤销')
      void queryClient.invalidateQueries({ queryKey: ['api-tokens'] })
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : '撤销令牌失败')
    },
  })

  const selectedScopes = (): ApiTokenScope[] =>
    (['read', 'write'] as const).filter((scope) => scopes[scope])

  function handleCreate() {
    const selected = selectedScopes()
    if (selected.length === 0) {
      toast.error('请至少选择一种权限')
      return
    }
    if (!canCreateMore(items)) {
      toast.error('有效令牌数量已达上限（20 个），请先撤销不用的令牌')
      return
    }
    createMutation.mutate({
      label: label.trim() || undefined,
      scopes: selected,
    })
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('已复制到剪贴板')
    } catch {
      toast.error('复制失败，请手动选择文本复制')
    }
  }

  function handleRevoke(item: ApiTokenItem) {
    if (!window.confirm(`撤销令牌「${item.label}」？撤销后使用该令牌的 CLI 会立即失效。`)) {
      return
    }
    revokeMutation.mutate(item.id)
  }

  return (
    <ContentSection
      title='开放 API'
      desc='创建个人令牌，供 OpenFactory CLI 与脚本访问你的收藏数据。令牌只保存摘要，明文仅在创建时显示一次。'
    >
      <div className='space-y-6'>
        {created && (
          <Card className='border-emerald-500/40 bg-emerald-500/5'>
            <CardHeader>
              <CardTitle className='flex items-center gap-2 text-base'>
                <ShieldCheck className='size-4 text-emerald-600' />
                令牌创建成功
              </CardTitle>
              <CardDescription>
                这是唯一一次显示明文。关闭后无法再次查看，只能重新创建。
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-3'>
              <div className='flex items-center gap-2 rounded-md border bg-background p-2'>
                <code className='flex-1 break-all font-mono text-xs'>{created.token}</code>
                <Button
                  type='button'
                  size='icon'
                  variant='ghost'
                  aria-label='复制令牌'
                  onClick={() => void copyText(created.token)}
                >
                  <Copy className='size-4' />
                </Button>
              </div>
              <div className='space-y-1'>
                <p className='text-xs font-medium text-muted-foreground'>CLI 登录命令</p>
                <div className='flex items-center gap-2 rounded-md bg-muted p-2'>
                  <code className='flex-1 break-all font-mono text-xs'>
                    {buildCliLoginCommand(created.token)}
                  </code>
                  <Button
                    type='button'
                    size='icon'
                    variant='ghost'
                    aria-label='复制登录命令'
                    onClick={() => void copyText(buildCliLoginCommand(created.token))}
                  >
                    <Copy className='size-4' />
                  </Button>
                </div>
              </div>
              <Button type='button' variant='outline' size='sm' onClick={() => setCreated(null)}>
                我已保存，隐藏令牌
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2 text-base'>
              <KeyRound className='size-4' />
              创建令牌
            </CardTitle>
            <CardDescription>按用途命名，并遵循最小权限原则选择 scope。</CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='token-label'>名称</Label>
              <Input
                id='token-label'
                value={label}
                maxLength={60}
                placeholder='例如：我的笔记本 CLI'
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>
            <div className='space-y-2'>
              <Label>权限</Label>
              <div className='flex flex-wrap gap-4'>
                <label className='flex items-center gap-2 text-sm'>
                  <Checkbox
                    checked={scopes.read}
                    onCheckedChange={(checked) =>
                      setScopes((current) => ({ ...current, read: checked === true }))
                    }
                  />
                  读取（read）
                </label>
                <label className='flex items-center gap-2 text-sm'>
                  <Checkbox
                    checked={scopes.write}
                    onCheckedChange={(checked) =>
                      setScopes((current) => ({ ...current, write: checked === true }))
                    }
                  />
                  写入（write）
                </label>
              </div>
              <p className='text-xs text-muted-foreground'>
                写入权限包含收藏 / 取消收藏；只读令牌只能查询列表、详情、热榜与推荐。
              </p>
            </div>
            <Button type='button' onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? (
                <Loader2 className='size-4 animate-spin' />
              ) : (
                <Plus className='size-4' />
              )}
              创建令牌
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className='text-base'>我的令牌</CardTitle>
            <CardDescription>最近使用时间按分钟更新；撤销后立即失效。</CardDescription>
          </CardHeader>
          <CardContent className='space-y-3'>
            {isLoading && (
              <div className='flex items-center gap-2 text-sm text-muted-foreground'>
                <Loader2 className='size-4 animate-spin' />
                正在加载…
              </div>
            )}
            {!isLoading && items.length === 0 && (
              <p className='text-sm text-muted-foreground'>还没有创建令牌。</p>
            )}
            {items.map((item) => {
              const status = tokenStatus(item)
              return (
                <div key={item.id} className='rounded-md border p-3'>
                  <div className='flex items-start justify-between gap-2'>
                    <div className='min-w-0 space-y-1'>
                      <div className='flex flex-wrap items-center gap-2'>
                        <span className='text-sm font-medium'>{item.label}</span>
                        <Badge variant={status === 'active' ? 'secondary' : 'outline'}>
                          {tokenStatusLabel(status)}
                        </Badge>
                      </div>
                      <code className='block font-mono text-xs text-muted-foreground'>
                        {item.hint}
                      </code>
                      <p className='text-xs text-muted-foreground'>
                        权限：{scopesLabel(item.scopes)}
                      </p>
                      <p className='text-xs text-muted-foreground'>
                        创建：{formatDateTime(item.createdAt)} · 最近使用：
                        {formatDateTime(item.lastUsedAt)}
                      </p>
                    </div>
                    {status === 'active' && (
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon'
                        aria-label={`撤销令牌 ${item.label}`}
                        disabled={revokeMutation.isPending}
                        onClick={() => handleRevoke(item)}
                      >
                        <Trash2 className='size-4' />
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className='text-base'>CLI 使用</CardTitle>
            <CardDescription>零依赖 Node.js 18+，在仓库的 `cli/` 目录安装。</CardDescription>
          </CardHeader>
          <CardContent className='space-y-2'>
            <pre className='overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs'>
{`cd cli
npm link            # 或 node bin/of.js
of login --token ofp_…
of list
of search rust
of add owner/repo`}
            </pre>
            <Separator />
            <p className='text-xs text-muted-foreground'>
              令牌等同密码：不要提交到 Git、不要贴到聊天工具；怀疑泄露时立即在此页撤销。
            </p>
          </CardContent>
        </Card>
      </div>
    </ContentSection>
  )
}
