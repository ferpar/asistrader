import type { TargetKind, TradeEtaCell } from '../../../domain/radar/tradeEta'
import { TimelineOverlapBar } from './TimelineOverlapBar'
import { TradeEtaBadgeGuide } from './TradeEtaBadgeGuide'
import styles from '../RadarTickerCard.module.css'
import tooltipStyles from '../../../styles/tooltip.module.css'

export interface EtaCellProps {
  label: string
  kind: TargetKind
  cell: TradeEtaCell | null
}

export function EtaCell({ label, kind, cell }: EtaCellProps) {
  if (!cell) {
    return (
      <span className={styles.tradeCell}>
        <span className={styles.etaLabelRow}>
          <span className={styles.tradeCellLabel}>{label}</span>
          <TradeEtaBadgeGuide label={label} kind={kind} />
        </span>
        <span>-</span>
      </span>
    )
  }

  const projectedForBar =
    cell.projectedState === 'ok' &&
    cell.projected &&
    (cell.projected.a !== null || cell.projected.b !== null)
      ? { a: cell.projected.a, b: cell.projected.b }
      : null

  return (
    <span className={`${styles.tradeCell} ${tooltipStyles.tooltipHost}`} data-tooltip={cell.tooltip}>
      <span className={styles.etaLabelRow}>
        <span className={styles.tradeCellLabel}>{label}</span>
        <TradeEtaBadgeGuide label={label} kind={kind} />
      </span>
      <span className={styles.etaValueRow}>
        <span>{cell.dynamic.text}</span>
        {cell.badge && <span className={styles.etaBadge}>· {cell.badge}</span>}
      </span>
      <TimelineOverlapBar
        dynamic={{ a: cell.dynamic.a, b: cell.dynamic.b }}
        projected={projectedForBar}
      />
    </span>
  )
}
