import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchDataQuality,
  fixDataQuality,
  ignoreQualityIssues,
  restoreQualityIssues,
  scanDataQuality,
} from './api'
import {
  fieldLabel,
  filterIssues,
  formatTime,
  isFixable,
  issueTypeCounts,
  linkCheckLabel,
  modeLabel,
  scoreGrade,
  scoreLabel,
  severityLabel,
  statusLabel,
  summaryText,
  typeLabel,
  type QualityIssue,
} from './utils'

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }))

vi.mock('@/lib/api', () => ({
  apiFetch: mocks.apiFetch,
}))

function issue(overrides: Partial<QualityIssue> = {}): QualityIssue {
  return {
    id: 'dq_1',
    repoId: 'demo/a',
    repoName: 'demo/a',
    repoUrl: 'https://github.com/demo/a',
    type: 'missing_metadata',
    severity: 'warning',
    field: 'description',
    title: '缺少项目简介',
    detail: '简介为空',
    suggestion: '补全元数据',
    status: 'open',
    detectedAt: '2026-10-22T09:00:00Z',
    resolvedAt: null,
    ...overrides,
  }
}

describe('数据质量工具函数', () => {
  it('类型 / 级别 / 状态 / 模式标签', () => {
    expect(typeLabel('duplicate')).toBe('重复条目')
    expect(typeLabel('broken_link')).toBe('失效链接')
    expect(typeLabel('missing_metadata')).toBe('元数据缺失')
    expect(typeLabel('stale_metadata')).toBe('元数据陈旧')
    expect(severityLabel('critical')).toBe('严重')
    expect(severityLabel('warning')).toBe('警告')
    expect(severityLabel('info')).toBe('提示')
    expect(statusLabel('open')).toBe('待处理')
    expect(statusLabel('ignored')).toBe('已忽略')
    expect(statusLabel('fixed')).toBe('已修复')
    expect(modeLabel('hybrid')).toContain('VPS')
    expect(modeLabel('local')).toContain('本地')
    expect(linkCheckLabel('ok')).toContain('已检测')
    expect(linkCheckLabel('failed')).toContain('降级')
  })

  it('质量分档位', () => {
    expect(scoreGrade(95)).toBe('excellent')
    expect(scoreGrade(80)).toBe('good')
    expect(scoreGrade(65)).toBe('attention')
    expect(scoreGrade(20)).toBe('poor')
    expect(scoreLabel(95)).toBe('优秀')
    expect(scoreLabel(20)).toBe('较差')
  })

  it('字段名与时间格式化', () => {
    expect(fieldLabel('description')).toBe('项目简介')
    expect(fieldLabel('synced_at')).toBe('同步时间')
    expect(fieldLabel(null)).toBe('元数据')
    expect(formatTime('')).toBe('—')
    expect(formatTime('2026-10-22T09:00:00Z')).not.toBe('—')
  })

  it('按状态与类型过滤', () => {
    const issues = [
      issue(),
      issue({ id: 'dq_2', status: 'ignored' }),
      issue({ id: 'dq_3', type: 'broken_link', severity: 'critical' }),
    ]
    expect(filterIssues(issues, 'open', 'all').map((item) => item.id)).toEqual([
      'dq_1',
      'dq_3',
    ])
    expect(filterIssues(issues, 'ignored', 'all').map((item) => item.id)).toEqual([
      'dq_2',
    ])
    expect(filterIssues(issues, 'all', 'broken_link').map((item) => item.id)).toEqual([
      'dq_3',
    ])
  })

  it('可补全判定与类型计数', () => {
    expect(isFixable(issue())).toBe(true)
    expect(isFixable(issue({ field: 'category' }))).toBe(false)
    expect(isFixable(issue({ status: 'ignored' }))).toBe(false)
    expect(
      issueTypeCounts({
        duplicate: 1,
        broken_link: 0,
        missing_metadata: 2,
        stale_metadata: 1,
      })
    ).toEqual([
      { type: 'duplicate', count: 1 },
      { type: 'missing_metadata', count: 2 },
      { type: 'stale_metadata', count: 1 },
    ])
  })

  it('汇总文案包含分级计数', () => {
    const text = summaryText({
      score: 80,
      open: 5,
      critical: 1,
      warning: 3,
      info: 1,
      fixed: 0,
      ignored: 0,
      byType: {
        duplicate: 1,
        broken_link: 1,
        missing_metadata: 2,
        stale_metadata: 1,
      },
      lastScanAt: null,
      scanned: 10,
    })
    expect(text).toContain('5')
    expect(text).toContain('严重 1')
    expect(text).toContain('警告 3')
  })
})

describe('数据质量 API 客户端', () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset()
    mocks.apiFetch.mockResolvedValue({})
  })

  it('GET 携带状态 / 类型 / 条数参数', async () => {
    await fetchDataQuality({ status: 'ignored', type: 'duplicate', limit: 50 })
    expect(mocks.apiFetch).toHaveBeenCalledWith(
      '/api/data-quality?status=ignored&type=duplicate&limit=50'
    )
  })

  it('扫描默认开启链接检测', async () => {
    await scanDataQuality({ maxRepos: 100 })
    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/data-quality/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkLinks: true, maxRepos: 100 }),
    })
  })

  it('补全携带仓库与字段', async () => {
    await fixDataQuality({ repoIds: ['demo/a'], fields: ['language'] })
    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/data-quality/fix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoIds: ['demo/a'], fields: ['language'] }),
    })
  })

  it('忽略 / 恢复使用批量接口', async () => {
    await ignoreQualityIssues(['dq_1', 'dq_2'])
    expect(mocks.apiFetch).toHaveBeenCalledWith(
      '/api/data-quality/issues/ignore',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueIds: ['dq_1', 'dq_2'] }),
      }
    )
    await restoreQualityIssues(['dq_1'])
    expect(mocks.apiFetch).toHaveBeenCalledWith(
      '/api/data-quality/issues/restore',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueIds: ['dq_1'] }),
      }
    )
  })

  it('接口失败时回退演示数据', async () => {
    mocks.apiFetch.mockRejectedValue(new Error('offline'))
    const view = await fetchDataQuality({ status: 'open' })
    expect(view.summary.open).toBeGreaterThan(0)
    expect(view.issues.length).toBeGreaterThan(0)
    const scan = await scanDataQuality()
    expect(scan.mode).toBe('local')
    expect(scan.linkCheck).toBe('skipped')
  })
})
