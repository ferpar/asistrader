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
   * When true (the default), fit the y-axis to the values, but always keep 0 in
   * view (bottom ≤ 0%, top ≥ 0%) so the shortest bar's body stays visible when
   * every value shares a sign. When false, use a fixed −100%…100% range. Bars
   * are clamped into the active range; their labels show the true value.
   */
  freeRange?: boolean
}

const pct = (v: number) => `${Math.round(v * 100)}%`

/**
 * Small bar chart comparing a handful of annualized TIR values, with a dashed
 * line marking their average. Bars always grow from the 0% baseline.
 */
export function TirBarChart({ bars, freeRange = true }: TirBarChartProps) {
  const present = bars.filter((b): b is { label: string; value: number } => b.value !== null)
  const values = present.map((b) => b.value)
  const avg = values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null

  let lo = -1
  let hi = 1
  if (freeRange && values.length) {
    // Anchor the range at 0 so an all-positive (or all-negative) set still
    // shows each bar growing from a shared 0% floor (or ceiling).
    lo = Math.min(0, ...values)
    hi = Math.max(0, ...values)
    if (hi - lo < 1e-9) {
      hi += 0.05
      lo -= 0.05
    }
  }

  const x = scaleBand<string>()
    .domain(bars.map((b) => b.label))
    .range([M.left, W - M.right])
    .padding(0.35)
  const y = scaleLinear().domain([lo, hi]).range([H - M.bottom, M.top])
  const clampV = (v: number) => Math.max(lo, Math.min(hi, v))
  const baseY = y(0)
  const bw = x.bandwidth()
  // 0 is always within range, so it always belongs in the tick set.
  const ticks = freeRange
    ? Array.from(new Set([lo, 0, hi]))
    : [-1, -0.5, 0, 0.5, 1]

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
        return (
          <g key={b.label}>
            <rect className={negative ? styles.tirBarNeg : styles.tirBar} x={cx} y={barTop} width={bw} height={barH}>
              <title>{`${b.label}: ${pct(b.value)} annualized`}</title>
            </rect>
            <text
              className={styles.tirValueLabel}
              x={mid}
              y={negative ? barTop + barH + 8 : barTop - 3}
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
