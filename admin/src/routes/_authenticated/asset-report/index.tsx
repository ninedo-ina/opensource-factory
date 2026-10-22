import { createFileRoute } from '@tanstack/react-router'
import { AssetReport } from '@/features/asset-report'

export const Route = createFileRoute('/_authenticated/asset-report/')({
  component: AssetReport,
})
