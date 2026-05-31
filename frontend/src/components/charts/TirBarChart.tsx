import { scaleBand, scaleLinear } from 'd3'
import styles from './charts.module.css'

const W = 176
const H = 85
// No per-bar labels along the bottom anymore, so the bottom gutter is tight.
const M = { top: 12, right: 10, bottom: 10, left: 36 }
// Without the y-axis labels there's no need for the wide left gutter.
const LEFT_NO_AXES = 8

export interface TirBar {
  label: string
  /** Annualized TIR as a fraction (1 = 100%); null when not computable. */
  value: number | null
}

interface TirBarChartProps {
  bars: TirBar[]
  /** Show the y-axis gridlines and percentage tick labels. Off by default to
   *  keep the chart compact; bars and value labels are always drawn. */
  showAxes?: boolean
}

const pct = (v: number) => `${Math.round(v * 100)}%`

/**
 * Small bar chart comparing a handful of annualized TIR values, with a dashed
 * line marking their average. The y-axis fits the values but always keeps 0 in
 * view (bottom ≤ 0%, top ≥ 0%) so bars grow from a shared 0% baseline.
 */
export function TirBarChart({ bars, showAxes = false }: TirBarChartProps) {
  const leftM = showAxes ? M.left : LEFT_NO_AXES
  const present = bars.filter((b): b is { label: string; value: number } => b.value !== null)
  const values = present.map((b) => b.value)
  const avg = values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null

  let lo = -1
  let hi = 1
  if (values.length) {
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
    .range([leftM, W - M.right])
    .padding(0.35)
  const y = scaleLinear().domain([lo, hi]).range([H - M.bottom, M.top])
  const clampV = (v: number) => Math.max(lo, Math.min(hi, v))
  const baseY = y(0)
  const bw = x.bandwidth()
  // 0 is always within range, so it always belongs in the tick set.
  const ticks = Array.from(new Set([lo, 0, hi]))

  return (
    <svg
      className={styles.tirChart}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Annualized TIR by regression window"
    >
      <title>
        {`Annualized TIR by regression window (${bars
          .map((b) => b.label)
          .join(' / ')}). Hover a bar for its window and value.`}
      </title>

      {/* The 0% baseline is the x-axis — always drawn so bars have something to
          sit on. The y-axis grid + percentage labels stay opt-in via showAxes. */}
      <line className={styles.tirZeroLine} x1={leftM} x2={W - M.right} y1={baseY} y2={baseY} />
      {showAxes &&
        ticks.map((t) => (
          <g key={t}>
            {t !== 0 && (
              <line className={styles.gridLine} x1={leftM} x2={W - M.right} y1={y(t)} y2={y(t)} />
            )}
            <text className={styles.axisLabel} x={leftM - 5} y={y(t)} textAnchor="end" dominantBaseline="middle">
              {pct(t)}
            </text>
          </g>
        ))}

      {bars.map((b) => {
        const cx = x(b.label) ?? 0
        const mid = cx + bw / 2
        if (b.value === null) {
          // No bar to draw, but keep a transparent column so the window is still
          // discoverable on hover.
          return (
            <rect key={b.label} x={cx} y={M.top} width={bw} height={Math.max(1, baseY - M.top)} fill="transparent">
              <title>{`${b.label} regression window — no data`}</title>
            </rect>
          )
        }
        const top = y(clampV(b.value))
        const barTop = Math.min(top, baseY)
        const barH = Math.max(1, Math.abs(baseY - top))
        const negative = b.value < 0
        return (
          <g key={b.label}>
            <rect className={negative ? styles.tirBarNeg : styles.tirBar} x={cx} y={barTop} width={bw} height={barH}>
              <title>{`${b.label} regression window — ${pct(b.value)} annualized TIR`}</title>
            </rect>
            <text
              className={styles.tirValueLabel}
              x={mid}
              y={negative ? barTop + barH + 8 : barTop - 3}
              textAnchor="middle"
            >
              {pct(b.value)}
            </text>
          </g>
        )
      })}

      {avg !== null && (
        <g>
          <line className={styles.tirAvgLine} x1={leftM} x2={W - M.right} y1={y(clampV(avg))} y2={y(clampV(avg))} />
          <text className={styles.tirAvgLabel} x={W - M.right} y={y(clampV(avg)) - 3} textAnchor="end">
            {pct(avg)}
          </text>
        </g>
      )}
    </svg>
  )
}
