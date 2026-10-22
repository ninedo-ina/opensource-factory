import { createFileRoute } from '@tanstack/react-router'
import { DataQuality } from '@/features/data-quality'

export const Route = createFileRoute('/_authenticated/data-quality/')({
  component: DataQuality,
})
