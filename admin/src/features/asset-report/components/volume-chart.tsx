import { useId } from 'react'
import type { AssetVolumeMonth } from '../api'
import {
  buildBarLayout,
  buildLinePath,
  buildPolylinePoints,
  formatCompactNumber,
  formatNumber,
  monthLabel,
} from '../utils'

interface VolumeChartProps {
  months: readonly AssetVolumeMonth[]
}

const WIDTH = 800
const HEIGHT = 280
const PADDING = { top: 20, right: 24, bottom: 34, left: 44 }

/** 收录量柱线图：柱为月度新增，线为累计收录（右轴独立归一） */
export function VolumeChart({ months }: VolumeChartProps) {
  const gradientId = useId()
  const bars = buildBarLayout(
    months.map((month) => month.added),
    WIDTH,
    HEIGHT,
    PADDING
  )
  const cumulative = months.map((month) => month.cumulative)
  const linePoints = buildPolylinePoints(
    cumulative,
    WIDTH,
    HEIGHT,
    PADDING.left
  )
  const linePath = buildLinePath(linePoints)
  const maxAdded = Math.max(1, ...months.map((month) => month.added))
  const labelStep = Math.max(1, Math.ceil(months.length / 6))
  const innerHeight = HEIGHT - PADDING.top - PADDING.bottom
  const last = months[months.length - 1]

  if (months.length === 0) {
    return (
      <div className='flex h-56 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground'>
        暂无收录量数据。
      </div>
    )
  }

  return (
    <figure className='w-full'>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role='img'
        aria-label={`近 ${months.length} 个月收录量：累计 ${last?.cumulative ?? 0} 个仓库`}
        className='h-72 w-full text-[#2a78d6] dark:text-[#3987e5]'
      >
        <defs>
          <linearGradient id={gradientId} x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0%' stopColor='currentColor' stopOpacity='0.35' />
            <stop offset='100%' stopColor='currentColor' stopOpacity='0.08' />
          </linearGradient>
        </defs>

        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = PADDING.top + ratio * innerHeight
          return (
            <g key={ratio}>
              <line
                x1={PADDING.left}
                x2={WIDTH - PADDING.right}
                y1={y}
                y2={y}
                className='stroke-muted-foreground/20'
                strokeDasharray={ratio === 1 ? '0' : '4 6'}
              />
              <text
                x={PADDING.left - 6}
                y={y + 3}
                textAnchor='end'
                className='fill-muted-foreground text-[10px]'
              >
                {formatCompactNumber(Math.round(maxAdded * (1 - ratio)))}
              </text>
            </g>
          )
        })}

        {bars.map((bar, index) => {
          const month = months[index]
          if (!month) return null
          return (
            <rect
              key={month.month}
              x={bar.x}
              y={bar.y}
              width={bar.width}
              height={Math.max(1, bar.height)}
              rx={2}
              fill={`url(#${gradientId})`}
              className='stroke-current'
              strokeOpacity={0.35}
            >
              <title>{`${monthLabel(month.month)}：新增 ${month.added} 个 · 累计 ${formatNumber(month.cumulative)} 个`}</title>
            </rect>
          )
        })}

        {linePath && (
          <path
            d={linePath}
            fill='none'
            stroke='#f59e0b'
            strokeWidth={2.2}
            strokeLinecap='round'
            strokeLinejoin='round'
          >
            <title>累计收录（独立比例）</title>
          </path>
        )}

        {months.map((month, index) => {
          if (index % labelStep !== 0 && index !== months.length - 1) return null
          const point = linePoints[index]
          return (
            <text
              key={month.month}
              x={point?.x ?? PADDING.left}
              y={HEIGHT - 8}
              textAnchor='middle'
              className='fill-muted-foreground text-[10px]'
            >
              {monthLabel(month.month)}
            </text>
          )
        })}
      </svg>
      <figcaption className='mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground'>
        <span className='inline-flex items-center gap-1.5'>
          <span className='inline-block size-2.5 rounded-sm bg-[#2a78d6]/70' aria-hidden='true' />
          月度新增（左轴）
        </span>
        <span className='inline-flex items-center gap-1.5'>
          <span className='inline-block h-0.5 w-4 bg-amber-500' aria-hidden='true' />
          累计收录（独立比例）
        </span>
        {last && <span>期末累计 {formatNumber(last.cumulative)} 个仓库</span>}
      </figcaption>
    </figure>
  )
}
