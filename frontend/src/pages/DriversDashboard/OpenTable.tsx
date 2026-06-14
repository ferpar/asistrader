import type { OpenRow } from './openSelectors'
import { useMultiSort, useSortedRows } from '../../hooks/useMultiSort'
import { useTopN } from '../../hooks/useTopN'
import { fmtMoney, fmtPct } from '../../components/portfolio/format'
import { signClass } from '../../components/portfolio/signClass'
import { SortableTh } from '../../components/table/SortableTh'
import { ShowMore } from '../../components/table/ShowMore'
import { ConvergenceChip } from '../../components/ConvergenceChip'
import shared from './shared.module.css'
import styles from './OrderedSection.module.css'

const ROW_LIMIT = 12

const HEALTH_INTRO =
  'Signed score in [−100, +100]. Positive = price trending toward the take-profit; negative = trending toward the stop-loss.'

type OpenKey =
  | 'tradeNumber'
  | 'ticker'
  | 'strategy'
  | 'entry'
  | 'current'
  | 'pnl'
  | 'position'
  | 'toTP'
  | 'toSL'
  | 'holding'
  | 'amount'
  | 'bullish'
  | 'health'

function value(r: OpenRow, key: OpenKey) {
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
    case 'pnl':
      return r.unrealizedPnLPct
    case 'position':
      return r.positionToTarget
    case 'toTP':
      return r.distanceToTP
    case 'toSL':
      return r.distanceToSL
    case 'holding':
      return r.holdingDays
    case 'amount':
      return r.amount
    case 'bullish':
      return r.bullishScore
    case 'health':
      return r.health?.score ?? null
  }
}

function formatDays(value: number | null): string {
  return value === null ? '—' : `${value}d`
}

function formatPrice(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

function formatPctCell(value: number | null): string {
  return value === null ? '—' : fmtPct(value)
}

export function OpenTable({
  rows,
  ccy,
  highlightIds,
}: {
  rows: OpenRow[]
  ccy: string
  /** Subset of trade ids matching the active search; renders with a highlight class. */
  highlightIds: Set<number>
}) {
  const sort = useMultiSort<OpenKey>([{ key: 'position', dir: 'desc' }])
  const sorted = useSortedRows(rows, sort.terms, value)
  const top = useTopN(sorted, ROW_LIMIT)

  const hasHealthData = rows.some((r) => r.health !== null || r.bullishScore !== null)

  if (rows.length === 0) {
    return <p className={shared.empty}>No open trades match this search.</p>
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
            <SortableTh label="P&L %" sortKey="pnl" numeric sort={sort} />
            <SortableTh label="To TP" sortKey="toTP" numeric title="% of the way from PE to take-profit" sort={sort} />
            <SortableTh label="To SL" sortKey="toSL" numeric title="% of the way from PE to stop-loss" sort={sort} />
            <SortableTh label="Holding" sortKey="holding" numeric sort={sort} />
            <SortableTh label="Amount" sortKey="amount" numeric sort={sort} />
            {hasHealthData && (
              <>
                <SortableTh label="SMA align" sortKey="bullish" numeric sort={sort} />
                <SortableTh label="Health" sortKey="health" numeric sort={sort} />
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {top.visible.map((r) => (
            <tr key={r.tradeId} className={highlightIds.has(r.tradeId) ? styles.rowHighlight : ''}>
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
                  r.unrealizedPnLPct !== null ? signClass(r.unrealizedPnLPct) : ''
                }`}
              >
                {formatPctCell(r.unrealizedPnLPct)}
              </td>
              <td className={shared.num}>{formatPctCell(r.distanceToTP)}</td>
              <td className={shared.num}>{formatPctCell(r.distanceToSL)}</td>
              <td className={shared.num}>{formatDays(r.holdingDays)}</td>
              <td className={shared.num}>{fmtMoney(r.amount, ccy)}</td>
              {hasHealthData && (
                <>
                  <td className={shared.num}>
                    {r.bullishScore === null ? (
                      <span className={shared.muted}>—</span>
                    ) : (
                      `${r.bullishScore}/10`
                    )}
                  </td>
                  <td className={shared.num}>
                    {r.health ? (
                      <ConvergenceChip score={r.health} title="Health" intro={HEALTH_INTRO} />
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
      {top.canExpand && <ShowMore expanded={top.expanded} total={top.total} onToggle={top.toggle} />}
    </div>
  )
}
