import { Fragment } from 'react'
import type { TargetKind } from '../../../domain/radar/tradeEta'
import styles from '../RadarTickerCard.module.css'
import tooltipStyles from '../../../styles/tooltip.module.css'

type GuideTone = 'good' | 'bad' | null

interface GuideRow {
  name: string
  desc: string
  tone: GuideTone
}

function guideRows(kind: TargetKind): GuideRow[] {
  if (kind === 'tp') {
    return [
      { name: 'new', desc: 'trade just opened', tone: null },
      { name: '↘ proj', desc: 'baseline trend was away from TP', tone: null },
      { name: 'ahead', desc: 'reaching TP sooner than projected', tone: 'good' },
      { name: 'behind', desc: 'reaching TP later than projected', tone: 'bad' },
      { name: 'on pace', desc: 'dynamic tracks the baseline', tone: null },
    ]
  }
  if (kind === 'sl') {
    return [
      { name: 'new', desc: 'trade just opened', tone: null },
      { name: '↘ proj', desc: 'baseline trend was away from SL', tone: null },
      { name: 'ahead', desc: 'reaching SL sooner than projected', tone: 'bad' },
      { name: 'behind', desc: 'reaching SL later than projected', tone: 'good' },
      { name: 'on pace', desc: 'dynamic tracks the baseline', tone: null },
    ]
  }
  return [
    { name: 'new', desc: 'plan just created', tone: null },
    { name: '↘ proj', desc: 'baseline trend was away from entry', tone: null },
    { name: 'ahead', desc: 'reaching entry sooner than projected', tone: null },
    { name: 'behind', desc: 'reaching entry later than projected', tone: null },
    { name: 'on pace', desc: 'dynamic tracks the baseline', tone: null },
  ]
}

function guideHeading(kind: TargetKind): string {
  if (kind === 'tp') return 'Badge guide — ETA→TP'
  if (kind === 'sl') return 'Badge guide — ETA→SL'
  return 'Badge guide — ETA→entry'
}

function toneClass(tone: GuideTone): string {
  if (tone === 'good') return styles.guideToneGood
  if (tone === 'bad') return styles.guideToneBad
  return styles.guideToneNeutral
}

export function TradeEtaBadgeGuide({ label, kind }: { label: string; kind: TargetKind }) {
  const rows = guideRows(kind)
  return (
    <span
      className={`${styles.helpIcon} ${tooltipStyles.richTooltipHost}`}
      tabIndex={0}
      role="img"
      aria-label={`${label} badge guide`}
    >
      ?
      <span className={tooltipStyles.richTooltip} role="tooltip">
        <span className={styles.guideHeading}>{guideHeading(kind)}</span>
        <span className={styles.guideGrid}>
          {rows.map((r) => (
            <Fragment key={r.name}>
              <span className={styles.guideName}>{r.name}</span>
              <span className={styles.guideDesc}>{r.desc}</span>
              <span className={`${styles.guideTone} ${toneClass(r.tone)}`}>
                {r.tone ?? '—'}
              </span>
            </Fragment>
          ))}
        </span>
      </span>
    </span>
  )
}
