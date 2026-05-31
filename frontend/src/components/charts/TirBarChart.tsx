import { scaleBand, scaleLinear } from 'd3'
import styles from './charts.module.css'

const W = 220
const H = 132
const M = { top: 14, right: 10, bottom: 20, left: 34 }

export interface TirBar {
  label: string
  /** Annualized TIR as a fraction (1 = 100%); null when not computable. */
  value: number | null
}

interface TirBarChartProps {
  bars: TirBar[]
  /**
   * Upper cap for the y-axis and bar heights, as a fraction. Bars taller than
   * this are clamped to it (a TIR beyond the cap carries little meaning).
   * Defaults to 1 (100%).
   */
  cap?: number
}

const pct = (v: number) => `${Math.round(v * 100)}%`

/**
 * Small bar chart comparing a handful of annualized TIR values on a fixed
 * 0–100% axis, with a dashed line marking their average. Bars are clamped to
 * the cap; their labels always show the true (un-clamped) value.
 */
export function TirBarChart({ bars, cap = 1 }: TirBarChartProps) {
  const present = bars.filter((b): b is { label: string; value: number } => b.value !== null)
  const avg = present.length
    ? present.reduce((sum, b) => sum + b.value, 0) / present.length
    : null

  const x = scaleBand<string>()
    .domain(bars.map((b) => b.label))
    .range([M.left, W - M.right])
    .padding(0.35)
  const y = scaleLinear().domain([0, cap]).range([H - M.bottom, M.top])
  const clamp = (v: number) => Math.max(0, Math.min(cap, v))
  const baseY = y(0)
  const bw = x.bandwidth()

  return (
    <svg
      className={styles.chart}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Annualized TIR by regression window"
    >
      {[0, cap / 2, cap].map((t) => (
        <g key={t}>
          <line className={styles.gridLine} x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} />
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
            <text key={b.label} className={styles.tirBarLabel} x={mid} y={H - 6} textAnchor="middle">
              {b.label}
            </text>
          )
        }
        const top = y(clamp(b.value))
        const negative = b.value < 0
        return (
          <g key={b.label}>
            <rect
              className={negative ? styles.tirBarNeg : styles.tirBar}
              x={cx}
              y={Math.min(top, baseY)}
              width={bw}
              height={Math.max(1, Math.abs(baseY - top))}
            >
              <title>{`${b.label}: ${pct(b.value)} annualized`}</title>
            </rect>
            <text className={styles.tirValueLabel} x={mid} y={Math.min(top, baseY) - 3} textAnchor="middle">
              {pct(b.value)}
            </text>
            <text className={styles.tirBarLabel} x={mid} y={H - 6} textAnchor="middle">
              {b.label}
            </text>
          </g>
        )
      })}

      {avg !== null && (
        <g>
          <line
            className={styles.tirAvgLine}
            x1={M.left}
            x2={W - M.right}
            y1={y(clamp(avg))}
            y2={y(clamp(avg))}
          />
          <text className={styles.tirAvgLabel} x={W - M.right} y={y(clamp(avg)) - 3} textAnchor="end">
            avg {pct(avg)}
          </text>
        </g>
      )}
    </svg>
  )
}
