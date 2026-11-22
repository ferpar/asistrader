import { useMemo, useState, type MouseEvent } from 'react'
import { bisector, extent, line, scaleLinear, scaleTime, timeFormat } from 'd3'
import { XAxis, YAxis } from '../../components/charts/Axes'
import { ChartTooltip, useTooltip } from '../../components/charts/ChartTooltip'
import { fmtMoney } from '../../components/portfolio/format'
import type { PortfolioHistoryRow } from '../../domain/portfolio/types'
import styles from '../../components/charts/charts.module.css'

const W = 720
const H = 300
const M = { top: 16, right: 24, bottom: 34, left: 64 }

/** Series colours follow the measure, in the app's fixed categorical order. */
const SERIES = [
  { key: 'portfolioValue', label: 'Portfolio Value', color: 'var(--series-1)', width: 2 },
  { key: 'invested', label: 'Invested', color: 'var(--series-2)', width: 1.5 },
  { key: 'totalGain', label: 'Total Gain', color: 'var(--series-3)', width: 1.5 },
] as const

type Point = PortfolioHistoryRow & { t: Date }

const byTime = bisector<Point, Date>((p) => p.t).center

function compactMoney(value: number, ccy: string): string {
  if (ccy === 'GBp' || ccy === 'GBX') return `${value.toFixed(0)}p`
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: ccy || 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  })
}

/**
 * The Portfolio's money over time: Portfolio Value and Invested (capital
 * deployed) with Total Gain, all in Portfolio currency on one axis. Hovering
 * shows the day's figures.
 */
export function MoneyChart({ rows, currency }: { rows: PortfolioHistoryRow[]; currency: string }) {
  const { tooltip, show, hide } = useTooltip()
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const data = useMemo<Point[]>(() => rows.map((r) => ({ ...r, t: new Date(r.date) })), [rows])

  if (data.length === 0) return <p className={styles.empty}>No history yet. Record a Buy to start it.</p>

  const [t0, t1] = extent(data, (d) => d.t) as [Date, Date]
  const x = scaleTime().domain([t0, t1]).range([M.left, W - M.right])
  const pool = [0, ...data.flatMap((d) => SERIES.map((s) => d[s.key]))]
  const y = scaleLinear()
    .domain([Math.min(...pool), Math.max(...pool)])
    .nice()
    .range([H - M.bottom, M.top])
  const spanDays = (t1.getTime() - t0.getTime()) / 86_400_000
  const fmtTick = timeFormat(spanDays > 180 ? '%b %y' : '%b %d')

  const paths = SERIES.map((s) => ({
    ...s,
    d:
      line<Point>()
        .x((p) => x(p.t))
        .y((p) => y(p[s.key]))(data) ?? '',
  }))

  const onMove = (event: MouseEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const px = M.left + ((event.clientX - box.left) / box.width) * (W - M.left - M.right)
    const i = Math.min(data.length - 1, Math.max(0, byTime(data, x.invert(px))))
    if (i === hoverIdx) return
    const d = data[i]
    setHoverIdx(i)
    show({
      xPct: (x(d.t) / W) * 100,
      yPct: (y(d.portfolioValue) / H) * 100,
      title: d.date,
      rows: [
        ...SERIES.map((s) => ({ label: s.label, value: fmtMoney(d[s.key], currency) })),
        { label: 'Realized Gain', value: fmtMoney(d.realizedGain, currency) },
      ],
    })
  }

  const onLeave = () => {
    setHoverIdx(null)
    hide()
  }

  const hovered = hoverIdx === null ? null : data[hoverIdx]

  return (
    <figure className={styles.figure}>
      <p className={styles.chartTitle}>Money</p>
      <p className={styles.chartCaption}>
        Daily, in {currency}. Market holidays carry the last close forward.
      </p>
      <div className={styles.chartFrame}>
        <svg
          className={styles.chart}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`Portfolio Value, Invested and Total Gain from ${data[0].date} to ${data[data.length - 1].date}`}
        >
          <line className={styles.gridLine} x1={M.left} x2={W - M.right} y1={y(0)} y2={y(0)} />
          {hovered && (
            <line
              className={styles.hoverGuide}
              x1={x(hovered.t)}
              x2={x(hovered.t)}
              y1={M.top}
              y2={H - M.bottom}
            />
          )}
          {/* Drawn in reverse so Portfolio Value sits on top. */}
          {[...paths].reverse().map((p) => (
            <path key={p.key} d={p.d} fill="none" stroke={p.color} strokeWidth={p.width} />
          ))}
          {hovered &&
            SERIES.map((s) => (
              <circle
                key={`dot-${s.key}`}
                className={styles.dotActive}
                cx={x(hovered.t)}
                cy={y(hovered[s.key])}
                r={4}
                fill={s.color}
              />
            ))}
          <XAxis scale={x} top={H - M.bottom} ticks={7} format={fmtTick} />
          <YAxis scale={y} left={M.left} ticks={5} format={(v) => compactMoney(v as number, currency)} />
          <rect
            className={styles.hitArea}
            x={M.left}
            y={M.top}
            width={W - M.left - M.right}
            height={H - M.bottom - M.top}
            onMouseMove={onMove}
            onMouseLeave={onLeave}
          />
        </svg>
        <ChartTooltip tooltip={tooltip} />
      </div>
      <div className={styles.legend}>
        {SERIES.map((s) => (
          <span key={s.key} className={styles.legendItem}>
            <span className={styles.swatch} style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </figure>
  )
}
