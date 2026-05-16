import type { RsiIndicator, DivergenceSignal } from '../../domain/radar/types'
import styles from './RsiSparkline.module.css'

const W = 260
const H = 64
const PAD = 5

interface RsiSparklineProps {
  rsi: RsiIndicator
}

/**
 * Inline RSI chart: the series with 30/70 guide lines, swing-pivot dots,
 * and any divergence trendline drawn through its pivots. Hover a dot or
 * line to read the underlying dates.
 */
export function RsiSparkline({ rsi }: RsiSparklineProps) {
  const { series, pivots, divergence } = rsi

  let firstValid = -1
  for (let i = 0; i < series.length; i++) {
    if (series[i] !== null) {
      firstValid = i
      break
    }
  }
  if (firstValid < 0) return null

  const lastIndex = series.length - 1
  const span = Math.max(1, lastIndex - firstValid)
  const x = (i: number) => PAD + ((i - firstValid) / span) * (W - 2 * PAD)
  const y = (v: number) => PAD + ((100 - v) / 100) * (H - 2 * PAD)

  const linePoints = series
    .map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
    .filter((p): p is string => p !== null)
    .join(' ')

  const allPivots = [...pivots.highs, ...pivots.lows]

  const renderDivergence = (sig: DivergenceSignal | null, className: string) => {
    if (!sig) return null
    const points = sig.pivots.map((p) => `${x(p.index).toFixed(1)},${y(p.rsi).toFixed(1)}`).join(' ')
    const dates = sig.pivots.map((p) => p.date).join(', ')
    return (
      <polyline className={className} points={points} fill="none">
        <title>{`${sig.strength} divergence — pivots: ${dates}`}</title>
      </polyline>
    )
  }

  return (
    <svg
      className={styles.sparkline}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="RSI sparkline"
    >
      <line className={styles.guide} x1={PAD} x2={W - PAD} y1={y(70)} y2={y(70)} />
      <line className={styles.guide} x1={PAD} x2={W - PAD} y1={y(30)} y2={y(30)} />
      <polyline className={styles.rsiLine} points={linePoints} fill="none" />
      {renderDivergence(divergence.bearish, styles.divBearish)}
      {renderDivergence(divergence.bullish, styles.divBullish)}
      {allPivots.map((p) => (
        <circle key={`${p.index}-${p.rsi}`} className={styles.pivotDot} cx={x(p.index)} cy={y(p.rsi)} r={2.25}>
          <title>{`${p.date} · RSI ${p.rsi.toFixed(1)}`}</title>
        </circle>
      ))}
    </svg>
  )
}
