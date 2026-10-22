import { createFileRoute } from '@tanstack/react-router'
import { SettingsOpenApi } from '@/features/open-api'

export const Route = createFileRoute('/_authenticated/settings/api')({
  component: SettingsOpenApi,
})
