import { useMemo, useState } from 'react'
import { area, extent, line, scaleLinear, scaleTime, timeFormat } from 'd3'
import { XAxis, YAxis } from './Axes'
import { ChartTooltip, useTooltip } from './ChartTooltip'
import { rollingNormalParams } from '../../domain/irr/stats'
import styles from './charts.module.css'

const W = 720
const H = 280
const M = { top: 16, right: 24, bottom: 34, left: 56 }
const fmtDate = timeFormat('%b %d')

interface NormalParamsChartProps {
  /** Daily dates, parallel to `values`. */
  dates: string[]
  /** Daily observations (TIR or avg days). */
  values: number[]
  title: string
  caption?: string
  formatValue: (value: number) => string
}

/**
 * Graphs the normal-fit parameters as they evolve day by day: the cumulative
 * mean (μ) line wrapped in a ±σ band. Shows how the daily distribution
 * settles as more closed trades accumulate.
 */
export function NormalParamsChart({
  dates,
  values,
  title,
  caption,
  formatValue,
}: NormalParamsChartProps) {
  const { tooltip, show, hide } = useTooltip()
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const data = useMemo(() => {
    const params = rollingNormalParams(values)
    return params
      .map((p, i) => ({
        date: dates[i],
        t: new Date(dates[i]),
        mean: p.mean,
        std: p.std,
        lo: p.mean - p.std,
        hi: p.mean + p.std,
      }))
      .sort((a, b) => a.t.getTime() - b.t.getTime())
  }, [dates, values])

  if (data.length === 0) return <p className={styles.empty}>No data for {title}.</p>

  const [t0, t1] = extent(data, (d) => d.t) as [Date, Date]
  const x = scaleTime().domain([t0, t1]).range([M.left, W - M.right])
  const y = scaleLinear()
    .domain([
      Math.min(...data.map((d) => d.lo)),
      Math.max(...data.map((d) => d.hi)),
    ])
    .nice()
    .range([H - M.bottom, M.top])

  const bandPath =
    area<(typeof data)[number]>()
      .x((d) => x(d.t))
      .y0((d) => y(d.lo))
      .y1((d) => y(d.hi))(data) ?? ''
  const meanPath =
    line<(typeof data)[number]>()
      .x((d) => x(d.t))
      .y((d) => y(d.mean))(data) ?? ''

  return (
    <figure className={styles.figure}>
      <p className={styles.chartTitle}>{title}</p>
      {caption && <p className={styles.chartCaption}>{caption}</p>}
      <div className={styles.chartFrame}>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`${title} rolling normal parameters`}
      >
        <path className={styles.sigmaBand} d={bandPath} />
        {hoverIdx !== null && (
          <line
            className={styles.hoverGuide}
            x1={x(data[hoverIdx].t)}
            x2={x(data[hoverIdx].t)}
            y1={M.top}
            y2={H - M.bottom}
          />
        )}
        <path className={styles.meanLine} d={meanPath} />
        {data.map((d, i) => (
          <circle
            key={d.date}
            className={i === hoverIdx ? styles.dotActive : styles.dot}
            cx={x(d.t)}
            cy={y(d.mean)}
            r={i === hoverIdx ? 3.5 : 2}
            fill="var(--color-primary, #0969da)"
          />
        ))}
        <XAxis scale={x} top={H - M.bottom} ticks={7} format={fmtDate} />
        <YAxis scale={y} left={M.left} ticks={5} format={(v) => formatValue(v as number)} />
        {/* Transparent hover bands — one per day, splitting the gaps. */}
        {data.map((d, i) => {
          const px = x(d.t)
          const left = i === 0 ? M.left : (x(data[i - 1].t) + px) / 2
          const right =
            i === data.length - 1 ? W - M.right : (px + x(data[i + 1].t)) / 2
          return (
            <rect
              key={`hit-${d.date}`}
              className={styles.hitArea}
              x={left}
              y={M.top}
              width={Math.max(0, right - left)}
              height={H - M.bottom - M.top}
              onMouseEnter={() => {
                setHoverIdx(i)
                show({
                  xPct: (px / W) * 100,
                  yPct: (y(d.hi) / H) * 100,
                  title: d.date,
                  rows: [
                    { label: 'Mean (μ)', value: formatValue(d.mean) },
                    { label: 'Std (σ)', value: formatValue(d.std) },
                  ],
                })
              }}
              onMouseLeave={() => {
                setHoverIdx(null)
                hide()
              }}
            />
          )
        })}
      </svg>
      <ChartTooltip tooltip={tooltip} />
      </div>
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.swatch} style={{ background: 'var(--color-primary, #0969da)' }} />
          Cumulative mean (μ)
        </span>
        <span className={styles.legendItem}>
          <span
            className={styles.swatch}
            style={{ background: 'var(--color-primary, #0969da)', opacity: 0.3, height: 10 }}
          />
          ±1 standard deviation (σ)
        </span>
      </div>
    </figure>
  )
}
