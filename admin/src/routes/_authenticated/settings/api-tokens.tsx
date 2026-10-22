import { createFileRoute } from '@tanstack/react-router'
import { ApiTokens } from '@/features/api-tokens'

export const Route = createFileRoute('/_authenticated/settings/api-tokens')({
  component: ApiTokens,
})
