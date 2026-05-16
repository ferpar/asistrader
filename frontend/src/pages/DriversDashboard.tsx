import { useEffect, useState } from 'react'
import { observer } from '@legendapp/state/react'
import { useIrrStore } from '../container/ContainerContext'
import type {
  DailyPoint,
  DailyView,
  GroupIrr,
  ScopeBlock,
  TradeIrr,
} from '../domain/irr/types'
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

// ── Per-transaction table ──

function TransactionTable({ rows, ccy }: { rows: TradeIrr[]; ccy: string }) {
  if (rows.length === 0) {
    return <p className={styles.empty}>No transactions in this scope.</p>
  }
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Ordered</th>
            <th>Closed</th>
            <th className={styles.num}>Days</th>
            <th className={styles.num}>Investment</th>
            <th className={styles.num}>Profit</th>
            <th className={styles.num}>Return %</th>
            <th className={styles.num}>TIR</th>
            <th className={styles.num}>XIRR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.tradeId}>
              <td>
                <span className={styles.ticker}>{r.ticker}</span>
                {r.tickerName && <span className={styles.muted}> · {r.tickerName}</span>}
              </td>
              <td>{r.dateOrdered ?? '—'}</td>
              <td>{r.exitDate ?? '—'}</td>
              <td className={styles.num}>{r.holdingDays}</td>
              <td className={styles.num}>{fmtMoney(r.investmentBase, ccy)}</td>
              <td className={`${styles.num} ${signClass(r.profitBase)}`}>
                {fmtMoney(r.profitBase, ccy)}
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

function TickerTable({ rows, ccy }: { rows: GroupIrr[]; ccy: string }) {
  if (rows.length === 0) return null
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Ticker</th>
            <th className={styles.num}>Trades</th>
            <th className={styles.num}>Investment</th>
            <th className={styles.num}>Profit</th>
            <th className={styles.num}>Return %</th>
            <th className={styles.num}>Avg Days</th>
            <th className={styles.num}>TIR</th>
            <th className={styles.num}>XIRR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.label}>
              <td>
                <span className={styles.ticker}>{g.label}</span>
                {g.tickerName && <span className={styles.muted}> · {g.tickerName}</span>}
              </td>
              <td className={styles.num}>{g.tradeCount}</td>
              <td className={styles.num}>{fmtMoney(g.investmentBase, ccy)}</td>
              <td className={`${styles.num} ${signClass(g.profitBase)}`}>
                {fmtMoney(g.profitBase, ccy)}
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
  const metrics: { label: string; value: string; cls?: string }[] = [
    { label: 'Trades', value: String(group.tradeCount) },
    { label: 'Invested', value: fmtMoney(group.investmentBase, ccy) },
    {
      label: 'Profit',
      value: fmtMoney(group.profitBase, ccy),
      cls: signClass(group.profitBase),
    },
    {
      label: 'Return %',
      value: fmtPct(group.returnPct),
      cls: signClass(group.returnPct),
    },
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

function ScopeSection({
  title,
  scope,
  ccy,
}: {
  title: string
  scope: ScopeBlock
  ccy: string
}) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {scope.portfolio ? (
        <PortfolioCard group={scope.portfolio} ccy={ccy} />
      ) : (
        <p className={styles.empty}>No {title.toLowerCase()} trades yet.</p>
      )}
      {scope.byTicker.length > 0 && (
        <>
          <h4 className={styles.subTitle}>By ticker</h4>
          <TickerTable rows={scope.byTicker} ccy={ccy} />
        </>
      )}
      {scope.transactions.length > 0 && (
        <>
          <h4 className={styles.subTitle}>By transaction</h4>
          <TransactionTable rows={scope.transactions} ccy={ccy} />
        </>
      )}
    </section>
  )
}

// ── Daily section ──

const VIEWS: { id: DailyView; label: string }[] = [
  { id: 'mixed', label: 'Mixed' },
  { id: 'winners', label: 'Winners' },
  { id: 'losers', label: 'Losers' },
]

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
      <div className={styles.toggle}>
        {VIEWS.map((v) => (
          <button
            key={v.id}
            className={`${styles.toggleBtn} ${view === v.id ? styles.toggleBtnActive : ''}`}
            onClick={() => setView(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className={styles.empty}>No closed trades for this view.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Date</th>
                <th className={styles.num}>Trades</th>
                <th className={styles.num}>Investment</th>
                <th className={styles.num}>Profit</th>
                <th className={styles.num}>Return %</th>
                <th className={styles.num}>Avg Days</th>
                <th className={styles.num}>Daily TIR</th>
                {showEnhanced && <th className={styles.num}>Enhanced %</th>}
                {showEnhanced && <th className={styles.num}>Enhanced TIR</th>}
                {showEnhanced && <th className={styles.num}>Idle Pool</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
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
        the order date (capital committed) to close.
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
          />
          <DailySection daily={analysis.daily} ccy={analysis.baseCurrency} />
        </>
      )}
    </section>
  )
})
