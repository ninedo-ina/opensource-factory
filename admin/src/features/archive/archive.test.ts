import { describe, expect, it } from 'vitest'
import { downloadArchive, MOCK_ARCHIVE_SUMMARY } from './api'
import {
  fallbackArchiveFileName,
  formatBytes,
  formatCount,
  scopedRecordCount,
  visibleDatasets,
} from './utils'

describe('formatBytes', () => {
  it('formats byte sizes with sensible precision', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(15 * 1024)).toBe('15 KB')
  })
})

describe('formatCount', () => {
  it('uses 万 for large counts and keeps small numbers readable', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(34)).toBe('34')
    expect(formatCount(12000)).toBe('1.2 万')
    expect(formatCount(10000)).toBe('1 万')
  })
})

describe('archive scope helpers', () => {
  it('knowledge scope only exposes knowledge datasets', () => {
    const datasets = visibleDatasets(MOCK_ARCHIVE_SUMMARY, 'knowledge')
    expect(datasets.map((item) => item.key)).toEqual([
      'profile',
      'repositories',
      'categories',
      'tags',
    ])
    expect(scopedRecordCount(MOCK_ARCHIVE_SUMMARY, 'knowledge')).toBe(19)
  })

  it('full scope covers every dataset and matches totalRecords', () => {
    expect(visibleDatasets(MOCK_ARCHIVE_SUMMARY, 'full')).toHaveLength(11)
    expect(scopedRecordCount(MOCK_ARCHIVE_SUMMARY, 'full')).toBe(
      MOCK_ARCHIVE_SUMMARY.totalRecords
    )
  })

  it('builds predictable file names', () => {
    expect(fallbackArchiveFileName('zip', '2026-10-22T13:45:00.000Z')).toBe(
      'openfactory-archive-2026-10-22.zip'
    )
    expect(fallbackArchiveFileName('json', '2026-10-22T13:45:00.000Z')).toBe(
      'openfactory-archive-2026-10-22.json'
    )
  })
})

describe('demo archive download', () => {
  it('generates a JSON archive with manifest, checksums and data', async () => {
    const { blob, fileName } = await downloadArchive({
      scope: 'knowledge',
      format: 'json',
    })
    expect(fileName).toMatch(/^openfactory-archive-\d{4}-\d{2}-\d{2}\.json$/)
    const doc = JSON.parse(await blob.text())
    expect(doc.manifest.schema).toBe('openfactory.archive.v1')
    expect(doc.manifest.scope).toBe('knowledge')
    expect(doc.manifest.checksums.embedded).toBe(true)
    expect(doc.data.profile[0].login).toBe('fntp')
    expect(doc.data.recommendations).toBeUndefined()
    expect(doc.checksums['data/profile.json']).toMatch(/^[0-9a-f]{64}$/)
  })

  it('generates a ZIP archive with a PK signature', async () => {
    const { blob, fileName } = await downloadArchive({
      scope: 'full',
      format: 'zip',
    })
    expect(fileName).toMatch(/^openfactory-archive-\d{4}-\d{2}-\d{2}\.zip$/)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
    expect(bytes.length).toBeGreaterThan(100)
  })
})
