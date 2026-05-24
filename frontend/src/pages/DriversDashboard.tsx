import { useEffect, useMemo, useState } from 'react'
import { observer } from '@legendapp/state/react'
import { useIrrStore } from '../container/ContainerContext'
import type {
  DailyPoint,
  DailyView,
  GroupIrr,
  ScopeBlock,
  TickerView,
  TradeIrr,
} from '../domain/irr/types'
import { useMultiSort, useSortedRows, type SortTerm } from '../hooks/useMultiSort'
import { Histogram } from '../components/charts/Histogram'
import { TimeSeriesChart } from '../components/charts/TimeSeriesChart'
import { NormalParamsChart } from '../components/charts/NormalParamsChart'
import styles from './DriversDashboard.module.css'

// ── Formatting helpers ──

function fmtMoney(value: number, ccy: string): string {
  if (ccy === 'GBp' || ccy === 'GBX') return `${value.toFixed(0)} GBp`
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: ccy || 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

/** XIRR on sub-month trades genuinely explodes — clamp the display. */
function fmtXirr(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  if (value > 100) return '>10,000%'
  if (value < -1) return '<-100%'
  return fmtPct(value)
}

function signClass(value: number): string {
  if (value > 0) return styles.pos
  if (value < 0) return styles.neg
  return ''
}

// ── Sortable column header ──

interface SortCtl<K extends string> {
  terms: SortTerm<K>[]
  toggle: (key: K, additive: boolean) => void
  priorityOf: (key: K) => number
  dirOf: (key: K) => 'asc' | 'desc' | null
}

function SortableTh<K extends string>({
  label,
  sortKey,
  numeric,
  sort,
}: {
  label: string
  sortKey: K
  numeric?: boolean
  sort: SortCtl<K>
}) {
  const dir = sort.dirOf(sortKey)
  const showPriority = sort.terms.length > 1 && dir !== null
  return (
    <th
      className={`${numeric ? styles.num : ''} ${styles.sortable} ${dir ? styles.sortActive : ''}`}
      onClick={(e) => sort.toggle(sortKey, e.shiftKey)}
      title="Click to sort · Shift-click to add a tie-breaker column"
      aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}
    >
      {label}
      {dir && <span className={styles.sortArrow}>{dir === 'asc' ? '▲' : '▼'}</span>}
      {showPriority && <span className={styles.sortPriority}>{sort.priorityOf(sortKey)}</span>}
    </th>
  )
}

/** Toggle button row shared by the scope and daily view switches. */
function Toggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
}) {
  return (
    <div className={styles.toggle}>
      {options.map((o) => (
        <button
          key={o.id}
          className={`${styles.toggleBtn} ${value === o.id ? styles.toggleBtnActive : ''}`}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ── Per-transaction table ──

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

function TransactionTable({ rows, ccy }: { rows: TradeIrr[]; ccy: string }) {
  const sort = useMultiSort<TxnKey>([{ key: 'closed', dir: 'desc' }])
  const sorted = useSortedRows(rows, sort.terms, txnValue)
  if (rows.length === 0) {
    return <p className={styles.empty}>No transactions in this view.</p>
  }
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
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
                <span className={styles.ticker}>{r.ticker}</span>
                <span className={styles.muted}> · {r.currency}</span>
                {r.tickerName && <span className={styles.muted}> · {r.tickerName}</span>}
              </td>
              <td>{r.dateOrdered ?? '—'}</td>
              <td>{r.exitDate ?? '—'}</td>
              <td className={styles.num}>{r.holdingDays}</td>
              <td className={styles.num}>{fmtMoney(r.investmentBase, ccy)}</td>
              <td className={`${styles.num} ${signClass(r.profitBase)}`}>
                {fmtMoney(r.profitBase, ccy)}
              </td>
              <td className={`${styles.num} ${signClass(r.fxDriftBase)}`}>
                {r.currency === ccy ? '—' : fmtMoney(r.fxDriftBase, ccy)}
              </td>
              <td className={`${styles.num} ${signClass(r.returnPct)}`}>
                {fmtPct(r.returnPct)}
              </td>
              <td className={`${styles.num} ${signClass(r.tir)}`}>{fmtPct(r.tir)}</td>
              <td className={styles.num}>{fmtXirr(r.xirr)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Per-ticker table ──

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

function TickerTable({ rows, ccy }: { rows: GroupIrr[]; ccy: string }) {
  const sort = useMultiSort<GroupKey>([{ key: 'profit', dir: 'desc' }])
  const sorted = useSortedRows(rows, sort.terms, groupValue)
  if (rows.length === 0) {
    return <p className={styles.empty}>No tickers in this view.</p>
  }
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
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
                <span className={styles.ticker}>{g.label}</span>
                {g.currency && <span className={styles.muted}> · {g.currency}</span>}
                {g.tickerName && <span className={styles.muted}> · {g.tickerName}</span>}
              </td>
              <td className={styles.num}>{g.tradeCount}</td>
              <td className={styles.num}>{fmtMoney(g.investmentBase, ccy)}</td>
              <td className={`${styles.num} ${signClass(g.profitBase)}`}>
                {fmtMoney(g.profitBase, ccy)}
              </td>
              <td className={`${styles.num} ${signClass(g.fxDriftBase)}`}>
                {g.currency === ccy ? '—' : fmtMoney(g.fxDriftBase, ccy)}
              </td>
              <td className={`${styles.num} ${signClass(g.returnPct)}`}>
                {fmtPct(g.returnPct)}
              </td>
              <td className={styles.num}>{g.avgHoldingDays.toFixed(1)}</td>
              <td className={`${styles.num} ${signClass(g.tir)}`}>{fmtPct(g.tir)}</td>
              <td className={styles.num}>{fmtXirr(g.xirr)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Portfolio summary card ──

function PortfolioCard({ group, ccy }: { group: GroupIrr; ccy: string }) {
  const sameCcy = group.currency !== null && group.currency === ccy
  const metrics: { label: string; value: string; cls?: string }[] = [
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

// ── A realized / unrealized scope ──

const TICKER_VIEWS_REALIZED: { id: TickerView; label: string }[] = [
  { id: 'mixed', label: 'Mixed' },
  { id: 'winners', label: 'Winners' },
  { id: 'losers', label: 'Losers' },
]

const TICKER_VIEWS_UNREALIZED: { id: TickerView; label: string }[] = [
  { id: 'mixed', label: 'Mixed' },
  { id: 'winners', label: 'Winning' },
  { id: 'losers', label: 'Losing' },
]

function ScopeSection({
  title,
  scope,
  ccy,
  unrealized = false,
}: {
  title: string
  scope: ScopeBlock
  ccy: string
  /** Switches the winners/losers toggle to present-tense Winning/Losing for
   *  open positions, where the outcome isn't locked in. */
  unrealized?: boolean
}) {
  const [tickerView, setTickerView] = useState<TickerView>('mixed')

  const tickerViews = unrealized ? TICKER_VIEWS_UNREALIZED : TICKER_VIEWS_REALIZED
  const winLossNoun = unrealized ? 'Winning / losing' : 'Winners / losers'

  const portfolioGroup =
    tickerView === 'winners'
      ? scope.portfolioWinners
      : tickerView === 'losers'
        ? scope.portfolioLosers
        : scope.portfolio

  const tickerRows =
    tickerView === 'winners'
      ? scope.byTickerWinners
      : tickerView === 'losers'
        ? scope.byTickerLosers
        : scope.byTicker

  const txnRows = useMemo(() => {
    if (tickerView === 'winners') return scope.transactions.filter((t) => t.isWinner)
    if (tickerView === 'losers') return scope.transactions.filter((t) => t.profitNative < 0)
    return scope.transactions
  }, [scope.transactions, tickerView])

  // Toggle only makes sense once there's at least one trade in the scope.
  const showTickerViewToggle = scope.portfolio !== null

  const emptyMessage =
    tickerView === 'winners'
      ? `No ${title.toLowerCase()} ${unrealized ? 'winning' : 'winner'} trades.`
      : tickerView === 'losers'
        ? `No ${title.toLowerCase()} ${unrealized ? 'losing' : 'loser'} trades.`
        : `No ${title.toLowerCase()} trades yet.`

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>{title}</h3>
        {showTickerViewToggle && (
          <Toggle options={tickerViews} value={tickerView} onChange={setTickerView} />
        )}
      </div>
      {showTickerViewToggle && (
        <p className={styles.note}>
          {winLossNoun} re-aggregate the summary, each ticker and the trade
          list from only the winning or losing trades — so the two sides can be
          read without diluting each other.
        </p>
      )}
      {portfolioGroup ? (
        <PortfolioCard group={portfolioGroup} ccy={ccy} />
      ) : (
        <p className={styles.empty}>{emptyMessage}</p>
      )}

      {tickerRows.length > 0 && (
        <>
          <h4 className={styles.subTitle}>By ticker</h4>
          <TickerTable rows={tickerRows} ccy={ccy} />
        </>
      )}

      {txnRows.length > 0 && (
        <>
          <h4 className={styles.subTitle}>By transaction</h4>
          <TransactionTable rows={txnRows} ccy={ccy} />
        </>
      )}
    </section>
  )
}

// ── Daily section ──

const DAILY_VIEWS: { id: DailyView; label: string }[] = [
  { id: 'mixed', label: 'Mixed' },
  { id: 'winners', label: 'Winners' },
  { id: 'losers', label: 'Losers' },
]

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

function DailyTable({
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
    <div className={styles.tableWrap}>
      <table className={styles.table}>
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
              <td className={styles.num}>{d.tradeCount}</td>
              <td className={styles.num}>{fmtMoney(d.investmentBase, ccy)}</td>
              <td className={`${styles.num} ${signClass(d.profitBase)}`}>
                {fmtMoney(d.profitBase, ccy)}
              </td>
              <td className={`${styles.num} ${signClass(d.returnPct)}`}>
                {fmtPct(d.returnPct)}
              </td>
              <td className={styles.num}>{d.avgHoldingDays.toFixed(1)}</td>
              <td className={`${styles.num} ${signClass(d.tir)}`}>{fmtPct(d.tir)}</td>
              {showEnhanced && (
                <td className={styles.num}>
                  {d.enhancedReturnPct !== null ? fmtPct(d.enhancedReturnPct) : '—'}
                </td>
              )}
              {showEnhanced && (
                <td className={styles.num}>
                  {d.enhancedTir !== null ? fmtPct(d.enhancedTir) : '—'}
                </td>
              )}
              {showEnhanced && (
                <td className={styles.num}>
                  {d.idlePoolBase !== null ? fmtMoney(d.idlePoolBase, ccy) : '—'}
                  {d.idleTradeCount !== null && (
                    <span className={styles.muted}> ({d.idleTradeCount})</span>
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

const fmtPctTick = (v: number) => `${(v * 100).toFixed(0)}%`
const fmtDaysTick = (v: number) => `${v.toFixed(0)}d`

/** Histograms, time series and rolling-normal charts for the daily series. */
function DailyDistributions({ points }: { points: DailyPoint[] }) {
  const { tirValues, dayValues, dates, series } = useMemo(() => {
    const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date))
    return {
      tirValues: sorted.map((p) => p.tir),
      dayValues: sorted.map((p) => p.avgHoldingDays),
      dates: sorted.map((p) => p.date),
      series: sorted.map((p) => ({
        date: p.date,
        tir: p.tir,
        avgDays: p.avgHoldingDays,
      })),
    }
  }, [points])

  if (points.length === 0) {
    return <p className={styles.empty}>No closed trades to chart for this view.</p>
  }

  return (
    <div className={styles.charts}>
      <h4 className={styles.subTitle}>Distributions</h4>
      <div className={styles.chartGrid}>
        <Histogram
          values={tirValues}
          title="Daily annualized TIR"
          caption="Frequency of daily TIR, with the fitted normal curve and cumulative %."
          formatValue={fmtPctTick}
        />
        <Histogram
          values={dayValues}
          title="Daily average holding days"
          caption="Frequency of the per-day average holding period."
          formatValue={fmtDaysTick}
        />
      </div>

      <h4 className={styles.subTitle}>Through time</h4>
      <TimeSeriesChart
        points={series}
        title="Daily TIR & average holding days"
        caption="One point per day a trade closed."
      />

      <h4 className={styles.subTitle}>Normal-fit parameters by day</h4>
      <div className={styles.chartGrid}>
        <NormalParamsChart
          dates={dates}
          values={tirValues}
          title="TIR — cumulative μ ± σ"
          caption="The normal fit of daily TIR as it stabilizes with each new day."
          formatValue={fmtPctTick}
        />
        <NormalParamsChart
          dates={dates}
          values={dayValues}
          title="Avg days — cumulative μ ± σ"
          caption="The normal fit of daily average holding days over time."
          formatValue={fmtDaysTick}
        />
      </div>
    </div>
  )
}

function DailySection({
  daily,
  ccy,
}: {
  daily: { mixed: DailyPoint[]; winners: DailyPoint[]; losers: DailyPoint[] }
  ccy: string
}) {
  const [view, setView] = useState<DailyView>('mixed')
  const rows = daily[view]
  const showEnhanced = view === 'mixed'

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Daily annualized return</h3>
      <p className={styles.note}>
        One point per day a trade closed. The winners / losers / mixed views split
        by trade outcome. <strong>Enhanced</strong> charges each day a share of the
        idle capital pool (ordered + open trades) — shown for the mixed view only.
      </p>
      <Toggle options={DAILY_VIEWS} value={view} onChange={setView} />
      {rows.length === 0 ? (
        <p className={styles.empty}>No closed trades for this view.</p>
      ) : (
        <>
          <DailyTable rows={rows} ccy={ccy} showEnhanced={showEnhanced} />
          <DailyDistributions points={rows} />
        </>
      )}
    </section>
  )
}

// ── Page ──

export const DriversDashboard = observer(function DriversDashboard() {
  const store = useIrrStore()

  useEffect(() => {
    store.loadAnalysis()
  }, [store])

  const analysis = store.analysis$.get()
  const loading = store.loading$.get()
  const error = store.error$.get()

  return (
    <section>
      <h2>Drivers — IRR / TIR Analysis</h2>
      <p className={styles.note}>
        Measures the cash-making drivers of each trade. <strong>TIR</strong> is the
        simple annualized return (return % ÷ holding days × 365);{' '}
        <strong>XIRR</strong> is the true compound rate. The holding period runs from
        the order date (capital committed) to close. Click a column header to sort —
        shift-click to add tie-breaker columns.
      </p>

      {error && <div className={styles.error}>{error}</div>}
      {loading && !analysis && <p className={styles.empty}>Loading analysis…</p>}

      {analysis && (
        <>
          <ScopeSection
            title="Realized"
            scope={analysis.realized}
            ccy={analysis.baseCurrency}
          />
          <ScopeSection
            title="Unrealized"
            scope={analysis.unrealized}
            ccy={analysis.baseCurrency}
            unrealized
          />
          <DailySection daily={analysis.daily} ccy={analysis.baseCurrency} />
        </>
      )}
    </section>
  )
})
