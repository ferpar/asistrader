import { useMemo } from 'react'
import { observer } from '@legendapp/state/react'
import { useIndicatorStore } from '../../container/ContainerContext'
import { fmtMoney } from '../../components/portfolio/format'
import { signClass } from '../../components/portfolio/signClass'
import { getRsiTone } from '../../components/radar/rsiHelpers'
import { SortableTh } from '../../components/table/SortableTh'
import { useMultiSort, useSortedRows, type Sortable } from '../../hooks/useMultiSort'
import type { Holding } from '../../domain/portfolio/types'
import { holdingMeasures, type HoldingMeasures } from '../../domain/portfolio/holdingMeasures'
import { fmtDate, fmtOptionalPct, fmtPrice, fmtUnits } from './format'
import { HoldingBasketLinks } from './HoldingBasketLinks'
import styles from './Portfolio.module.css'

type SortKey =
  | 'ticker'
  | 'value'
  | 'weight'
  | 'gain'
  | 'momentum'
  | 'bullishScore'
  | 'lrSlopePct'
  | 'lrR2'
  | 'tir'
  | 'rsi'

/** Why a Holding's measures may be empty: still loading, or no indicator set for its ticker. */
type MeasureStatus = 'ready' | 'loading' | 'missing'

interface Row {
  holding: Holding
  measures: HoldingMeasures
  status: MeasureStatus
  /** The indicator set's error (e.g. no price data), shown as the empty cells' tooltip. */
  error: string | null
}

const fmtPct1 = (v: number) => `${(v * 100).toFixed(1)}%`
const fmtPct2 = (v: number) => `${(v * 100).toFixed(2)}%`

function rowValue(row: Row, key: SortKey): Sortable {
  switch (key) {
    case 'ticker':
      return row.holding.ticker
    case 'value':
      return row.holding.value.toNumber()
    case 'weight':
      return row.holding.weight
    case 'gain':
      return row.holding.unrealizedGainPct
    default:
      return row.measures[key]
  }
}

function emptyTitle(row: Row): string {
  if (row.status === 'loading') return 'Measuring…'
  if (row.status === 'missing') return 'Not measured yet: no market data loaded for this ticker'
  return row.error ?? 'Not enough price history'
}

/**
 * Holdings with their cost/value figures and, per ticker, the Momentum Score
 * and radar measures from the shared IndicatorStore (same values as the radar
 * card). Every column sorts; shift-click adds a tie-breaker.
 */
export const HoldingsTable = observer(function HoldingsTable({
  holdings,
  currency,
}: {
  holdings: Holding[]
  currency: string
}) {
  const indicatorStore = useIndicatorStore()
  const indicators = indicatorStore.indicators$.get()
  const loading = indicatorStore.loading$.get()

  const rows = useMemo<Row[]>(() => {
    const bySymbol = new Map(indicators.map((ind) => [ind.symbol.toUpperCase(), ind]))
    return holdings.map((holding) => {
      const ind = bySymbol.get(holding.ticker.toUpperCase())
      return {
        holding,
        measures: holdingMeasures(ind),
        status: ind ? 'ready' : loading ? 'loading' : 'missing',
        error: ind?.error ?? null,
      }
    })
  }, [holdings, indicators, loading])

  const sort = useMultiSort<SortKey>()
  const sorted = useSortedRows(rows, sort.terms, rowValue)

  const measure = (row: Row, value: number | null, format: (v: number) => string, tone = '') =>
    value === null ? (
      <td className={`${styles.num} ${styles.muted}`} title={emptyTitle(row)}>
        {row.status === 'loading' ? '…' : '—'}
      </td>
    ) : (
      <td className={`${styles.num} ${tone}`}>{format(value)}</td>
    )

  const th = (label: string, key: SortKey, title?: string) => (
    <SortableTh label={label} sortKey={key} sort={sort} numeric className={styles.num} title={title} />
  )

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <SortableTh label="Ticker" sortKey="ticker" sort={sort} />
            <th className={styles.num}>Units</th>
            <th className={styles.num}>Last close</th>
            <th className={styles.num}>Cost</th>
            {th('Value', 'value')}
            {th('Weight', 'weight')}
            {th('Unrealized Gain', 'gain', 'Sorts by the relative gain')}
            {th('Momentum', 'momentum', 'Momentum Score: 0.35·1M + 0.30·3M + 0.20·6M + 0.15·1Y (adjusted closes)')}
            {th('Bullish', 'bullishScore', 'SMA structure: bullish-ordered pairs out of 10')}
            {th('LR 50d slope', 'lrSlopePct', '50-day linear-regression slope, % per day')}
            {th('R²', 'lrR2', 'Fit of the 50-day linear regression')}
            {th('TIR', 'tir', 'Annualised TIR: 50-day slope % × 365')}
            {th('RSI', 'rsi', 'RSI (14)')}
            <th title="Baskets you can see that contain this instrument">Baskets</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const h = row.holding
            const m = row.measures
            const gain = h.unrealizedGain.toNumber()
            return (
              <tr key={h.ticker}>
                <td>
                  <strong>{h.ticker}</strong>
                  {h.name && <div className={styles.muted}>{h.name}</div>}
                </td>
                <td className={styles.num}>{fmtUnits(h.units)}</td>
                <td className={styles.num} title={fmtDate(h.lastPriceDate)}>
                  {fmtPrice(h.lastPrice)} <span className={styles.muted}>{h.currency}</span>
                </td>
                <td className={styles.num}>{fmtMoney(h.cost.toNumber(), currency)}</td>
                <td className={styles.num}>{fmtMoney(h.value.toNumber(), currency)}</td>
                <td className={styles.num}>{fmtOptionalPct(h.weight)}</td>
                <td className={`${styles.num} ${signClass(gain)}`}>
                  {fmtMoney(gain, currency)} <small>({fmtOptionalPct(h.unrealizedGainPct)})</small>
                </td>
                {measure(row, m.momentum, fmtPct1, signClass(m.momentum ?? 0))}
                {measure(row, m.bullishScore, (v) => `${v}/10`)}
                {measure(row, m.lrSlopePct, fmtPct2, signClass(m.lrSlopePct ?? 0))}
                {measure(row, m.lrR2, (v) => v.toFixed(2))}
                {measure(row, m.tir, fmtPct1, signClass(m.tir ?? 0))}
                {measure(row, m.rsi, (v) => v.toFixed(1), getRsiTone(m.rsi))}
                <td>
                  <HoldingBasketLinks baskets={h.baskets} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
})
