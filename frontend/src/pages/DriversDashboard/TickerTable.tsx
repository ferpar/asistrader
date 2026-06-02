import type { GroupIrr } from '../../domain/irr/types'
import { useMultiSort, useSortedRows } from '../../hooks/useMultiSort'
import { fmtMoney, fmtPct, fmtXirr } from '../../components/portfolio/format'
import { signClass } from '../../components/portfolio/signClass'
import { SortableTh } from './SortableTh'
import shared from './shared.module.css'

type GroupKey =
  | 'ticker'
  | 'trades'
  | 'investment'
  | 'profit'
  | 'fxDrift'
  | 'return'
  | 'avgDays'
  | 'tir'
  | 'xirr'

function groupValue(g: GroupIrr, key: GroupKey) {
  switch (key) {
    case 'ticker':
      return g.label
    case 'trades':
      return g.tradeCount
    case 'investment':
      return g.investmentBase
    case 'profit':
      return g.profitBase
    case 'fxDrift':
      return g.fxDriftBase
    case 'return':
      return g.returnPct
    case 'avgDays':
      return g.avgHoldingDays
    case 'tir':
      return g.tir
    case 'xirr':
      return g.xirr
  }
}

export function TickerTable({ rows, ccy }: { rows: GroupIrr[]; ccy: string }) {
  const sort = useMultiSort<GroupKey>([{ key: 'profit', dir: 'desc' }])
  const sorted = useSortedRows(rows, sort.terms, groupValue)
  if (rows.length === 0) {
    return <p className={shared.empty}>No tickers in this view.</p>
  }
  return (
    <div className={shared.tableWrap}>
      <table className={shared.table}>
        <thead>
          <tr>
            <SortableTh label="Ticker" sortKey="ticker" sort={sort} />
            <SortableTh label="Trades" sortKey="trades" numeric sort={sort} />
            <SortableTh label="Investment" sortKey="investment" numeric sort={sort} />
            <SortableTh label="Profit" sortKey="profit" numeric sort={sort} />
            <SortableTh label="FX drift" sortKey="fxDrift" numeric sort={sort} />
            <SortableTh label="Return %" sortKey="return" numeric sort={sort} />
            <SortableTh label="Avg Days" sortKey="avgDays" numeric sort={sort} />
            <SortableTh label="TIR" sortKey="tir" numeric sort={sort} />
            <SortableTh label="XIRR" sortKey="xirr" numeric sort={sort} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((g) => (
            <tr key={g.label}>
              <td>
                <span className={shared.ticker}>{g.label}</span>
                {g.currency && <span className={shared.muted}> · {g.currency}</span>}
                {g.tickerName && <span className={shared.muted}> · {g.tickerName}</span>}
              </td>
              <td className={shared.num}>{g.tradeCount}</td>
              <td className={shared.num}>{fmtMoney(g.investmentBase, ccy)}</td>
              <td className={`${shared.num} ${signClass(g.profitBase)}`}>
                {fmtMoney(g.profitBase, ccy)}
              </td>
              <td className={`${shared.num} ${signClass(g.fxDriftBase)}`}>
                {g.currency === ccy ? '—' : fmtMoney(g.fxDriftBase, ccy)}
              </td>
              <td className={`${shared.num} ${signClass(g.returnPct)}`}>
                {fmtPct(g.returnPct)}
              </td>
              <td className={shared.num}>{g.avgHoldingDays.toFixed(1)}</td>
              <td className={`${shared.num} ${signClass(g.tir)}`}>{fmtPct(g.tir)}</td>
              <td className={shared.num}>{fmtXirr(g.xirr)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
