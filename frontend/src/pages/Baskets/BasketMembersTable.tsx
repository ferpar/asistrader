import { useMemo } from 'react'
import { observer } from '@legendapp/state/react'
import { useIndicatorStore } from '../../container/ContainerContext'
import type { BasketMember } from '../../domain/basket/types'
import type { TickerIndicators } from '../../domain/radar/types'
import { annualizedTir } from '../../domain/radar/indicators'
import { useMultiSort, useSortedRows, type Sortable } from '../../hooks/useMultiSort'
import { SortableTh } from '../../components/table/SortableTh'
import { fmtPct } from '../../components/portfolio/format'
import { signClass } from '../../components/portfolio/signClass'
import styles from './Baskets.module.css'
import detail from './BasketDetail.module.css'

type MemberKey =
  | 'symbol'
  | 'held'
  | 'momentum'
  | 'r1m'
  | 'r3m'
  | 'r6m'
  | 'r1y'
  | 'bullish'
  | 'lrSlope'
  | 'lrR2'
  | 'tir'
  | 'rsi'

/** Why a member's measures may be empty: still loading, or no indicator set for its ticker. */
type MeasureStatus = 'ready' | 'loading' | 'missing'

interface Row {
  member: BasketMember
  indicators: TickerIndicators | undefined
  status: MeasureStatus
}

function measure(ind: TickerIndicators | undefined, key: Exclude<MemberKey, 'symbol' | 'held'>): number | null {
  if (!ind) return null
  const lr = ind.linearRegression.lr50
  switch (key) {
    case 'momentum':
      return ind.momentum.score
    case 'r1m':
      return ind.momentum.r1m
    case 'r3m':
      return ind.momentum.r3m
    case 'r6m':
      return ind.momentum.r6m
    case 'r1y':
      return ind.momentum.r1y
    case 'bullish':
      return ind.sma.bullishScore
    case 'lrSlope':
      return lr.slopePct
    case 'lrR2':
      return lr.r2
    case 'tir':
      return annualizedTir(lr.slopePct)
    case 'rsi':
      return ind.rsi.latest
  }
}

function rowValue(row: Row, key: MemberKey): Sortable {
  if (key === 'symbol') return row.member.symbol
  if (key === 'held') return row.member.heldIn.length
  return measure(row.indicators, key)
}

function emptyTitle(row: Row): string {
  if (row.status === 'loading') return 'Measuring…'
  if (row.status === 'missing') return 'Not measured yet: no market data loaded for this ticker'
  return row.indicators?.error ?? 'Not enough price history'
}

/**
 * A Basket's members ranked by the same measures as the Basket ranking. The
 * measures are each member's ticker indicator set from the IndicatorStore, so
 * they match the radar card; "Held in" lists the user's Portfolios holding it.
 * Every column sorts (Momentum Score by default); shift-click adds a tie-breaker.
 */
export const BasketMembersTable = observer(function BasketMembersTable({
  members,
  onOpenPortfolio,
}: {
  members: BasketMember[]
  onOpenPortfolio: (id: number) => void
}) {
  const indicatorStore = useIndicatorStore()
  const indicators = indicatorStore.indicators$.get()
  const loading = indicatorStore.loading$.get()

  const rows = useMemo<Row[]>(() => {
    const bySymbol = new Map(indicators.map((ind) => [ind.symbol.toUpperCase(), ind]))
    return members.map((member) => {
      const ind = bySymbol.get(member.symbol.toUpperCase())
      return { member, indicators: ind, status: ind ? 'ready' : loading ? 'loading' : 'missing' }
    })
  }, [members, indicators, loading])

  const sort = useMultiSort<MemberKey>([{ key: 'momentum', dir: 'desc' }])
  const sorted = useSortedRows(rows, sort.terms, rowValue)

  const th = (label: string, key: MemberKey, title?: string, numeric = true) => (
    <SortableTh label={label} sortKey={key} numeric={numeric} sort={sort} title={title} />
  )

  const cell = (row: Row, value: number | null, format: (v: number) => string, signed = false, strong = false) =>
    value === null ? (
      <td className={`${styles.num} ${detail.muted}`} title={emptyTitle(row)}>
        {row.status === 'loading' ? '…' : '—'}
      </td>
    ) : (
      <td className={`${styles.num} ${strong ? styles.strong : ''} ${signed ? signClass(value) : ''}`}>
        {format(value)}
      </td>
    )

  if (members.length === 0) return <p className={styles.hint}>This Basket has no members.</p>

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {th('Ticker', 'symbol', undefined, false)}
            {th('Held in', 'held', 'Your Portfolios that currently hold it; sorts by how many', false)}
            {th('Momentum', 'momentum', 'Momentum Score: 0.35·r1M + 0.30·r3M + 0.20·r6M + 0.15·r1Y (adjusted closes)')}
            {th('r1M', 'r1m', 'Return over 21 trading days')}
            {th('r3M', 'r3m', 'Return over 63 trading days')}
            {th('r6M', 'r6m', 'Return over 126 trading days')}
            {th('r1Y', 'r1y', 'Return over 252 trading days')}
            {th('Bullish', 'bullish', 'SMA structure bullish score, 0–10')}
            {th('LR50 %/d', 'lrSlope', '50-day linear regression slope, % per day')}
            {th('LR50 R²', 'lrR2', '50-day linear regression fit')}
            {th('TIR', 'tir', 'Annualised TIR = 50-day slope %/day × 365')}
            {th('RSI', 'rsi', '14-day RSI')}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const { member, indicators: ind } = row
            return (
              <tr key={member.symbol}>
                <td>
                  <span className={styles.strong}>{member.symbol}</span>
                  {member.name && <div className={detail.muted}>{member.name}</div>}
                </td>
                <td>
                  {member.heldIn.length === 0 ? (
                    <span className={detail.muted}>—</span>
                  ) : (
                    <span className={detail.heldIn}>
                      {member.heldIn.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className={detail.held}
                          onClick={() => onOpenPortfolio(p.id)}
                        >
                          {p.name}
                        </button>
                      ))}
                    </span>
                  )}
                </td>
                {cell(row, measure(ind, 'momentum'), fmtPct, true, true)}
                {cell(row, measure(ind, 'r1m'), fmtPct, true)}
                {cell(row, measure(ind, 'r3m'), fmtPct, true)}
                {cell(row, measure(ind, 'r6m'), fmtPct, true)}
                {cell(row, measure(ind, 'r1y'), fmtPct, true)}
                {cell(row, measure(ind, 'bullish'), (v) => String(v))}
                {cell(row, measure(ind, 'lrSlope'), fmtPct, true)}
                {cell(row, measure(ind, 'lrR2'), (v) => v.toFixed(2))}
                {cell(row, measure(ind, 'tir'), fmtPct, true)}
                {cell(row, measure(ind, 'rsi'), (v) => v.toFixed(0))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
})
