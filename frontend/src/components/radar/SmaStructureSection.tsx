import type { SmaStructure } from '../../domain/radar/types'
import { SmaProportionStrip } from './SmaProportionStrip'
import styles from './RadarTickerCard.module.css'

interface SmaStructureSectionProps {
  sma: SmaStructure
  /** Latest price, used to position the proportion strip. */
  price: number | null
  /** Formats an absolute price-space value (currency-aware on ticker cards). */
  fmt: (value: number) => string
}

function getStructureColor(structure: string | null): string {
  if (!structure) return ''
  if (structure.startsWith('0')) return styles.bullish
  if (structure.startsWith('4')) return styles.bearish
  return ''
}

function getScoreClass(score: number | null): string {
  if (score === null) return ''
  if (score >= 8) return styles.scoreBullish
  if (score <= 2) return styles.scoreBearish
  return ''
}

/**
 * SMA structure block shared by the ticker and benchmark radar cards. Row 1 is
 * the structure code + bullish score; the proportion strip sits on its own row
 * below, then the raw SMA values. Kept as one component so both card types stay
 * in sync as the layout evolves.
 */
export function SmaStructureSection({ sma, price, fmt }: SmaStructureSectionProps) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionLabel}>SMA Structure</div>
      <SmaProportionStrip
        price={price}
        sma5={sma.sma5}
        sma20={sma.sma20}
        sma50={sma.sma50}
        sma200={sma.sma200}
        formatValue={fmt}
      />
      <div className={styles.structureRow}>
        <div className={`${styles.structure} ${getStructureColor(sma.structure)}`}>
          {sma.structure ?? '-'}
        </div>
        {sma.bullishScore !== null && (
          <span
            className={`${styles.scoreBadge} ${getScoreClass(sma.bullishScore)}`}
            title="Bullish-ordered pairs out of 10 (price + 4 SMAs in shortest→longest order)"
          >
            {sma.bullishScore}/10
          </span>
        )}
      </div>
      <div className={styles.emaValues}>
        <span className={styles.emaItem}><span className={styles.emaLabel}>5</span> {sma.sma5 !== null ? fmt(sma.sma5) : '-'}</span>
        <span className={styles.emaItem}><span className={styles.emaLabel}>20</span> {sma.sma20 !== null ? fmt(sma.sma20) : '-'}</span>
        <span className={styles.emaItem}><span className={styles.emaLabel}>50</span> {sma.sma50 !== null ? fmt(sma.sma50) : '-'}</span>
        <span className={styles.emaItem}><span className={styles.emaLabel}>200</span> {sma.sma200 !== null ? fmt(sma.sma200) : '-'}</span>
      </div>
    </div>
  )
}
