import { scaleBand, scaleLinear } from 'd3'
import styles from './charts.module.css'

const W = 220
const H = 106
const M = { top: 12, right: 10, bottom: 18, left: 36 }

export interface TirBar {
  label: string
  /** Annualized TIR as a fraction (1 = 100%); null when not computable. */
  value: number | null
}

interface TirBarChartProps {
  bars: TirBar[]
  /**
   * When true, fit the y-axis to the [min, max] of the values; otherwise use a
   * fixed −100%…100% range (the default). Bars are clamped into whichever range
   * is active; their labels always show the true (un-clamped) value.
   */
  freeRange?: boolean
}

const pct = (v: number) => `${Math.round(v * 100)}%`

/**
 * Small bar chart comparing a handful of annualized TIR values, with a dashed
 * line marking their average. The y-axis is a fixed −100%…100% band by default,
 * or fitted to the values' own min/max in free-range mode.
 */
export function TirBarChart({ bars, freeRange = false }: TirBarChartProps) {
  const present = bars.filter((b): b is { label: string; value: number } => b.value !== null)
  const values = present.map((b) => b.value)
  const avg = values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null

  let lo = -1
  let hi = 1
  if (freeRange && values.length) {
    lo = Math.min(...values)
    hi = Math.max(...values)
    if (hi - lo < 1e-9) {
      const pad = Math.max(Math.abs(hi) * 0.1, 0.05)
      lo -= pad
      hi += pad
    }
  }

  const x = scaleBand<string>()
    .domain(bars.map((b) => b.label))
    .range([M.left, W - M.right])
    .padding(0.35)
  const y = scaleLinear().domain([lo, hi]).range([H - M.bottom, M.top])
  const clampV = (v: number) => Math.max(lo, Math.min(hi, v))
  // Bars grow from 0 when it's in range, otherwise from the visible floor.
  const baseY = y(Math.max(lo, Math.min(hi, 0)))
  const bw = x.bandwidth()
  const ticks = freeRange ? [lo, (lo + hi) / 2, hi] : [-1, -0.5, 0, 0.5, 1]

  return (
    <svg
      className={styles.chart}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Annualized TIR by regression window"
    >
      {ticks.map((t) => (
        <g key={t}>
          <line
            className={t === 0 ? styles.tirZeroLine : styles.gridLine}
            x1={M.left}
            x2={W - M.right}
            y1={y(t)}
            y2={y(t)}
          />
          <text className={styles.axisLabel} x={M.left - 5} y={y(t)} textAnchor="end" dominantBaseline="middle">
            {pct(t)}
          </text>
        </g>
      ))}

      {bars.map((b) => {
        const cx = x(b.label) ?? 0
        const mid = cx + bw / 2
        if (b.value === null) {
          return (
            <text key={b.label} className={styles.tirBarLabel} x={mid} y={H - 5} textAnchor="middle">
              {b.label}
            </text>
          )
        }
        const top = y(clampV(b.value))
        const barTop = Math.min(top, baseY)
        const barH = Math.max(1, Math.abs(baseY - top))
        const negative = b.value < 0
        const above = top <= baseY
        return (
          <g key={b.label}>
            <rect className={negative ? styles.tirBarNeg : styles.tirBar} x={cx} y={barTop} width={bw} height={barH}>
              <title>{`${b.label}: ${pct(b.value)} annualized`}</title>
            </rect>
            <text
              className={styles.tirValueLabel}
              x={mid}
              y={above ? barTop - 3 : barTop + barH + 8}
              textAnchor="middle"
            >
              {pct(b.value)}
            </text>
            <text className={styles.tirBarLabel} x={mid} y={H - 5} textAnchor="middle">
              {b.label}
            </text>
          </g>
        )
      })}

      {avg !== null && (
        <g>
          <line className={styles.tirAvgLine} x1={M.left} x2={W - M.right} y1={y(clampV(avg))} y2={y(clampV(avg))} />
          <text className={styles.tirAvgLabel} x={W - M.right} y={y(clampV(avg)) - 3} textAnchor="end">
            avg {pct(avg)}
          </text>
        </g>
      )}
    </svg>
  )
}
