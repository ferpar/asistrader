import { useMemo } from 'react'
import { line, scaleLinear } from 'd3'
import { XAxis, YAxis } from './Axes'
import { ChartTooltip, useTooltip } from './ChartTooltip'
import {
  cumulative,
  histogramBins,
  mean,
  normalCurve,
  stdDev,
} from '../../domain/irr/stats'
import styles from './charts.module.css'

const W = 380
const H = 240
const M = { top: 16, right: 46, bottom: 34, left: 44 }

interface HistogramProps {
  /** Raw observations to bin. */
  values: number[]
  title: string
  caption?: string
  /** Formats a value for x-axis ticks (e.g. percent or "12d"). */
  formatValue: (value: number) => string
  binCount?: number
}

/**
 * Frequency histogram with two overlays: the fitted normal bell curve (scaled
 * into count space) and the cumulative distribution (right axis, 0–100%).
 */
export function Histogram({
  values,
  title,
  caption,
  formatValue,
  binCount,
}: HistogramProps) {
  const { tooltip, show, hide } = useTooltip()
  const model = useMemo(() => {
    if (values.length === 0) return null
    const bins = histogramBins(values, binCount)
    const cdf = cumulative(bins)
    const mu = mean(values)
    const sigma = stdDev(values, mu)
    const binWidth = bins[0].x1 - bins[0].x0 || 1
    const n = values.length

    const lo = bins[0].x0
    const hi = bins[bins.length - 1].x1
    // Expected per-bin count under the normal fit: density × bin width × n.
    const curve = normalCurve(mu, sigma, lo, hi).map((p) => ({
      x: p.x,
      count: p.y * binWidth * n,
    }))
    const maxCount = Math.max(
      ...bins.map((b) => b.count),
      ...curve.map((c) => c.count),
      1,
    )
    return { bins, cdf, curve, mu, sigma, lo, hi, maxCount }
  }, [values, binCount])

  if (!model) return <p className={styles.empty}>No data for {title}.</p>

  const { bins, cdf, curve, mu, sigma, lo, hi, maxCount } = model

  const x = scaleLinear().domain([lo, hi]).range([M.left, W - M.right])
  const yCount = scaleLinear()
    .domain([0, maxCount])
    .nice()
    .range([H - M.bottom, M.top])
  const yFrac = scaleLinear().domain([0, 1]).range([H - M.bottom, M.top])

  const curvePath =
    line<{ x: number; count: number }>()
      .x((p) => x(p.x))
      .y((p) => yCount(p.count))(curve) ?? ''

  // CDF anchored at (lo, 0) so the line starts on the axis.
  const cdfPoints = [{ x: lo, fraction: 0 }, ...cdf]
  const cdfPath =
    line<{ x: number; fraction: number }>()
      .x((p) => x(p.x))
      .y((p) => yFrac(p.fraction))(cdfPoints) ?? ''

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
        aria-label={`${title} histogram`}
      >
        {bins.map((b, i) => {
          const bx = x(b.x0)
          const bw = Math.max(0, x(b.x1) - x(b.x0) - 1)
          const by = yCount(b.count)
          return (
            <rect
              key={i}
              className={styles.bar}
              x={bx}
              y={by}
              width={bw}
              height={H - M.bottom - by}
              onMouseEnter={() =>
                show({
                  xPct: ((bx + bw / 2) / W) * 100,
                  yPct: (by / H) * 100,
                  title: `${formatValue(b.x0)} – ${formatValue(b.x1)}`,
                  rows: [
                    { label: 'Frequency', value: String(b.count) },
                    {
                      label: 'Cumulative',
                      value: `${(cdf[i].fraction * 100).toFixed(0)}%`,
                    },
                  ],
                })
              }
              onMouseLeave={hide}
            />
          )
        })}
        {sigma > 0 && <path className={styles.normalCurve} d={curvePath} />}
        <path className={styles.cdfLine} d={cdfPath} />
        <XAxis
          scale={x}
          top={H - M.bottom}
          ticks={5}
          format={(v) => formatValue(Number(v))}
        />
        <YAxis scale={yCount} left={M.left} ticks={4} />
        <YAxis
          scale={yFrac}
          left={W - M.right}
          orient="right"
          ticks={4}
          format={(v) => `${Math.round((v as number) * 100)}%`}
        />
      </svg>
      <ChartTooltip tooltip={tooltip} />
      </div>
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.swatch} style={{ background: 'var(--color-primary, #0969da)', opacity: 0.55 }} />
          Frequency
        </span>
        <span className={styles.legendItem}>
          <span className={styles.swatch} style={{ background: 'var(--color-error, #cf222e)' }} />
          Normal fit (μ {formatValue(mu)}, σ {formatValue(sigma)})
        </span>
        <span className={styles.legendItem}>
          <span className={styles.swatch} style={{ background: 'var(--color-text-muted)' }} />
          Cumulative %
        </span>
      </div>
    </figure>
  )
}
