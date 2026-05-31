import type { OrderedRow, DriftBadge } from './orderedSelectors'
import { useMultiSort, useSortedRows } from '../../hooks/useMultiSort'
import { fmtMoney, fmtPct } from './format'
import { signClass } from './signClass'
import { SortableTh } from './SortableTh'
import { ConvergenceChip } from '../../components/ConvergenceChip'
import shared from './shared.module.css'
import styles from './OrderedSection.module.css'

type OrderedKey =
  | 'tradeNumber'
  | 'ticker'
  | 'strategy'
  | 'entry'
  | 'current'
  | 'position'
  | 'orderAge'
  | 'planAge'
  | 'planToOrder'
  | 'dateOrdered'
  | 'amount'
  | 'drift'
  | 'bullish'
  | 'convergence'

function value(r: OrderedRow, key: OrderedKey) {
  switch (key) {
    case 'tradeNumber':
      return r.tradeNumber
    case 'ticker':
      return r.ticker
    case 'strategy':
      return r.strategyName
    case 'entry':
      return r.entryPrice
    case 'current':
      return r.currentPrice
    case 'position':
      return r.positionPct
    case 'orderAge':
      return r.orderAgeDays
    case 'planAge':
      return r.planAgeDays
    case 'planToOrder':
      return r.planToOrderDays
    case 'dateOrdered':
      return r.dateOrdered ? r.dateOrdered.getTime() : null
    case 'amount':
      return r.amount
    case 'drift':
      return r.driftBadge
    case 'bullish':
      return r.bullishScore
    case 'convergence':
      return r.convergence?.score ?? null
  }
}

const DRIFT_CLASS: Record<DriftBadge, string> = {
  ahead: shared.pos,
  behind: shared.neg,
  'on pace': '',
  new: '',
  '↘ proj': shared.neg,
}

function formatDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : '—'
}

function formatDays(value: number | null): string {
  return value === null ? '—' : `${value}d`
}

function formatPrice(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

export function OrderedTable({
  rows,
  ccy,
  highlightIds,
  hasDriftData,
}: {
  rows: OrderedRow[]
  ccy: string
  /** Subset of trade ids matching the active search; renders with a highlight class. */
  highlightIds: Set<number>
  hasDriftData: boolean
}) {
  const sort = useMultiSort<OrderedKey>([{ key: 'position', dir: 'desc' }])
  const sorted = useSortedRows(rows, sort.terms, value)

  if (rows.length === 0) {
    return <p className={shared.empty}>No ordered trades match this search.</p>
  }

  return (
    <div className={shared.tableWrap}>
      <table className={shared.table}>
        <thead>
          <tr>
            <SortableTh label="#" sortKey="tradeNumber" numeric sort={sort} />
            <SortableTh label="Ticker" sortKey="ticker" sort={sort} />
            <SortableTh label="Strategy" sortKey="strategy" sort={sort} />
            <SortableTh label="PE" sortKey="entry" numeric sort={sort} />
            <SortableTh label="Current" sortKey="current" numeric sort={sort} />
            <SortableTh label="Position %" sortKey="position" numeric sort={sort} />
            <SortableTh label="Order age" sortKey="orderAge" numeric sort={sort} />
            <SortableTh label="Plan age" sortKey="planAge" numeric sort={sort} />
            <SortableTh label="Plan→Order" sortKey="planToOrder" numeric sort={sort} />
            <SortableTh label="Order date" sortKey="dateOrdered" sort={sort} />
            <SortableTh label="Amount" sortKey="amount" numeric sort={sort} />
            {hasDriftData && (
              <>
                <SortableTh label="Drift" sortKey="drift" sort={sort} />
                <SortableTh label="SMA align" sortKey="bullish" numeric sort={sort} />
                <SortableTh label="Conv." sortKey="convergence" numeric sort={sort} />
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr
              key={r.tradeId}
              className={highlightIds.has(r.tradeId) ? styles.rowHighlight : ''}
            >
              <td className={shared.num}>{r.tradeNumber ?? r.tradeId}</td>
              <td>
                <span className={shared.ticker}>{r.ticker}</span>
                {r.tickerName && <span className={shared.muted}> · {r.tickerName}</span>}
              </td>
              <td>{r.strategyName ?? <span className={shared.muted}>—</span>}</td>
              <td className={shared.num}>{formatPrice(r.entryPrice)}</td>
              <td className={shared.num}>{formatPrice(r.currentPrice)}</td>
              <td
                className={`${shared.num} ${
                  r.positionPct !== null ? signClass(r.positionPct) : ''
                }`}
              >
                {r.positionPct === null ? '—' : fmtPct(r.positionPct)}
              </td>
              <td className={shared.num}>{formatDays(r.orderAgeDays)}</td>
              <td className={shared.num}>{formatDays(r.planAgeDays)}</td>
              <td className={shared.num}>{formatDays(r.planToOrderDays)}</td>
              <td>{formatDate(r.dateOrdered)}</td>
              <td className={shared.num}>{fmtMoney(r.amount, ccy)}</td>
              {hasDriftData && (
                <>
                  <td className={r.driftBadge ? DRIFT_CLASS[r.driftBadge] : ''}>
                    {r.driftBadge ?? <span className={shared.muted}>—</span>}
                  </td>
                  <td className={shared.num}>
                    {r.bullishScore === null ? (
                      <span className={shared.muted}>—</span>
                    ) : (
                      `${r.bullishScore}/10`
                    )}
                  </td>
                  <td className={shared.num}>
                    {r.convergence ? (
                      <ConvergenceChip score={r.convergence} />
                    ) : (
                      <span className={shared.muted}>—</span>
                    )}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
