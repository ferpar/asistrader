import { useMemo, useState, type ReactNode } from 'react'
import { curveMonotoneX, line, scaleBand, scaleLinear } from 'd3'
import { YAxis } from '../../components/charts/Axes'
import { ChartTooltip, useTooltip, type TooltipRow } from '../../components/charts/ChartTooltip'
import { positionDomain, type SignFilter } from './orderedSelectors'
import { computeFit, type FitMode } from './orderedFits'
import { Toggle } from './Toggle'
import chartStyles from '../../components/charts/charts.module.css'
import styles from './OrderedSection.module.css'

// Diverging palette for the score-coloured dots. Magnitude controls opacity so
// a near-zero score reads as muted/uncertain rather than committing to a strong
// red or green. The opacity floor keeps even weak signals visible.
export const DOT_STRONG_POS = '#3fb950'
export const DOT_STRONG_NEG = '#f85149'
export const DOT_NEUTRAL = '#8c959f'
const DOT_MIN_ALPHA = 0.55

export function scoreColor(score: number): string {
  if (Math.abs(score) < 5) return DOT_NEUTRAL
  // Saturate by |score| = 40 so mid-strength signals already look fully on.
  const mag = Math.min(1, Math.abs(score) / 40)
  const alpha = DOT_MIN_ALPHA + (1 - DOT_MIN_ALPHA) * mag
  const base = score > 0 ? DOT_STRONG_POS : DOT_STRONG_NEG
  return base + Math.round(alpha * 255).toString(16).padStart(2, '0')
}

const FIT_OPTIONS: { id: FitMode; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'linear', label: 'Linear' },
  { id: 'quadratic', label: 'Quadratic' },
  { id: 'local', label: 'Local avg (±5)' },
]

const W = 720
const H = 280
const M = { top: 16, right: 56, bottom: 56, left: 52 }

/** Truncate a ticker for the x-axis when there are too many bars to label fully. */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}

/**
 * Presentation-only scatter/bar chart: a signed position bar against the right
 * axis (green ≥ 0 / red < 0), age dots against the left axis coloured by a
 * signed score, and an optional age trend fit. Each per-row quantity is supplied
 * via accessors so both the Ordered and Open sections can share the rendering.
 */
export interface PositionAgeChartProps<T> {
  rows: T[]
  highlightIds: Set<number>
  /** Whether the parent has an active search query — controls dimming of non-matches. */
  hasActiveQuery: boolean
  /** Active position-sign filter — drives the position-axis anchoring and empty copy. */
  signFilter: SignFilter
  /** Stable numeric id (used for keys, sorting ties, and highlight lookup). */
  id: (r: T) => number
  /** X-axis label (ticker). */
  label: (r: T) => string
  /** Signed bar value; null rows are dropped (they can't be placed on the axis). */
  position: (r: T) => number | null
  /** Dot height value (e.g. age in days); null is treated as 0. */
  age: (r: T) => number | null
  /** Signed score driving dot colour; null falls back to the neutral dot colour. */
  score: (r: T) => number | null
  /** Tooltip heading. */
  title: (r: T) => string
  /** Tooltip body rows. */
  tooltipRows: (r: T) => TooltipRow[]
  positionAxisLabel: string
  ageAxisLabel: string
  positionFormat: (v: number) => string
  ageFormat: (v: number) => string
  ariaLabel: string
  /** Empty-state copy, given the active filter. */
  emptyText: (filter: SignFilter) => string
  /** Series-specific legend items; the age-trend item is appended automatically. */
  legend: ReactNode
}

export function PositionAgeChart<T>({
  rows,
  highlightIds,
  hasActiveQuery,
  signFilter,
  id,
  label,
  position,
  age,
  score,
  title,
  tooltipRows,
  positionAxisLabel,
  ageAxisLabel,
  positionFormat,
  ageFormat,
  ariaLabel,
  emptyText,
  legend,
}: PositionAgeChartProps<T>) {
  const { tooltip, show, hide } = useTooltip()
  const [fitMode, setFitMode] = useState<FitMode>('local')

  const sorted = useMemo(() => {
    // Drop rows with no position — they can't be placed against the axis.
    return rows
      .map((row) => ({ row, pos: position(row) }))
      .filter((x): x is { row: T; pos: number } => x.pos !== null)
      .sort((a, b) => b.pos - a.pos)
  }, [rows, position])

  const fittedAges = useMemo(
    () => computeFit(sorted.map((s) => age(s.row) ?? 0), fitMode),
    [sorted, fitMode, age],
  )

  if (sorted.length === 0) {
    return <p className={chartStyles.empty}>{emptyText(signFilter)}</p>
  }

  const xLabels = sorted.map((s) => String(id(s.row)))
  const byKey = new Map(sorted.map((s) => [String(id(s.row)), s] as const))

  const xScale = scaleBand<string>()
    .domain(xLabels)
    .range([M.left, W - M.right])
    .padding(0.2)

  const positions = sorted.map((s) => s.pos)
  const ages = sorted.map((s) => age(s.row) ?? 0)
  const posMax = Math.max(...positions.map(Math.abs), 0.01)
  const ageMax = Math.max(...ages, 1)

  // Position axis stays anchored at zero so bars read against the baseline.
  // Under a single-sided filter the unused half collapses onto zero, so the
  // visible bars fill the chart height instead of wasting it.
  const yPos = scaleLinear()
    .domain(positionDomain(posMax, signFilter))
    .nice()
    .range([H - M.bottom, M.top])

  const yAge = scaleLinear().domain([0, ageMax]).nice().range([H - M.bottom, M.top])

  const bandwidth = xScale.bandwidth()
  const zeroY = yPos(0)

  // Truncation kicks in once labels start to overlap; band width is a good proxy.
  const labelMax = bandwidth < 28 ? 4 : bandwidth < 48 ? 8 : 12

  const fitPath =
    fittedAges === null
      ? null
      : line<number>()
          .x((_, i) => (xScale(String(id(sorted[i].row))) ?? 0) + bandwidth / 2)
          .y((v) => yAge(v))
          .curve(curveMonotoneX)(fittedAges) ?? null

  return (
    <figure className={chartStyles.figure} style={{ marginTop: '1rem' }}>
      <div className={styles.chartToolbar}>
        <span className={styles.chartToolbarLabel}>Age trend</span>
        <Toggle options={FIT_OPTIONS} value={fitMode} onChange={setFitMode} />
      </div>
      <div className={chartStyles.chartFrame}>
        <svg
          className={chartStyles.chart}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={ariaLabel}
        >
          {/* Zero baseline for the position axis */}
          <line
            x1={M.left}
            x2={W - M.right}
            y1={zeroY}
            y2={zeroY}
            className={chartStyles.gridLine}
          />

          {/* Bars: position — sign-coded red/green. */}
          {sorted.map(({ row, pos }) => {
            const key = String(id(row))
            const x = xScale(key) ?? 0
            const y = pos >= 0 ? yPos(pos) : zeroY
            const height = Math.abs(yPos(pos) - zeroY)
            const isHighlight = highlightIds.has(id(row))
            const dimmed = hasActiveQuery && !isHighlight
            return (
              <rect
                key={`bar-${key}`}
                x={x}
                y={y}
                width={bandwidth}
                height={Math.max(1, height)}
                className={`${styles.posBar} ${pos >= 0 ? styles.posBarPositive : styles.posBarNegative} ${dimmed ? styles.dimmed : ''} ${isHighlight ? styles.highlight : ''}`}
              />
            )
          })}

          {/* Trend line through the age dots — drawn before the dots so the
              points stay legible on top of the fit. */}
          {fitPath && <path className={styles.fitLine} d={fitPath} />}

          {/* Dots: age (left axis), coloured by score. Dots without a score fall
              back to the neutral info colour. */}
          {sorted.map(({ row }) => {
            const key = String(id(row))
            const x = (xScale(key) ?? 0) + bandwidth / 2
            const y = yAge(age(row) ?? 0)
            const isHighlight = highlightIds.has(id(row))
            const dimmed = hasActiveQuery && !isHighlight
            const s = score(row)
            const fill = s !== null ? scoreColor(s) : null
            return (
              <circle
                key={`dot-${key}`}
                cx={x}
                cy={y}
                r={isHighlight ? 5 : 3.5}
                className={`${styles.ageDot} ${dimmed ? styles.dimmed : ''} ${isHighlight ? styles.highlight : ''}`}
                style={fill ? { fill } : undefined}
              />
            )
          })}

          {/* Transparent hit areas — one per x-band — drive the tooltip. */}
          {sorted.map(({ row }) => {
            const key = String(id(row))
            const x = xScale(key) ?? 0
            return (
              <rect
                key={`hit-${key}`}
                x={x}
                y={M.top}
                width={bandwidth}
                height={H - M.bottom - M.top}
                className={chartStyles.hitArea}
                onMouseEnter={() => {
                  const hit = byKey.get(key)
                  if (!hit) return
                  show({
                    xPct: ((x + bandwidth / 2) / W) * 100,
                    yPct: (M.top / H) * 100,
                    title: title(hit.row),
                    rows: tooltipRows(hit.row),
                  })
                }}
                onMouseLeave={hide}
              />
            )
          })}

          {/* X-axis: ticker labels, rotated 45°. Alternating labels are
              shifted along the (+1, +1) diagonal — perpendicular to the
              text's reading direction — so odd labels sit on a parallel row
              further from the axis instead of colliding with their neighbours
              along the rotated bodies. */}
          <g transform={`translate(0, ${H - M.bottom})`} className={chartStyles.axis}>
            <line x1={M.left} x2={W - M.right} y1={0} y2={0} />
            {sorted.map(({ row }, i) => {
              const key = String(id(row))
              const xCenter = (xScale(key) ?? 0) + bandwidth / 2
              const isHighlight = highlightIds.has(id(row))
              const diag = i % 2 === 0 ? 0 : 10
              const x = xCenter + diag
              const y = 12 + diag
              return (
                <text
                  key={`xlab-${key}`}
                  x={x}
                  y={y}
                  textAnchor="end"
                  transform={`rotate(-45, ${x}, ${y})`}
                  fontSize="0.6rem"
                  fontWeight={isHighlight ? 700 : 400}
                >
                  {truncate(label(row), labelMax)}
                </text>
              )
            })}
          </g>

          <YAxis
            scale={yAge}
            left={M.left}
            ticks={5}
            tickPadding={7}
            format={(v) => ageFormat(v as number)}
          />
          <YAxis
            scale={yPos}
            left={W - M.right}
            orient="right"
            ticks={5}
            tickPadding={7}
            format={(v) => positionFormat(v as number)}
          />

          {/* Axis labels */}
          <text x={M.left - 36} y={M.top - 4} className={chartStyles.axisLabel}>
            {ageAxisLabel}
          </text>
          <text x={W - M.right + 6} y={M.top - 4} className={chartStyles.axisLabel}>
            {positionAxisLabel}
          </text>
        </svg>
        <ChartTooltip tooltip={tooltip} />
      </div>
      <div className={chartStyles.legend}>
        {legend}
        {fitPath && (
          <span className={chartStyles.legendItem}>
            <span className={`${chartStyles.swatch} ${styles.fitSwatch}`} />
            Age trend ({FIT_OPTIONS.find((o) => o.id === fitMode)?.label.toLowerCase()})
          </span>
        )}
      </div>
    </figure>
  )
}
