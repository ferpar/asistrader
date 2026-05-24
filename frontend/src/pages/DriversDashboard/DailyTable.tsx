import type { DailyPoint } from '../../domain/irr/types'
import { useMultiSort, useSortedRows } from '../../hooks/useMultiSort'
import { fmtMoney, fmtPct } from './format'
import { signClass } from './signClass'
import { SortableTh } from './SortableTh'
import shared from './shared.module.css'

type DailyKey =
  | 'date'
  | 'trades'
  | 'investment'
  | 'profit'
  | 'return'
  | 'avgDays'
  | 'tir'
  | 'enhReturn'
  | 'enhTir'
  | 'idle'

function dailyValue(d: DailyPoint, key: DailyKey) {
  switch (key) {
    case 'date':
      return d.date
    case 'trades':
      return d.tradeCount
    case 'investment':
      return d.investmentBase
    case 'profit':
      return d.profitBase
    case 'return':
      return d.returnPct
    case 'avgDays':
      return d.avgHoldingDays
    case 'tir':
      return d.tir
    case 'enhReturn':
      return d.enhancedReturnPct
    case 'enhTir':
      return d.enhancedTir
    case 'idle':
      return d.idlePoolBase
  }
}

export function DailyTable({
  rows,
  ccy,
  showEnhanced,
}: {
  rows: DailyPoint[]
  ccy: string
  showEnhanced: boolean
}) {
  const sort = useMultiSort<DailyKey>([{ key: 'date', dir: 'asc' }])
  const sorted = useSortedRows(rows, sort.terms, dailyValue)
  return (
    <div className={shared.tableWrap}>
      <table className={shared.table}>
        <thead>
          <tr>
            <SortableTh label="Date" sortKey="date" sort={sort} />
            <SortableTh label="Trades" sortKey="trades" numeric sort={sort} />
            <SortableTh label="Investment" sortKey="investment" numeric sort={sort} />
            <SortableTh label="Profit" sortKey="profit" numeric sort={sort} />
            <SortableTh label="Return %" sortKey="return" numeric sort={sort} />
            <SortableTh label="Avg Days" sortKey="avgDays" numeric sort={sort} />
            <SortableTh label="Daily TIR" sortKey="tir" numeric sort={sort} />
            {showEnhanced && (
              <SortableTh label="Enhanced %" sortKey="enhReturn" numeric sort={sort} />
            )}
            {showEnhanced && (
              <SortableTh label="Enhanced TIR" sortKey="enhTir" numeric sort={sort} />
            )}
            {showEnhanced && (
              <SortableTh label="Idle Pool" sortKey="idle" numeric sort={sort} />
            )}
          </tr>
        </thead>
        <tbody>
          {sorted.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td className={shared.num}>{d.tradeCount}</td>
              <td className={shared.num}>{fmtMoney(d.investmentBase, ccy)}</td>
              <td className={`${shared.num} ${signClass(d.profitBase)}`}>
                {fmtMoney(d.profitBase, ccy)}
              </td>
              <td className={`${shared.num} ${signClass(d.returnPct)}`}>
                {fmtPct(d.returnPct)}
              </td>
              <td className={shared.num}>{d.avgHoldingDays.toFixed(1)}</td>
              <td className={`${shared.num} ${signClass(d.tir)}`}>{fmtPct(d.tir)}</td>
              {showEnhanced && (
                <td className={shared.num}>
                  {d.enhancedReturnPct !== null ? fmtPct(d.enhancedReturnPct) : '—'}
                </td>
              )}
              {showEnhanced && (
                <td className={shared.num}>
                  {d.enhancedTir !== null ? fmtPct(d.enhancedTir) : '—'}
                </td>
              )}
              {showEnhanced && (
                <td className={shared.num}>
                  {d.idlePoolBase !== null ? fmtMoney(d.idlePoolBase, ccy) : '—'}
                  {d.idleTradeCount !== null && (
                    <span className={shared.muted}> ({d.idleTradeCount})</span>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
