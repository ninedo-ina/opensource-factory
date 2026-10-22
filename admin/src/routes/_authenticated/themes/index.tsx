import { createFileRoute } from '@tanstack/react-router'
import { Themes } from '@/features/themes'

export const Route = createFileRoute('/_authenticated/themes/')({
  component: Themes,
})
