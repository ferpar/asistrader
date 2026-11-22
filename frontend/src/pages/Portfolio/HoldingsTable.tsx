import { useMemo, useState } from 'react'
import { observer } from '@legendapp/state/react'
import { useIndicatorStore } from '../../container/ContainerContext'
import { fmtMoney, fmtPct, fmtPct1 } from '../../components/portfolio/format'
import { signClass } from '../../components/portfolio/signClass'
import { getRsiTone } from '../../components/radar/rsiHelpers'
import { SortableTh } from '../../components/table/SortableTh'
import { useMultiSort, useSortedRows, type Sortable } from '../../hooks/useMultiSort'
import {
  ASSET_CLASS_LABELS,
  type AssetClassChoice,
  type AssetClassSubtotal,
  type Holding,
} from '../../domain/portfolio/types'
import { holdingMeasures, type HoldingMeasures } from '../../domain/portfolio/holdingMeasures'
import { fmtDate, fmtOptionalPct, fmtPrice, fmtUnits } from './format'
import { HoldingBasketLinks } from './HoldingBasketLinks'
import styles from './Portfolio.module.css'

type SortKey =
  | 'ticker'
  | 'value'
  | 'weight'
  | 'daysOpen'
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

/** The radar measure columns, which subtotal rows leave blank (as well as Baskets). */
const MEASURE_COLUMNS = 6

const OVERRIDE_CHOICES: AssetClassChoice[] = ['domestic_stock', 'international_stock', 'etf']

const fmtDays = (v: number | null) => (v === null ? '—' : v.toFixed(0))

function rowValue(row: Row, key: SortKey): Sortable {
  switch (key) {
    case 'ticker':
      return row.holding.ticker
    case 'value':
      return row.holding.value.toNumber()
    case 'weight':
      return row.holding.weight
    case 'daysOpen':
      return row.holding.weightedDaysOpen
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
 * Holdings grouped by Asset Class, each group headed by a subtotal row
 * (count, Invested, Portfolio Value, weight, Weighted Days Open, Unrealized
 * Gain). Per ticker: cost/value figures plus the Momentum Score and radar
 * measures from the shared IndicatorStore (same values as the radar card).
 * Every column sorts within its group; shift-click adds a tie-breaker. The
 * Class column overrides a ticker's Asset Class (global, as tickers are).
 */
export const HoldingsTable = observer(function HoldingsTable({
  holdings,
  assetClasses,
  currency,
  onOverride,
}: {
  holdings: Holding[]
  assetClasses: AssetClassSubtotal[]
  currency: string
  /** Set (or clear, with null) a ticker's Asset Class override. */
  onOverride: (symbol: string, assetClass: AssetClassChoice | null) => Promise<void>
}) {
  const indicatorStore = useIndicatorStore()
  const indicators = indicatorStore.indicators$.get()
  const loading = indicatorStore.loading$.get()
  const [saving, setSaving] = useState<string | null>(null)

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

  const changeOverride = async (symbol: string, value: string) => {
    setSaving(symbol)
    try {
      await onOverride(symbol, value === '' ? null : (value as AssetClassChoice))
    } finally {
      setSaving(null)
    }
  }

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

  const holdingRow = (row: Row) => {
    const h = row.holding
    const m = row.measures
    const gain = h.unrealizedGain.toNumber()
    return (
      <tr key={h.ticker}>
        <td>
          <strong>{h.ticker}</strong>
          {h.name && <div className={styles.muted}>{h.name}</div>}
        </td>
        <td>
          <select
            className={styles.classSelect}
            value={h.assetClassOverride ?? ''}
            disabled={saving === h.ticker}
            onChange={(e) => changeOverride(h.ticker, e.target.value)}
            title="Asset Class override (applies to this ticker everywhere)"
            aria-label={`Asset Class of ${h.ticker}`}
          >
            <option value="">Auto</option>
            {OVERRIDE_CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                {ASSET_CLASS_LABELS[choice]}
              </option>
            ))}
          </select>
        </td>
        <td className={styles.num}>{fmtUnits(h.units)}</td>
        <td className={styles.num} title={fmtDate(h.lastPriceDate)}>
          {fmtPrice(h.lastPrice)} <span className={styles.muted}>{h.currency}</span>
        </td>
        <td className={styles.num}>{fmtMoney(h.cost.toNumber(), currency)}</td>
        <td className={styles.num}>{fmtMoney(h.value.toNumber(), currency)}</td>
        <td className={styles.num}>{fmtOptionalPct(h.weight)}</td>
        <td className={styles.num}>{fmtDays(h.weightedDaysOpen)}</td>
        <td className={`${styles.num} ${signClass(gain)}`}>
          {fmtMoney(gain, currency)} <small>({fmtOptionalPct(h.unrealizedGainPct)})</small>
        </td>
        {measure(row, m.momentum, fmtPct1, signClass(m.momentum ?? 0))}
        {measure(row, m.bullishScore, (v) => `${v}/10`)}
        {measure(row, m.lrSlopePct, fmtPct, signClass(m.lrSlopePct ?? 0))}
        {measure(row, m.lrR2, (v) => v.toFixed(2))}
        {measure(row, m.tir, fmtPct1, signClass(m.tir ?? 0))}
        {measure(row, m.rsi, (v) => v.toFixed(1), getRsiTone(m.rsi))}
        <td>
          <HoldingBasketLinks baskets={h.baskets} />
        </td>
      </tr>
    )
  }

  const subtotalRow = (group: AssetClassSubtotal) => {
    const gain = group.unrealizedGain.toNumber()
    return (
      <tr className={styles.subtotal}>
        <td colSpan={4}>
          {ASSET_CLASS_LABELS[group.assetClass]}{' '}
          <span className={styles.muted}>
            ({group.count} {group.count === 1 ? 'Holding' : 'Holdings'})
          </span>
        </td>
        <td className={styles.num}>{fmtMoney(group.invested.toNumber(), currency)}</td>
        <td className={styles.num}>{fmtMoney(group.portfolioValue.toNumber(), currency)}</td>
        <td className={styles.num}>{fmtOptionalPct(group.weight)}</td>
        <td className={styles.num}>{fmtDays(group.weightedDaysOpen)}</td>
        <td className={`${styles.num} ${signClass(gain)}`}>
          {fmtMoney(gain, currency)} <small>({fmtOptionalPct(group.unrealizedGainPct)})</small>
        </td>
        {/* The radar measures and the Baskets column stay blank. */}
        <td colSpan={MEASURE_COLUMNS + 1} />
      </tr>
    )
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <SortableTh label="Ticker" sortKey="ticker" sort={sort} />
            <th>Class</th>
            <th className={styles.num}>Units</th>
            <th className={styles.num}>Last close</th>
            <th className={styles.num} title="Invested: cost of the remaining Lots">Cost</th>
            {th('Value', 'value')}
            {th('Weight', 'weight')}
            {th('Days open', 'daysOpen', 'Weighted Days Open: age of the Lots weighted by cost')}
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
        {assetClasses.map((group) => (
          <tbody key={group.assetClass}>
            {subtotalRow(group)}
            {sorted.filter((row) => row.holding.assetClass === group.assetClass).map(holdingRow)}
          </tbody>
        ))}
      </table>
    </div>
  )
})
