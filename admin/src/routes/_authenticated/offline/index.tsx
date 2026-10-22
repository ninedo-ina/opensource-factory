import { createFileRoute } from '@tanstack/react-router'
import { OfflineData } from '@/features/offline'

export const Route = createFileRoute('/_authenticated/offline/')({
  component: OfflineData,
})
