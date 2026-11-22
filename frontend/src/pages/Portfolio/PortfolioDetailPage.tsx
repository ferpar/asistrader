import { useEffect, useState } from 'react'
import { observer } from '@legendapp/state/react'
import { usePortfolioStore, useRouterStore } from '../../container/ContainerContext'
import { fmtMoney, fmtPct } from '../../components/portfolio/format'
import { signClass } from '../../components/portfolio/signClass'
import type { Decimal } from '../../domain/shared/Decimal'
import type { Holding, PortfolioSummary, PortfolioTransaction } from '../../domain/portfolio/types'
import { TransactionForm } from './TransactionForm'
import styles from './Portfolio.module.css'

const fmtUnits = (units: Decimal | null) =>
  units === null ? '—' : units.toNumber().toLocaleString('en-US', { maximumFractionDigits: 6 })

const fmtPrice = (price: Decimal | null) =>
  price === null ? '—' : price.toNumber().toLocaleString('en-US', { maximumFractionDigits: 4 })

const fmtDate = (d: Date) => d.toLocaleDateString('en-CA')

const fmtOptionalPct = (value: number | null) => (value === null ? '—' : fmtPct(value))

/** Portfolio detail: KPI header, Holdings table and the Transactions list
 *  (add, edit and delete Buys and Sells). */
export const PortfolioDetailPage = observer(function PortfolioDetailPage({
  portfolioId,
}: {
  portfolioId: number
}) {
  const store = usePortfolioStore()
  const router = useRouterStore()

  useEffect(() => {
    store.loadDetail(portfolioId)
  }, [store, portfolioId])

  const portfolio = store.current$.get()
  const summary = store.summary$.get()
  const transactions = store.transactions$.get()
  const loading = store.detailLoading$.get()
  const error = store.detailError$.get()

  const [actionError, setActionError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const heldTickers = summary?.holdings.map((h) => h.ticker) ?? []

  const run = async (action: () => Promise<void>, fallback: string) => {
    setActionError(null)
    try {
      await action()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : fallback)
    }
  }

  const handleRename = () => {
    if (!portfolio) return
    const name = window.prompt('Rename Portfolio', portfolio.name)?.trim()
    if (!name || name === portfolio.name) return
    run(() => store.renamePortfolio(portfolio.id, name), 'Failed to rename Portfolio')
  }

  const handleDelete = () => {
    if (!portfolio) return
    if (!window.confirm(`Delete "${portfolio.name}" and all its Transactions?`)) return
    run(async () => {
      await store.deletePortfolio(portfolio.id)
      router.navigate('/portfolio')
    }, 'Failed to delete Portfolio')
  }

  const handleDeleteTransaction = (tx: PortfolioTransaction) => {
    if (!window.confirm(`Delete the ${tx.kind} of ${tx.ticker} on ${fmtDate(tx.date)}?`)) return
    run(() => store.deleteTransaction(portfolioId, tx.id), 'Failed to delete Transaction')
  }

  if (!portfolio) {
    return (
      <section className={styles.page}>
        <button type="button" className={styles.link} onClick={() => router.navigate('/portfolio')}>
          ← Portfolios
        </button>
        {error ? <p className={styles.error}>{error}</p> : loading && <p className={styles.empty}>Loading…</p>}
      </section>
    )
  }

  return (
    <section className={styles.page}>
      <button type="button" className={styles.link} onClick={() => router.navigate('/portfolio')}>
        ← Portfolios
      </button>
      <header className={styles.header}>
        <h2>
          {portfolio.name} <span className={styles.muted}>{portfolio.currency}</span>
        </h2>
        <div className={styles.actions}>
          <button type="button" onClick={handleRename}>Rename</button>
          <button type="button" className={styles.danger} onClick={handleDelete}>Delete</button>
        </div>
      </header>
      {error && <p className={styles.error}>{error}</p>}
      {actionError && <p className={styles.error}>{actionError}</p>}

      {summary && <SummaryKpis summary={summary} />}

      <h3>Holdings</h3>
      {summary && summary.holdings.length > 0 ? (
        <HoldingsTable holdings={summary.holdings} currency={summary.currency} />
      ) : (
        <p className={styles.empty}>No Holdings. Record a Buy below.</p>
      )}

      <h3>Transactions</h3>
      <TransactionForm
        portfolio={portfolio}
        heldTickers={heldTickers}
        onSubmit={(input) => store.addTransaction(portfolio.id, input)}
      />
      {transactions.length === 0 ? (
        <p className={styles.empty}>No Transactions yet.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Kind</th>
                <th>Ticker</th>
                <th className={styles.num}>Units</th>
                <th className={styles.num}>Price</th>
                <th className={styles.num}>Fees</th>
                <th className={styles.num}>FX rate</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...transactions].reverse().map((tx) =>
                editingId === tx.id ? (
                  <tr key={tx.id}>
                    <td colSpan={8}>
                      <TransactionForm
                        portfolio={portfolio}
                        heldTickers={heldTickers}
                        initial={tx}
                        onSubmit={async (input) => {
                          await store.updateTransaction(portfolio.id, tx.id, input)
                          setEditingId(null)
                        }}
                        onCancel={() => setEditingId(null)}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={tx.id}>
                    <td>{fmtDate(tx.date)}</td>
                    <td>{tx.kind}</td>
                    <td>{tx.ticker}</td>
                    <td className={styles.num}>{fmtUnits(tx.units)}</td>
                    <td className={styles.num}>{fmtPrice(tx.price)}</td>
                    <td className={styles.num}>{fmtPrice(tx.fees)}</td>
                    <td className={styles.num}>{tx.fxRate === null ? 'stored' : fmtPrice(tx.fxRate)}</td>
                    <td className={styles.num}>
                      {tx.kind !== 'split' && (
                        <button
                          type="button"
                          className={`${styles.iconButton} ${styles.editButton}`}
                          aria-label={`Edit Transaction ${tx.id}`}
                          onClick={() => setEditingId(tx.id)}
                        >
                          ✎
                        </button>
                      )}
                      <button
                        type="button"
                        className={styles.iconButton}
                        aria-label={`Delete Transaction ${tx.id}`}
                        onClick={() => handleDeleteTransaction(tx)}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
})

function SummaryKpis({ summary }: { summary: PortfolioSummary }) {
  const ccy = summary.currency
  const gain = summary.unrealizedGain.toNumber()
  const realized = summary.realizedGain.toNumber()
  const total = summary.totalGain.toNumber()
  return (
    <div className={styles.kpis}>
      <div className={styles.kpi}>
        <span className={styles.kpiLabel}>Invested</span>
        <span className={styles.kpiValue}>{fmtMoney(summary.invested.toNumber(), ccy)}</span>
      </div>
      <div className={styles.kpi}>
        <span className={styles.kpiLabel}>Portfolio Value</span>
        <span className={styles.kpiValue}>{fmtMoney(summary.portfolioValue.toNumber(), ccy)}</span>
      </div>
      <div className={styles.kpi}>
        <span className={styles.kpiLabel}>Unrealized Gain</span>
        <span className={`${styles.kpiValue} ${signClass(gain)}`}>
          {fmtMoney(gain, ccy)} <small>({fmtOptionalPct(summary.unrealizedGainPct)})</small>
        </span>
      </div>
      <div className={styles.kpi}>
        <span className={styles.kpiLabel}>Realized Gain</span>
        <span className={`${styles.kpiValue} ${signClass(realized)}`}>{fmtMoney(realized, ccy)}</span>
      </div>
      <div className={styles.kpi}>
        <span className={styles.kpiLabel}>Total Gain</span>
        <span className={`${styles.kpiValue} ${signClass(total)}`}>{fmtMoney(total, ccy)}</span>
      </div>
    </div>
  )
}

function HoldingsTable({ holdings, currency }: { holdings: Holding[]; currency: string }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Ticker</th>
            <th className={styles.num}>Units</th>
            <th className={styles.num}>Last close</th>
            <th className={styles.num}>Cost</th>
            <th className={styles.num}>Value</th>
            <th className={styles.num}>Weight</th>
            <th className={styles.num}>Unrealized Gain</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((h) => {
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
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
