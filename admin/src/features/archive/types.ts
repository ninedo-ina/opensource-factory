export type ArchiveScope = 'full' | 'knowledge'
export type ArchiveFormat = 'zip' | 'json'

export interface ArchiveDatasetSummary {
  key: string
  label: string
  knowledge: boolean
  records: number
}

export interface ArchiveSummary {
  schema: string
  version: number
  generatedAt: string
  datasets: ArchiveDatasetSummary[]
  totalRecords: number
  estimatedBytes: number
  scopes: Array<{ key: ArchiveScope; label: string; datasets: number }>
  formats: ArchiveFormat[]
}

export interface ArchiveRequest {
  scope: ArchiveScope
  format: ArchiveFormat
}

export interface ArchiveDownload {
  blob: Blob
  fileName: string
}
