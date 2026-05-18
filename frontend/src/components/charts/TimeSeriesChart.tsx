import { useMemo } from 'react'
import { extent, line, scaleLinear, scaleTime, timeFormat } from 'd3'
import { XAxis, YAxis } from './Axes'
import styles from './charts.module.css'

const W = 720
const H = 300
const M = { top: 16, right: 56, bottom: 34, left: 56 }
const fmtDate = timeFormat('%b %d')

export interface TimeSeriesPoint {
  date: string
  tir: number
  avgDays: number
}

interface TimeSeriesChartProps {
  points: TimeSeriesPoint[]
  title: string
  caption?: string
}

/**
 * Dual-axis daily series: annualized TIR (left, %) and average holding days
 * (right) plotted against the close date.
 */
export function TimeSeriesChart({ points, title, caption }: TimeSeriesChartProps) {
  const data = useMemo(
    () =>
      points
        .map((p) => ({ ...p, t: new Date(p.date) }))
        .sort((a, b) => a.t.getTime() - b.t.getTime()),
    [points],
  )

  if (data.length === 0) return <p className={styles.empty}>No data for {title}.</p>

  const [t0, t1] = extent(data, (d) => d.t) as [Date, Date]
  const x = scaleTime().domain([t0, t1]).range([M.left, W - M.right])

  const tirVals = data.map((d) => d.tir)
  const yTir = scaleLinear()
    .domain([Math.min(0, ...tirVals), Math.max(0, ...tirVals)])
    .nice()
    .range([H - M.bottom, M.top])

  const yDays = scaleLinear()
    .domain([0, Math.max(1, ...data.map((d) => d.avgDays))])
    .nice()
    .range([H - M.bottom, M.top])

  const tirPath =
    line<(typeof data)[number]>()
      .x((d) => x(d.t))
      .y((d) => yTir(d.tir))(data) ?? ''
  const daysPath =
    line<(typeof data)[number]>()
      .x((d) => x(d.t))
      .y((d) => yDays(d.avgDays))(data) ?? ''

  return (
    <figure className={styles.figure}>
      <p className={styles.chartTitle}>{title}</p>
      {caption && <p className={styles.chartCaption}>{caption}</p>}
      <svg
        className={styles.chart}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`${title} time series`}
      >
        <line
          className={styles.gridLine}
          x1={M.left}
          x2={W - M.right}
          y1={yTir(0)}
          y2={yTir(0)}
        />
        <path className={styles.lineTir} d={tirPath} />
        <path className={styles.lineDays} d={daysPath} />
        {data.map((d) => (
          <circle
            key={`tir-${d.date}`}
            className={styles.dot}
            cx={x(d.t)}
            cy={yTir(d.tir)}
            r={2.25}
            fill="var(--color-primary, #0969da)"
          >
            <title>{`${d.date} · TIR ${(d.tir * 100).toFixed(1)}%`}</title>
          </circle>
        ))}
        {data.map((d) => (
          <circle
            key={`days-${d.date}`}
            className={styles.dot}
            cx={x(d.t)}
            cy={yDays(d.avgDays)}
            r={2.25}
            fill="var(--color-success, #1a7f37)"
          >
            <title>{`${d.date} · ${d.avgDays.toFixed(1)} days`}</title>
          </circle>
        ))}
        <XAxis scale={x} top={H - M.bottom} ticks={7} format={fmtDate} />
        <YAxis
          scale={yTir}
          left={M.left}
          ticks={5}
          format={(v) => `${Math.round((v as number) * 100)}%`}
        />
        <YAxis scale={yDays} left={W - M.right} orient="right" ticks={5} />
      </svg>
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.swatch} style={{ background: 'var(--color-primary, #0969da)' }} />
          Daily TIR (left)
        </span>
        <span className={styles.legendItem}>
          <span className={styles.swatch} style={{ background: 'var(--color-success, #1a7f37)' }} />
          Avg holding days (right)
        </span>
      </div>
    </figure>
  )
}
