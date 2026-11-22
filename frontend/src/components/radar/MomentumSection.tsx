import type { MomentumScore } from '../../domain/radar/types'
import styles from './RadarTickerCard.module.css'

interface MomentumSectionProps {
  momentum: MomentumScore
}

const formatPercent = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)

const tone = (value: number | null) => (value === null ? '' : value >= 0 ? 'positive' : 'negative')

const RETURNS = [
  ['1M', 'r1m'],
  ['3M', 'r3m'],
  ['6M', 'r6m'],
  ['1Y', 'r1y'],
] as const

/**
 * Momentum Score block: the weighted score (0.35·1M + 0.30·3M + 0.20·6M +
 * 0.15·1Y, on adjusted closes) and the four returns behind it. The score shows
 * "-" until a full year of adjusted closes is available.
 */
export function MomentumSection({ momentum }: MomentumSectionProps) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionLabel}>Momentum Score</div>
      <div className={styles.rsiRow}>
        <span
          className={`${styles.rsiValue} ${tone(momentum.score)}`}
          title={
            momentum.score === null
              ? 'Needs a year of adjusted closes'
              : '0.35·1M + 0.30·3M + 0.20·6M + 0.15·1Y (adjusted closes)'
          }
        >
          {momentum.score !== null ? formatPercent(momentum.score) : '-'}
        </span>
        <div className={styles.changeGrid}>
          {RETURNS.map(([label, key]) => (
            <div key={key} className={styles.changeItem}>
              <span className={styles.changeLabel}>{label}</span>
              <span className={tone(momentum[key])}>
                {momentum[key] !== null ? formatPercent(momentum[key]) : '-'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
