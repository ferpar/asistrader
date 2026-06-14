import type { OpenSummary } from './openSelectors'
import { STALE_HOLDING_DAYS } from './openSelectors'
import { fmtMoney, fmtPct } from '../../components/portfolio/format'
import { signClass } from '../../components/portfolio/signClass'
import styles from '../../components/portfolio/PortfolioCard.module.css'

interface Metric {
  label: string
  value: string
  cls?: string
  hint?: string
}

export function OpenSummaryCard({ summary, ccy }: { summary: OpenSummary; ccy: string }) {
  const metrics: Metric[] = [
    { label: 'Open', value: String(summary.count) },
    { label: 'Committed', value: fmtMoney(summary.totalCommitted, ccy) },
    {
      label: 'Avg P&L %',
      value: summary.avgPnLPct === null ? '—' : fmtPct(summary.avgPnLPct),
      cls: summary.avgPnLPct === null ? '' : signClass(summary.avgPnLPct),
      hint: 'Mean unrealized return across open positions.',
    },
    {
      label: 'Avg holding',
      value: summary.avgHoldingDays === null ? '—' : `${summary.avgHoldingDays.toFixed(1)}d`,
    },
    {
      label: 'In profit',
      value: String(summary.inProfitCount),
      hint: 'Positions whose price sits between PE and the take-profit.',
    },
    {
      label: 'In loss',
      value: String(summary.inLossCount),
      hint: 'Positions whose price sits between PE and the stop-loss.',
    },
    {
      label: 'Closest to TP',
      value: summary.closestToTP
        ? `${summary.closestToTP.ticker} · ${fmtPct(summary.closestToTP.distanceToTP)}`
        : '—',
      hint: 'In-profit position nearest its take-profit.',
    },
    {
      label: 'Closest to SL',
      value: summary.closestToSL
        ? `${summary.closestToSL.ticker} · ${fmtPct(summary.closestToSL.distanceToSL)}`
        : '—',
      hint: 'In-loss position nearest its stop-loss — most at risk.',
    },
    {
      label: `Stale (>${STALE_HOLDING_DAYS}d)`,
      value: String(summary.staleCount),
      hint: `Positions held longer than ${STALE_HOLDING_DAYS} days.`,
    },
  ]

  return (
    <div className={styles.card}>
      {metrics.map((m) => (
        <div key={m.label} className={styles.metric} title={m.hint}>
          <span className={styles.metricLabel}>{m.label}</span>
          <span className={`${styles.metricValue} ${m.cls ?? ''}`}>{m.value}</span>
        </div>
      ))}
    </div>
  )
}
