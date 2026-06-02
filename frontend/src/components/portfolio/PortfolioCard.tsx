import type { GroupIrr } from '../../domain/irr/types'
import { fmtMoney, fmtPct, fmtXirr } from './format'
import { signClass } from './signClass'
import styles from './PortfolioCard.module.css'

type Metric = { label: string; value: string; cls?: string }

export function PortfolioCard({
  group,
  ccy,
  extras = [],
}: {
  group: GroupIrr
  ccy: string
  /** Extra metrics appended after the standard ones (e.g. expected-orders KPIs). */
  extras?: Metric[]
}) {
  const sameCcy = group.currency !== null && group.currency === ccy
  const metrics: Metric[] = [
    { label: 'Trades', value: String(group.tradeCount) },
    { label: 'Invested', value: fmtMoney(group.investmentBase, ccy) },
    {
      label: 'Profit',
      value: fmtMoney(group.profitBase, ccy),
      cls: signClass(group.profitBase),
    },
    {
      label: 'FX drift',
      value: sameCcy ? '—' : fmtMoney(group.fxDriftBase, ccy),
      cls: sameCcy ? '' : signClass(group.fxDriftBase),
    },
    {
      label: 'Return %',
      value: fmtPct(group.returnPct),
      cls: signClass(group.returnPct),
    },
    { label: 'Avg Days', value: group.avgHoldingDays.toFixed(1) },
    { label: 'TIR (annualized)', value: fmtPct(group.tir), cls: signClass(group.tir) },
    { label: 'XIRR (compound)', value: fmtXirr(group.xirr) },
    ...extras,
  ]
  return (
    <div className={styles.card}>
      {metrics.map((m) => (
        <div key={m.label} className={styles.metric}>
          <span className={styles.metricLabel}>{m.label}</span>
          <span className={`${styles.metricValue} ${m.cls ?? ''}`}>{m.value}</span>
        </div>
      ))}
    </div>
  )
}
