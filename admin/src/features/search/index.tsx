import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ExternalLink,
  Flame,
  FolderGit2,
  History,
  Keyboard,
  Loader2,
  Search as SearchIcon,
  Sparkles,
  Star,
  Tag,
  X,
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
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import {
  fetchSearchSuggestions,
  searchRepositories,
  type SearchResponse,
  type SearchSuggestionItem,
} from './api'
import {
  addSearchHistory,
  clearSearchHistory,
  loadSearchHistory,
  removeSearchHistory,
  saveSearchHistory,
  type SearchHistoryEntry,
} from './history'
import {
  buildSuggestionGroups,
  flattenSuggestionGroups,
  nextSuggestionIndex,
  splitHighlight,
  type SuggestionOption,
} from './suggestions'
import {
  engineLabel,
  formatScore,
  isQueryValid,
  modeLabel,
  normalizeQuery,
  scopeLabel,
  understandingLabels,
  type SearchEngine,
  type SearchScope,
} from './utils'

const EXAMPLES = [
  '支持多租户的 NestJS 管理后台模板',
  '轻量级 Python 任务调度工具',
  '带实时协作的 React 富文本编辑器',
]

const SCOPES: SearchScope[] = ['all', 'my', 'trending']
const ENGINES: SearchEngine[] = ['semantic', 'fulltext']
const SUGGESTION_LIST_ID = 'search-suggestion-list'

const SHORTCUTS: Array<[string, string]> = [
  ['/', '聚焦检索框'],
  ['↑ / ↓', '移动建议高亮'],
  ['Enter', '选中建议或执行检索'],
  ['Esc', '关闭建议下拉'],
  ['Ctrl / ⌘ + Enter', '立即检索'],
  ['Alt + 1 / 2', '切换语义 / 全文检索'],
  ['?', '打开 / 关闭本面板'],
]

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export function SemanticSearch() {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<SearchScope>('all')
  const [engine, setEngine] = useState<SearchEngine>('semantic')
  const [result, setResult] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<SearchHistoryEntry[]>(() =>
    loadSearchHistory()
  )
  const [suggestions, setSuggestions] = useState<SearchSuggestionItem[]>([])
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const understood = result ? understandingLabels(result.understanding) : []

  const runSearch = useCallback(
    async (
      rawQuery: string,
      nextScope: SearchScope = scope,
      nextEngine: SearchEngine = engine
    ) => {
      const normalized = normalizeQuery(rawQuery)
      if (!isQueryValid(normalized)) {
        setError('请输入 1~200 个字符的检索内容')
        return
      }
      setQuery(normalized)
      setSuggestOpen(false)
      setActiveIndex(-1)
      setLoading(true)
      setError('')
      try {
        const response = await searchRepositories(
          {
            query: normalized,
            topK: 10,
            scope: nextScope,
          },
          nextEngine
        )
        setResult(response)
        setHistory((prev) => {
          const next = addSearchHistory(prev, {
            query: normalized,
            engine: nextEngine,
            scope: nextScope,
            at: Date.now(),
          })
          saveSearchHistory(next)
          return next
        })
      } catch {
        setError('检索失败，请稍后重试')
      } finally {
        setLoading(false)
      }
    },
    [scope, engine]
  )

  // 建议防抖：聚焦时为空查热门，输入后 200ms 查询；切换输入 / 失焦取消旧请求。
  useEffect(() => {
    if (!focused) return
    const controller = new AbortController()
    const timer = window.setTimeout(
      () => {
        setSuggestLoading(true)
        fetchSearchSuggestions(query, 8, controller.signal)
          .then((items) => {
            setSuggestions(items)
            setActiveIndex(-1)
          })
          .catch((err: unknown) => {
            if (!(err instanceof Error && err.name === 'AbortError')) {
              setSuggestions([])
            }
          })
          .finally(() => {
            if (!controller.signal.aborted) setSuggestLoading(false)
          })
      },
      query.trim() ? 200 : 0
    )
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query, focused])

  // 页面级快捷键：/ 聚焦、? 帮助、Ctrl/Cmd+Enter 检索、Alt+1/2 切换方式。
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return
      const target = event.target

      if (event.key === '/' && !isEditableTarget(target)) {
        event.preventDefault()
        inputRef.current?.focus()
        setSuggestOpen(true)
        return
      }
      if (event.key === '?' && !isEditableTarget(target)) {
        event.preventDefault()
        setShortcutsOpen((open) => !open)
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void runSearch(query)
        return
      }
      if (event.altKey && (event.key === '1' || event.key === '2')) {
        if (isEditableTarget(target) && target !== inputRef.current) return
        event.preventDefault()
        const nextEngine: SearchEngine =
          event.key === '1' ? 'semantic' : 'fulltext'
        setEngine(nextEngine)
        if (result) void runSearch(query, scope, nextEngine)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [runSearch, query, scope, result])

  const suggestionGroups = useMemo(
    () => buildSuggestionGroups(suggestions, history, query),
    [suggestions, history, query]
  )
  const suggestionOptions = useMemo(
    () => flattenSuggestionGroups(suggestionGroups),
    [suggestionGroups]
  )

  function selectOption(option: SuggestionOption) {
    setSuggestOpen(false)
    setActiveIndex(-1)
    if (option.kind === 'history') {
      const nextEngine = option.engine ?? engine
      const nextScope = option.scope ?? scope
      setEngine(nextEngine)
      setScope(nextScope)
      void runSearch(option.value, nextScope, nextEngine)
    } else {
      void runSearch(option.value, scope, engine)
    }
    inputRef.current?.focus()
  }

  function runHistory(entry: SearchHistoryEntry) {
    setEngine(entry.engine)
    setScope(entry.scope)
    void runSearch(entry.query, entry.scope, entry.engine)
  }

  function removeHistoryEntry(queryToRemove: string) {
    setHistory((prev) => {
      const next = removeSearchHistory(prev, queryToRemove)
      saveSearchHistory(next)
      return next
    })
  }

  function clearAllHistory() {
    setHistory(clearSearchHistory())
    setSuggestOpen(false)
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSuggestOpen(true)
      setActiveIndex((current) =>
        nextSuggestionIndex(current, 1, suggestionOptions.length)
      )
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSuggestOpen(true)
      setActiveIndex((current) =>
        nextSuggestionIndex(current, -1, suggestionOptions.length)
      )
      return
    }
    if (event.key === 'Escape') {
      if (suggestOpen) {
        event.preventDefault()
        setSuggestOpen(false)
        setActiveIndex(-1)
      }
      return
    }
    if (event.key === 'Enter' && suggestOpen && activeIndex >= 0) {
      const option = suggestionOptions[activeIndex]
      if (option) {
        event.preventDefault()
        selectOption(option)
      }
    }
  }

  function highlightLabel(label: string) {
    return splitHighlight(label, query).map((part, index) =>
      part.match ? (
        <mark
          key={index}
          className='rounded-sm bg-primary/15 px-0.5 text-inherit'
        >
          {part.text}
        </mark>
      ) : (
        <span key={index}>{part.text}</span>
      )
    )
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
        <div className='mb-6 space-y-1'>
          <h2 className='flex items-center gap-2 text-2xl font-bold tracking-tight'>
            <Sparkles className='size-6 text-violet-500' />
            项目搜索
          </h2>
          <p className='text-sm text-muted-foreground'>
            用自然语言做语义匹配，或用关键词检索 README
            全文，覆盖「我的仓库」与「每日热榜」。
          </p>
        </div>

        <Card className='mb-4'>
          <CardContent className='space-y-4 pt-6'>
            <form
              className='flex flex-col gap-2 sm:flex-row'
              onSubmit={(event) => {
                event.preventDefault()
                void runSearch(query)
              }}
            >
              <div className='relative flex-1'>
                <Input
                  ref={inputRef}
                  value={query}
                  maxLength={200}
                  placeholder={
                    engine === 'fulltext'
                      ? '例如：分布式事务 支付网关'
                      : '例如：支持多租户的 NestJS 管理后台模板'
                  }
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setSuggestOpen(true)
                    setActiveIndex(-1)
                  }}
                  onFocus={() => {
                    setFocused(true)
                    setSuggestOpen(true)
                  }}
                  onBlur={() => {
                    setFocused(false)
                    window.setTimeout(() => setSuggestOpen(false), 120)
                  }}
                  onKeyDown={handleInputKeyDown}
                  aria-label={
                    engine === 'fulltext' ? '全文检索查询' : '语义搜索查询'
                  }
                  role='combobox'
                  aria-expanded={suggestOpen}
                  aria-controls={SUGGESTION_LIST_ID}
                  aria-autocomplete='list'
                  aria-activedescendant={
                    suggestOpen && activeIndex >= 0
                      ? `search-suggestion-${activeIndex}`
                      : undefined
                  }
                  autoComplete='off'
                  className='pe-8'
                />
                {suggestLoading && (
                  <Loader2 className='pointer-events-none absolute inset-e-2 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground' />
                )}

                {suggestOpen &&
                  (suggestionGroups.length > 0 || suggestLoading) && (
                    <div
                      id={SUGGESTION_LIST_ID}
                      role='listbox'
                      aria-label='搜索建议'
                      className='absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg'
                    >
                      <ScrollArea className='max-h-80'>
                        {suggestLoading && suggestionGroups.length === 0 && (
                          <div className='flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground'>
                            <Loader2 className='size-3 animate-spin' />
                            正在生成建议…
                          </div>
                        )}
                        {suggestionGroups.map((group) => (
                          <div key={group.key} className='py-1'>
                            <div className='flex items-center justify-between px-3 py-1 text-xs font-medium text-muted-foreground'>
                              <span>{group.title}</span>
                              {group.key === 'history' && (
                                <button
                                  type='button'
                                  className='hover:text-foreground'
                                  onClick={clearAllHistory}
                                >
                                  清空
                                </button>
                              )}
                            </div>
                            {group.options.map((option) => {
                              const index = suggestionOptions.findIndex(
                                (item) => item.key === option.key
                              )
                              const active = index === activeIndex
                              return (
                                <button
                                  key={option.key}
                                  id={`search-suggestion-${index}`}
                                  type='button'
                                  role='option'
                                  aria-selected={active}
                                  className={cn(
                                    'flex w-full items-start gap-2 px-3 py-2 text-left text-sm',
                                    active
                                      ? 'bg-accent text-accent-foreground'
                                      : 'hover:bg-accent/60'
                                  )}
                                  onMouseDown={(event) =>
                                    event.preventDefault()
                                  }
                                  onMouseEnter={() => setActiveIndex(index)}
                                  onClick={() => selectOption(option)}
                                >
                                  {option.kind === 'history' ? (
                                    <History className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
                                  ) : option.kind === 'tag' ? (
                                    <Tag className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
                                  ) : (
                                    <FolderGit2 className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
                                  )}
                                  <span className='min-w-0 flex-1'>
                                    <span className='block truncate font-medium'>
                                      {highlightLabel(option.label)}
                                    </span>
                                    {option.description && (
                                      <span className='block truncate text-xs text-muted-foreground'>
                                        {option.description}
                                      </span>
                                    )}
                                  </span>
                                  {option.kind === 'repo' && option.source && (
                                    <Badge
                                      variant='outline'
                                      className='shrink-0 text-[10px]'
                                    >
                                      {option.source === 'my' ? '我的' : '热榜'}
                                    </Badge>
                                  )}
                                  {option.kind === 'tag' && (
                                    <Badge
                                      variant='outline'
                                      className='shrink-0 text-[10px]'
                                    >
                                      标签
                                    </Badge>
                                  )}
                                </button>
                              )
                            })}
                          </div>
                        ))}
                      </ScrollArea>
                    </div>
                  )}
              </div>
              <Button type='submit' disabled={loading}>
                {loading ? (
                  <Loader2 className='me-1 size-4 animate-spin' />
                ) : (
                  <SearchIcon className='me-1 size-4' />
                )}
                搜索
              </Button>
            </form>

            {history.length > 0 && (
              <div className='flex flex-wrap items-center gap-2'>
                <span className='inline-flex items-center gap-1 text-xs text-muted-foreground'>
                  <History className='size-3' />
                  最近搜索：
                </span>
                {history.slice(0, 6).map((entry) => (
                  <span
                    key={entry.query}
                    className='inline-flex items-center overflow-hidden rounded-full border text-xs'
                  >
                    <button
                      type='button'
                      className='px-3 py-1 hover:bg-accent'
                      title={`${engineLabel(entry.engine)} · ${scopeLabel(entry.scope)}`}
                      onClick={() => runHistory(entry)}
                    >
                      {entry.query}
                    </button>
                    <button
                      type='button'
                      aria-label={`删除历史 ${entry.query}`}
                      className='border-l px-1.5 py-1 text-muted-foreground hover:bg-accent hover:text-foreground'
                      onClick={() => removeHistoryEntry(entry.query)}
                    >
                      <X className='size-3' />
                    </button>
                  </span>
                ))}
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  className='h-7 px-2 text-xs'
                  onClick={clearAllHistory}
                >
                  清空
                </Button>
              </div>
            )}

            <div className='flex flex-wrap items-center gap-2'>
              <span className='text-xs text-muted-foreground'>方式：</span>
              {ENGINES.map((item) => (
                <Button
                  key={item}
                  type='button'
                  size='sm'
                  variant={engine === item ? 'default' : 'outline'}
                  aria-keyshortcuts={item === 'semantic' ? 'Alt+1' : 'Alt+2'}
                  onClick={() => {
                    setEngine(item)
                    if (result) void runSearch(query, scope, item)
                  }}
                >
                  {engineLabel(item)}
                </Button>
              ))}
            </div>

            <div className='flex flex-wrap items-center gap-2'>
              <span className='text-xs text-muted-foreground'>范围：</span>
              {SCOPES.map((item) => (
                <Button
                  key={item}
                  type='button'
                  size='sm'
                  variant={scope === item ? 'default' : 'outline'}
                  onClick={() => {
                    setScope(item)
                    if (result) void runSearch(query, item)
                  }}
                >
                  {scopeLabel(item)}
                </Button>
              ))}
            </div>

            <div className='flex flex-wrap items-center gap-2'>
              <span className='text-xs text-muted-foreground'>试试：</span>
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type='button'
                  className='rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground'
                  onClick={() => void runSearch(example)}
                >
                  {example}
                </button>
              ))}
            </div>

            <div className='flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground'>
              <span className='inline-flex items-center gap-1'>
                <kbd className='rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]'>
                  /
                </kbd>
                聚焦检索
              </span>
              <span className='inline-flex items-center gap-1'>
                <kbd className='rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]'>
                  ↑ ↓
                </kbd>
                选择建议
              </span>
              <span className='inline-flex items-center gap-1'>
                <kbd className='rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]'>
                  Enter
                </kbd>
                检索
              </span>
              <button
                type='button'
                className='inline-flex items-center gap-1 hover:text-foreground'
                aria-expanded={shortcutsOpen}
                onClick={() => setShortcutsOpen((open) => !open)}
              >
                <Keyboard className='size-3' />
                全部快捷键
              </button>
            </div>

            {shortcutsOpen && (
              <div className='grid gap-2 rounded-md border bg-muted/30 p-3 text-xs sm:grid-cols-2'>
                {SHORTCUTS.map(([key, label]) => (
                  <div
                    key={key}
                    className='flex items-center justify-between gap-2'
                  >
                    <span className='text-muted-foreground'>{label}</span>
                    <kbd className='rounded border bg-background px-1.5 py-0.5 font-mono text-[11px]'>
                      {key}
                    </kbd>
                  </div>
                ))}
              </div>
            )}

            {error && <p className='text-sm text-destructive'>{error}</p>}
          </CardContent>
        </Card>

        {result && (
          <div className='mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground'>
            <Badge variant='secondary'>{modeLabel(result.mode)}</Badge>
            <span>
              共 {result.count} 条结果 · {result.tookMs} ms
              {result.model ? ` · ${result.model}` : ''}
              {result.dim ? ` · ${result.dim} 维` : ''}
            </span>
          </div>
        )}

        {understood.length > 0 && (
          <div className='mb-4 flex flex-wrap items-center gap-2 text-xs'>
            <span className='text-muted-foreground'>查询理解：</span>
            {understood.map((label) => (
              <Badge key={label} variant='outline'>
                {label}
              </Badge>
            ))}
          </div>
        )}

        <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
          {result?.items.map((item) => (
            <Card key={`${item.source}:${item.id}`} className='flex flex-col'>
              <CardHeader>
                <div className='flex items-start justify-between gap-2'>
                  <div className='min-w-0'>
                    <CardTitle className='truncate text-base'>
                      <a
                        href={item.url}
                        target='_blank'
                        rel='noreferrer'
                        className='hover:underline'
                      >
                        {item.fullName}
                      </a>
                    </CardTitle>
                    <CardDescription className='mt-1 line-clamp-3'>
                      {item.description || '暂无项目简介'}
                    </CardDescription>
                  </div>
                  <Badge className='shrink-0'>{formatScore(item.score)}</Badge>
                </div>
              </CardHeader>
              <CardContent className='flex flex-1 flex-col justify-between gap-4'>
                {item.snippet && (
                  <p className='rounded-md bg-muted/60 p-2 text-xs leading-relaxed text-muted-foreground'>
                    {item.snippet}
                  </p>
                )}
                <p className='text-sm text-muted-foreground'>{item.reason}</p>
                <div className='space-y-3'>
                  <div className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
                    <Badge variant='outline'>
                      {item.source === 'my' ? (
                        <FolderGit2 className='me-1 size-3' />
                      ) : (
                        <Flame className='me-1 size-3' />
                      )}
                      {item.source === 'my' ? '我的仓库' : '热榜'}
                    </Badge>
                    {item.language && (
                      <Badge variant='outline'>{item.language}</Badge>
                    )}
                    <span className='inline-flex items-center gap-1'>
                      <Star className='size-3' />
                      {item.stars.toLocaleString()}
                    </span>
                    {item.starsToday > 0 && (
                      <span className='inline-flex items-center gap-1'>
                        <Flame className='size-3' />
                        今日 +{item.starsToday}
                      </span>
                    )}
                  </div>
                  <Button size='sm' variant='outline' asChild>
                    <a href={item.url} target='_blank' rel='noreferrer'>
                      查看仓库
                      <ExternalLink className='ms-1 size-3' />
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}

          {result && result.items.length === 0 && (
            <Card className='md:col-span-2 xl:col-span-3'>
              <CardContent className='flex h-40 items-center justify-center text-muted-foreground'>
                没有找到匹配的项目，换个关键词或描述试试吧。
              </CardContent>
            </Card>
          )}
        </div>

        {!result && (
          <Card>
            <CardContent className='flex h-40 flex-col items-center justify-center gap-2 text-muted-foreground'>
              <SearchIcon className='size-6' />
              <p>输入自然语言描述或关键词开始检索，支持中文与英文。</p>
            </CardContent>
          </Card>
        )}
      </Main>
    </>
  )
}
