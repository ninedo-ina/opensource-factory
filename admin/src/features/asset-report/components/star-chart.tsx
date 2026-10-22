import { useId } from 'react'
import type { AssetStarPoint } from '../api'
import {
  buildAreaPath,
  buildLinePath,
  buildPolylinePoints,
  dateLabel,
  formatCompactNumber,
  formatSignedNumber,
} from '../utils'

interface StarChartProps {
  series: readonly AssetStarPoint[]
}

const WIDTH = 800
const HEIGHT = 260
const PADDING = 24

/** Star 快照趋势：按日快照的收藏仓库总 Star 面积图 */
export function StarChart({ series }: StarChartProps) {
  const gradientId = useId()
  const values = series.map((point) => point.totalStars)
  const points = buildPolylinePoints(values, WIDTH, HEIGHT, PADDING)
  const linePath = buildLinePath(points)
  const areaPath = buildAreaPath(points, HEIGHT, PADDING)
  const first = series[0]
  const middle = series[Math.floor(series.length / 2)]
  const last = series[series.length - 1]
  const max = values.length > 0 ? Math.max(...values) : 0
  const min = values.length > 0 ? Math.min(...values) : 0
  const span = max - min || 1

  if (series.length === 0) {
    return (
      <div className='flex h-56 flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-4 text-center text-sm text-muted-foreground'>
        <span>暂无 Star 历史快照</span>
        <span className='text-xs'>
          收藏仓库进入每日热榜后，这里会展示真实 Star 趋势；当前只展示收录量与 Star 存量。
        </span>
      </div>
    )
  }

  return (
    <figure className='w-full'>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role='img'
        aria-label={`Star 快照趋势，共 ${series.length} 个快照日，期末 ${formatCompactNumber(last?.totalStars ?? 0)} Star`}
        className='h-64 w-full text-[#2a78d6] dark:text-[#3987e5]'
      >
        <defs>
          <linearGradient id={gradientId} x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0%' stopColor='currentColor' stopOpacity='0.28' />
            <stop offset='100%' stopColor='currentColor' stopOpacity='0' />
          </linearGradient>
        </defs>

        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = PADDING + ratio * (HEIGHT - PADDING * 2)
          const value = max - ratio * span
          return (
            <g key={ratio}>
              <line
                x1={PADDING}
                x2={WIDTH - PADDING}
                y1={y}
                y2={y}
                className='stroke-muted-foreground/20'
                strokeDasharray={ratio === 1 ? '0' : '4 6'}
              />
              <text
                x={PADDING - 6}
                y={y + 3}
                textAnchor='end'
                className='fill-muted-foreground text-[10px]'
              >
                {formatCompactNumber(Math.round(value))}
              </text>
            </g>
          )
        })}

        {areaPath && (
          <path d={areaPath} fill={`url(#${gradientId})`} stroke='none' />
        )}
        {linePath && (
          <path
            d={linePath}
            fill='none'
            stroke='currentColor'
            strokeWidth={2.4}
            strokeLinecap='round'
            strokeLinejoin='round'
          />
        )}
        {points.map((point, index) => {
          const day = series[index]
          if (!day) return null
          return (
            <circle
              key={day.date}
              cx={point.x}
              cy={point.y}
              r={2.2}
              fill='currentColor'
              opacity={0.9}
            >
              <title>{`${day.date}：${formatCompactNumber(day.totalStars)} Star · 当日净增 ${formatSignedNumber(day.starGain)}`}</title>
            </circle>
          )
        })}

        {first && middle && last && (
          <g className='fill-muted-foreground text-[10px]'>
            <text x={PADDING} y={HEIGHT - 6} textAnchor='start'>
              {dateLabel(first.date)}
            </text>
            <text x={WIDTH / 2} y={HEIGHT - 6} textAnchor='middle'>
              {dateLabel(middle.date)}
            </text>
            <text x={WIDTH - PADDING} y={HEIGHT - 6} textAnchor='end'>
              {dateLabel(last.date)}
            </text>
          </g>
        )}
      </svg>
      <figcaption className='mt-1 flex items-center justify-between text-xs text-muted-foreground'>
        <span>有快照仓库的每日总 Star（不补零）</span>
        <span>期末 {formatCompactNumber(last?.totalStars ?? 0)} Star</span>
      </figcaption>
    </figure>
  )
}
