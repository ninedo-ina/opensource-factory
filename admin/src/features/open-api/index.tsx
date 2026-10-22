import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, KeyRound, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { DEMO_MODE } from '@/lib/api'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { ContentSection } from '../settings/components/content-section'
import {
  createOpenApiToken,
  fetchOpenApiTokens,
  revokeOpenApiToken,
  type CreateOpenApiTokenResult,
  type OpenApiScope,
  type OpenApiToken,
} from './api'
import {
  EXPIRY_OPTIONS,
  SCOPE_OPTIONS,
  expiryLabel,
  formatDateTime,
  scopesLabel,
  statusLabel,
  statusVariant,
  tokenStatus,
} from './utils'

function TokenRow({
  token,
  revoking,
  onRevoke,
}: {
  token: OpenApiToken
  revoking: boolean
  onRevoke: (token: OpenApiToken) => Promise<void>
}) {
  const status = tokenStatus(token)
  return (
    <div className='rounded-lg border p-3'>
      <div className='flex flex-wrap items-start justify-between gap-2'>
        <div className='min-w-0'>
          <div className='flex flex-wrap items-center gap-1.5'>
            <span className='truncate font-medium'>{token.label}</span>
            <Badge variant={statusVariant(status)}>{statusLabel(status)}</Badge>
            <Badge variant='outline'>{scopesLabel(token.scopes)}</Badge>
          </div>
          <code className='mt-1 block text-xs text-muted-foreground'>
            {token.hint}
          </code>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant='ghost'
              size='sm'
              className='text-muted-foreground hover:text-destructive'
              disabled={revoking || Boolean(token.revokedAt)}
            >
              {revoking ? (
                <Loader2 className='size-4 animate-spin' />
              ) : (
                <Trash2 className='size-4' />
              )}
              <span className='sr-only'>撤销令牌</span>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>撤销「{token.label}」？</AlertDialogTitle>
              <AlertDialogDescription>
                撤销后使用该令牌的脚本会立即收到 401，且无法恢复。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={() => void onRevoke(token)}>
                确认撤销
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      <div className='mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-3'>
        <span>创建：{formatDateTime(token.createdAt)}</span>
        <span>最近使用：{formatDateTime(token.lastUsedAt)}</span>
        <span>到期：{expiryLabel(token)}</span>
      </div>
    </div>
  )
}

export function SettingsOpenApi() {
  const queryClient = useQueryClient()
  const [label, setLabel] = useState('')
  const [scope, setScope] = useState<OpenApiScope>('read')
  const [expiryDays, setExpiryDays] = useState('90')
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<CreateOpenApiTokenResult | null>(null)
  const [copied, setCopied] = useState(false)
  const [revoking, setRevoking] = useState<string | null>(null)

  const tokensQuery = useQuery({
    queryKey: ['open-api-tokens'],
    queryFn: fetchOpenApiTokens,
  })
  const tokens = tokensQuery.data?.items ?? []
  const maxActive = tokensQuery.data?.maxActiveTokens ?? 20
  const activeCount = tokens.filter((token) => tokenStatus(token) === 'active').length

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    if (DEMO_MODE) {
      toast.info('演示模式：未连接边缘 API，令牌不会真正创建')
      return
    }
    setCreating(true)
    setCopied(false)
    try {
      const result = await createOpenApiToken({
        label: label.trim() || undefined,
        scopes: [scope],
        expiresInDays: Number.parseInt(expiryDays, 10),
      })
      setCreated(result)
      setLabel('')
      await queryClient.invalidateQueries({ queryKey: ['open-api-tokens'] })
      toast.success('令牌已创建，请立即复制保存')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建令牌失败')
    } finally {
      setCreating(false)
    }
  }

  async function handleCopy() {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.token)
      setCopied(true)
      toast.success('令牌已复制')
    } catch {
      toast.error('复制失败，请手动选择令牌文本')
    }
  }

  async function handleRevoke(token: OpenApiToken) {
    if (DEMO_MODE) {
      toast.info('演示模式：未连接边缘 API，令牌不会真正撤销')
      return
    }
    setRevoking(token.id)
    try {
      await revokeOpenApiToken(token.id)
      await queryClient.invalidateQueries({ queryKey: ['open-api-tokens'] })
      toast.success(`已撤销「${token.label}」`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '撤销令牌失败')
    } finally {
      setRevoking(null)
    }
  }

  return (
    <ContentSection
      title='开放 API'
      desc='创建个人令牌，让 CLI、脚本或第三方工具以你的身份访问收藏与推荐数据。'
    >
      <div className='space-y-4'>
        <Alert>
          <KeyRound className='size-4' />
          <AlertTitle>令牌只在创建时显示一次</AlertTitle>
          <AlertDescription>
            服务端仅保存 SHA-256 摘要。请把令牌保存在环境变量或密码管理器中，不要提交到 Git。
          </AlertDescription>
        </Alert>

        {created && (
          <Card className='border-primary/40'>
            <CardHeader className='pb-3'>
              <CardTitle className='text-base'>新令牌已生成</CardTitle>
              <CardDescription>
                复制后关闭此提示；离开页面后将无法再次查看明文。
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-2'>
              <div className='flex items-start gap-2'>
                <code className='min-w-0 flex-1 break-all rounded-md bg-muted p-2 text-xs'>
                  {created.token}
                </code>
                <Button type='button' size='sm' variant='outline' onClick={handleCopy}>
                  {copied ? <Check className='size-4' /> : <Copy className='size-4' />}
                  {copied ? '已复制' : '复制'}
                </Button>
              </div>
              <p className='text-xs text-muted-foreground'>
                使用方式：<code>Authorization: Bearer &lt;令牌&gt;</code>
              </p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className='pb-3'>
            <CardTitle className='text-base'>创建令牌</CardTitle>
            <CardDescription>
              当前有效令牌 {activeCount} / {maxActive}。建议按工具分别创建，便于单独撤销。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className='space-y-3' onSubmit={handleCreate}>
              <div className='space-y-1.5'>
                <Label htmlFor='open-api-label'>备注</Label>
                <Input
                  id='open-api-label'
                  value={label}
                  maxLength={60}
                  placeholder='例如：CLI 工具 / 自动化脚本'
                  onChange={(event) => setLabel(event.target.value)}
                />
              </div>
              <div className='grid gap-3 sm:grid-cols-2'>
                <div className='space-y-1.5'>
                  <Label>权限</Label>
                  <Select value={scope} onValueChange={(value) => setScope(value as OpenApiScope)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SCOPE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label} · {option.desc}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className='space-y-1.5'>
                  <Label>有效期</Label>
                  <Select value={expiryDays} onValueChange={setExpiryDays}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EXPIRY_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button type='submit' disabled={creating}>
                {creating ? (
                  <Loader2 className='size-4 animate-spin' />
                ) : (
                  <Plus className='size-4' />
                )}
                创建令牌
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className='space-y-2'>
          <div className='flex items-center justify-between'>
            <h4 className='text-sm font-medium'>已有令牌</h4>
            <span className='text-xs text-muted-foreground'>{tokens.length} 个</span>
          </div>
          <Separator />
          {tokensQuery.isLoading ? (
            <p className='py-6 text-center text-sm text-muted-foreground'>加载中…</p>
          ) : tokens.length === 0 ? (
            <p className='py-6 text-center text-sm text-muted-foreground'>
              还没有令牌，创建后即可通过开放 API 访问。
            </p>
          ) : (
            <div className='space-y-2'>
              {tokens.map((token) => (
                <TokenRow
                  key={token.id}
                  token={token}
                  revoking={revoking === token.id}
                  onRevoke={handleRevoke}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </ContentSection>
  )
}
