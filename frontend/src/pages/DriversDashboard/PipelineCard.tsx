import type { Pipeline, PipelineSlice } from '../../domain/irr/types'
import { fmtMoney, fmtPct } from './format'
import shared from './shared.module.css'
import styles from './PipelineCard.module.css'

const SLICE_CLASS: Record<string, string> = {
  Plan: styles.plan,
  Ordered: styles.ordered,
  Open: styles.open,
}

function fmtRatio(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return `${value.toFixed(2)} : 1`
}

function StackedBar({
  slices,
  basis,
}: {
  slices: PipelineSlice[]
  basis: 'count' | 'capital'
}) {
  return (
    <div className={styles.bar}>
      {slices.map((s) => {
        const pct = basis === 'count' ? s.countPct : s.capitalPct
        if (pct <= 0) return null
        return (
          <div
            key={s.label}
            className={`${styles.barSegment} ${SLICE_CLASS[s.label] ?? ''}`}
            style={{ flexGrow: pct }}
            title={`${s.label} — ${fmtPct(pct)}`}
          >
            {pct >= 0.08 ? fmtPct(pct) : ''}
          </div>
        )
      })}
    </div>
  )
}

function Legend({
  slices,
  basis,
  ccy,
}: {
  slices: PipelineSlice[]
  basis: 'count' | 'capital'
  ccy: string
}) {
  return (
    <ul className={styles.legend}>
      {slices.map((s) => (
        <li key={s.label} className={styles.legendItem}>
          <span className={`${styles.swatch} ${SLICE_CLASS[s.label] ?? ''}`} />
          <span className={styles.legendLabel}>{s.label}</span>
          <span className={styles.legendValue}>
            {basis === 'count'
              ? `${s.tradeCount} (${fmtPct(s.countPct)})`
              : `${fmtMoney(s.capitalBase, ccy)} (${fmtPct(s.capitalPct)})`}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function PipelineCard({
  pipeline,
  ccy,
}: {
  pipeline: Pipeline
  ccy: string
}) {
  if (pipeline.totalCount === 0) {
    return <p className={shared.empty}>No active trades — pipeline is empty.</p>
  }

  return (
    <div className={styles.card}>
      <div className={styles.headline}>
        <div className={styles.headlineMetric}>
          <span className={styles.headlineLabel}>Total active</span>
          <span className={styles.headlineValue}>{pipeline.totalCount}</span>
          <span className={styles.headlineSub}>
            {fmtMoney(pipeline.totalCapitalBase, ccy)} committed
          </span>
        </div>
        <div className={styles.headlineMetric}>
          <span className={styles.headlineLabel}>Ordered : Open (count)</span>
          <span className={styles.headlineValue}>
            {fmtRatio(pipeline.orderedToOpenCount)}
          </span>
        </div>
        <div className={styles.headlineMetric}>
          <span className={styles.headlineLabel}>Ordered : Open (capital)</span>
          <span className={styles.headlineValue}>
            {fmtRatio(pipeline.orderedToOpenCapital)}
          </span>
        </div>
      </div>

      <div className={styles.breakdown}>
        <div className={styles.breakdownColumn}>
          <h4 className={styles.breakdownTitle}>By trade count</h4>
          <StackedBar slices={pipeline.slices} basis="count" />
          <Legend slices={pipeline.slices} basis="count" ccy={ccy} />
        </div>
        <div className={styles.breakdownColumn}>
          <h4 className={styles.breakdownTitle}>By capital</h4>
          <StackedBar slices={pipeline.slices} basis="capital" />
          <Legend slices={pipeline.slices} basis="capital" ccy={ccy} />
        </div>
      </div>
    </div>
  )
}
