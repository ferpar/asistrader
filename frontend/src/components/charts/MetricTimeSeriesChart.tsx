import { useMemo, useState } from 'react'
import { extent, line, scaleLinear, scaleTime, timeFormat } from 'd3'
import { XAxis, YAxis } from './Axes'
import { ChartTooltip, useTooltip } from './ChartTooltip'
import styles from './charts.module.css'

const MAIN_COLOR = 'var(--color-primary, #0969da)'

const W = 720
const H = 300
const M = { top: 16, right: 24, bottom: 34, left: 56 }
const fmtDate = timeFormat('%b %d')

/** One moving-average overlay aligned 1:1 with `values`. */
export interface SmaOverlay {
  /** Display label (e.g. "SMA 7d"). */
  label: string
  /** Stroke color (CSS). */
  color: string
  /** Per-index SMA value; `null` where the window isn't full yet. */
  values: (number | null)[]
}

interface MetricTimeSeriesChartProps {
  /** Parallel arrays: one observation per date. */
  dates: string[]
  values: number[]
  /** Series label, shown in the legend and tooltip rows. */
  valueLabel: string
  /** Formats a y-axis tick and a tooltip value (e.g. percent, "12d"). */
  formatValue: (value: number) => string
  /** Zero or more SMA overlays. Each must be the same length as `values`. */
  smas?: SmaOverlay[]
  title: string
  caption?: string
}

/**
 * Single-axis daily series with optional moving-average overlays. The main
 * series renders as a line + dots; each SMA is a thinner line in its own
 * color, with null points breaking the path so the early "no data" stretch
 * stays blank.
 */
export function MetricTimeSeriesChart({
  dates,
  values,
  valueLabel,
  formatValue,
  smas = [],
  title,
  caption,
}: MetricTimeSeriesChartProps) {
  const { tooltip, show, hide } = useTooltip()
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const data = useMemo(
    () =>
      dates
        .map((d, i) => ({ date: d, t: new Date(d), value: values[i], idx: i }))
        .sort((a, b) => a.t.getTime() - b.t.getTime()),
    [dates, values],
  )

  if (data.length === 0) return <p className={styles.empty}>No data for {title}.</p>

  const [t0, t1] = extent(data, (d) => d.t) as [Date, Date]
  const x = scaleTime().domain([t0, t1]).range([M.left, W - M.right])

  // Y domain covers raw values and every SMA point that has a value, so the
  // overlays never clip outside the plot area.
  const yPool: number[] = [0, ...data.map((d) => d.value)]
  for (const s of smas) {
    for (const v of s.values) if (v !== null) yPool.push(v)
  }
  const y = scaleLinear()
    .domain([Math.min(...yPool), Math.max(...yPool)])
    .nice()
    .range([H - M.bottom, M.top])

  const mainPath =
    line<(typeof data)[number]>()
      .x((d) => x(d.t))
      .y((d) => y(d.value))(data) ?? ''

  // Build an SVG path per SMA, breaking on null so gaps stay open.
  const smaPaths = smas.map((s) => {
    const generator = line<{ t: Date; v: number | null }>()
      .defined((p) => p.v !== null)
      .x((p) => x(p.t))
      .y((p) => y(p.v as number))
    const aligned = data.map((d) => ({ t: d.t, v: s.values[d.idx] }))
    return generator(aligned) ?? ''
  })

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
          aria-label={`${title} time series`}
        >
          <line
            className={styles.gridLine}
            x1={M.left}
            x2={W - M.right}
            y1={y(0)}
            y2={y(0)}
          />
          {hoverIdx !== null && (
            <line
              className={styles.hoverGuide}
              x1={x(data[hoverIdx].t)}
              x2={x(data[hoverIdx].t)}
              y1={M.top}
              y2={H - M.bottom}
            />
          )}
          {/* SMA overlays drawn under the main series so dots sit on top. */}
          {smaPaths.map((d, i) => (
            <path
              key={`sma-${i}`}
              d={d}
              fill="none"
              stroke={smas[i].color}
              strokeWidth={1.5}
              strokeDasharray="5 3"
            />
          ))}
          <path
            d={mainPath}
            fill="none"
            stroke={MAIN_COLOR}
            strokeWidth={1.75}
          />
          {data.map((d, i) => (
            <circle
              key={`pt-${d.date}`}
              className={i === hoverIdx ? styles.dotActive : styles.dot}
              cx={x(d.t)}
              cy={y(d.value)}
              r={i === hoverIdx ? 3.75 : 2.25}
              fill={MAIN_COLOR}
            />
          ))}
          <XAxis scale={x} top={H - M.bottom} ticks={7} format={fmtDate} />
          <YAxis
            scale={y}
            left={M.left}
            ticks={5}
            format={(v) => formatValue(v as number)}
          />
          {/* Transparent hover bands — one per point, splitting the gaps. */}
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
                  const smaRows = smas
                    .map((s) => {
                      const v = s.values[d.idx]
                      return v === null
                        ? null
                        : { label: s.label, value: formatValue(v), color: s.color }
                    })
                    .filter((r): r is NonNullable<typeof r> => r !== null)
                  show({
                    xPct: (px / W) * 100,
                    yPct: (y(d.value) / H) * 100,
                    title: d.date,
                    rows: [
                      {
                        label: valueLabel,
                        value: formatValue(d.value),
                        color: MAIN_COLOR,
                      },
                      ...smaRows,
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
          <span className={styles.swatch} style={{ background: MAIN_COLOR }} />
          {valueLabel}
        </span>
        {smas.map((s) => (
          <span key={s.label} className={styles.legendItem}>
            <span className={styles.swatch} style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </figure>
  )
}
