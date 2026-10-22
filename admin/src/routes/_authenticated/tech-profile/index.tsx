import { createFileRoute } from '@tanstack/react-router'
import { TechProfile } from '@/features/tech-profile'

export const Route = createFileRoute('/_authenticated/tech-profile/')({
  component: TechProfile,
})
