import { useEffect, useState } from 'react'
import { observer } from '@legendapp/state/react'
import { usePortfolioStore, useRouterStore, useTickerStore } from '../../container/ContainerContext'
import { fmtMoney, fmtXirr } from '../../components/portfolio/format'
import { signClass } from '../../components/portfolio/signClass'
import type { PortfolioSummary, PortfolioTransaction } from '../../domain/portfolio/types'
import { CsvImport } from './CsvImport'
import { HoldingsTable } from './HoldingsTable'
import { HomeMarketSelect } from './HomeMarketSelect'
import { MoneyChart } from './MoneyChart'
import { PerformanceSection } from './PerformanceSection'
import { TransactionForm } from './TransactionForm'
import { TransactionsTable } from './TransactionsTable'
import { fmtDate, fmtOptionalPct } from './format'
import styles from './Portfolio.module.css'

/** Portfolio detail: KPI header, Holdings table and the Transactions list
 *  (add, edit and delete Buys and Sells). */
export const PortfolioDetailPage = observer(function PortfolioDetailPage({
  portfolioId,
}: {
  portfolioId: number
}) {
  const store = usePortfolioStore()
  const router = useRouterStore()
  const tickerStore = useTickerStore()

  useEffect(() => {
    store.loadDetail(portfolioId)
  }, [store, portfolioId])

  const portfolio = store.current$.get()
  const summary = store.summary$.get()
  const transactions = store.transactions$.get()
  const loading = store.detailLoading$.get()
  const error = store.detailError$.get()
  const history = store.history$.get()
  const historyError = store.historyError$.get()

  const [actionError, setActionError] = useState<string | null>(null)
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

  const handleImport = async (csv: string) => {
    const result = await store.importCsv(portfolioId, csv)
    // Imported rows may have created unknown tickers: let the rest of the app see them.
    if (result.created > 0) tickerStore.loadTickers()
    return result
  }

  const handleDeleteTransaction = (tx: PortfolioTransaction) => {
    if (!window.confirm(`Delete the ${tx.kind} of ${tx.ticker} on ${fmtDate(tx.date)}?`)) return
    run(() => store.deleteTransaction(portfolioId, tx.id), 'Failed to delete Transaction')
  }

  if (!portfolio) {
    return (
      <section>
        <button type="button" className={styles.link} onClick={() => router.navigate('/portfolio')}>
          ← Portfolios
        </button>
        {error ? <p className={styles.error}>{error}</p> : loading && <p className={styles.empty}>Loading…</p>}
      </section>
    )
  }

  return (
    <section>
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

      {/* Side by side on wide screens, stacked on narrow ones. */}
      <div className={styles.charts}>
        {historyError ? (
          <p className={styles.error}>{historyError}</p>
        ) : (
          history && <MoneyChart rows={history.rows} currency={history.currency} />
        )}
        {history && <PerformanceSection portfolioId={portfolio.id} name={portfolio.name} history={history} />}
      </div>

      <div className={styles.sectionHeader}>
        <h3>Holdings</h3>
        <HomeMarketSelect onChanged={() => store.loadDetail(portfolioId)} />
      </div>
      {summary && summary.holdings.length > 0 ? (
        <HoldingsTable
          holdings={summary.holdings}
          assetClasses={summary.assetClasses}
          currency={summary.currency}
          onOverride={(symbol, assetClass) =>
            run(async () => {
              await tickerStore.setAssetClassOverride(symbol, assetClass)
              await store.loadDetail(portfolioId)
            }, 'Failed to set Asset Class')
          }
        />
      ) : (
        <p className={styles.empty}>No Holdings. Record a Buy below.</p>
      )}

      <h3>Transactions</h3>
      <TransactionForm
        portfolio={portfolio}
        heldTickers={heldTickers}
        onSubmit={(input) => store.addTransaction(portfolio.id, input)}
      />
      <CsvImport onImport={handleImport} />
      <TransactionsTable
        portfolio={portfolio}
        transactions={transactions}
        heldTickers={heldTickers}
        onUpdate={(transactionId, input) => store.updateTransaction(portfolio.id, transactionId, input)}
        onDelete={handleDeleteTransaction}
      />
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
      <div className={styles.kpi}>
        <span className={styles.kpiLabel}>Weighted Days Open</span>
        <span className={styles.kpiValue}>
          {summary.weightedDaysOpen === null ? '—' : summary.weightedDaysOpen.toFixed(0)}
        </span>
      </div>
      <div className={styles.kpi}>
        <span className={styles.kpiLabel}>Simple TIR</span>
        <span className={`${styles.kpiValue} ${signClass(summary.simpleTir ?? 0)}`}>
          {fmtOptionalPct(summary.simpleTir)}
        </span>
      </div>
      <div className={styles.kpi}>
        <span className={styles.kpiLabel}>XIRR</span>
        <span className={`${styles.kpiValue} ${signClass(summary.xirr ?? 0)}`}>
          {fmtXirr(summary.xirr)}
        </span>
      </div>
    </div>
  )
}
