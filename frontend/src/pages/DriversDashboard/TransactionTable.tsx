import type { TradeIrr } from '../../domain/irr/types'
import { useMultiSort, useSortedRows } from '../../hooks/useMultiSort'
import { fmtMoney, fmtPct, fmtXirr } from '../../components/portfolio/format'
import { signClass } from '../../components/portfolio/signClass'
import { SortableTh } from './SortableTh'
import shared from './shared.module.css'

type TxnKey =
  | 'ticker'
  | 'ordered'
  | 'closed'
  | 'days'
  | 'investment'
  | 'profit'
  | 'fxDrift'
  | 'return'
  | 'tir'
  | 'xirr'

function txnValue(r: TradeIrr, key: TxnKey) {
  switch (key) {
    case 'ticker':
      return r.ticker
    case 'ordered':
      return r.dateOrdered
    case 'closed':
      return r.exitDate
    case 'days':
      return r.holdingDays
    case 'investment':
      return r.investmentBase
    case 'profit':
      return r.profitBase
    case 'fxDrift':
      return r.fxDriftBase
    case 'return':
      return r.returnPct
    case 'tir':
      return r.tir
    case 'xirr':
      return r.xirr
  }
}

export function TransactionTable({ rows, ccy }: { rows: TradeIrr[]; ccy: string }) {
  const sort = useMultiSort<TxnKey>([{ key: 'closed', dir: 'desc' }])
  const sorted = useSortedRows(rows, sort.terms, txnValue)
  if (rows.length === 0) {
    return <p className={shared.empty}>No transactions in this view.</p>
  }
  return (
    <div className={shared.tableWrap}>
      <table className={shared.table}>
        <thead>
          <tr>
            <SortableTh label="Ticker" sortKey="ticker" sort={sort} />
            <SortableTh label="Ordered" sortKey="ordered" sort={sort} />
            <SortableTh label="Closed" sortKey="closed" sort={sort} />
            <SortableTh label="Days" sortKey="days" numeric sort={sort} />
            <SortableTh label="Investment" sortKey="investment" numeric sort={sort} />
            <SortableTh label="Profit" sortKey="profit" numeric sort={sort} />
            <SortableTh label="FX drift" sortKey="fxDrift" numeric sort={sort} />
            <SortableTh label="Return %" sortKey="return" numeric sort={sort} />
            <SortableTh label="TIR" sortKey="tir" numeric sort={sort} />
            <SortableTh label="XIRR" sortKey="xirr" numeric sort={sort} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.tradeId}>
              <td>
                <span className={shared.ticker}>{r.ticker}</span>
                <span className={shared.muted}> · {r.currency}</span>
                {r.tickerName && <span className={shared.muted}> · {r.tickerName}</span>}
              </td>
              <td>{r.dateOrdered ?? '—'}</td>
              <td>{r.exitDate ?? '—'}</td>
              <td className={shared.num}>{r.holdingDays}</td>
              <td className={shared.num}>{fmtMoney(r.investmentBase, ccy)}</td>
              <td className={`${shared.num} ${signClass(r.profitBase)}`}>
                {fmtMoney(r.profitBase, ccy)}
              </td>
              <td className={`${shared.num} ${signClass(r.fxDriftBase)}`}>
                {r.currency === ccy ? '—' : fmtMoney(r.fxDriftBase, ccy)}
              </td>
              <td className={`${shared.num} ${signClass(r.returnPct)}`}>
                {fmtPct(r.returnPct)}
              </td>
              <td className={`${shared.num} ${signClass(r.tir)}`}>{fmtPct(r.tir)}</td>
              <td className={shared.num}>{fmtXirr(r.xirr)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
