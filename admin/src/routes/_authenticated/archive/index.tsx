import { createFileRoute } from '@tanstack/react-router'
import { FullArchive } from '@/features/archive'

export const Route = createFileRoute('/_authenticated/archive/')({
  component: FullArchive,
})
