import { useEffect, useMemo, useState } from 'react'
import { observer } from '@legendapp/state/react'
import {
  useLiveMetricsStore,
  useRadarStore,
  useTradeStore,
} from '../../container/ContainerContext'
import { OrderedScatterChart } from './OrderedScatterChart'
import { OrderedSummaryCard } from './OrderedSummaryCard'
import { OrderedTable } from './OrderedTable'
import {
  buildOrderedRows,
  matchesQuery,
  summarizeOrderedRows,
} from './orderedSelectors'
import shared from './shared.module.css'
import styles from './OrderedSection.module.css'

export const OrderedSection = observer(function OrderedSection({ ccy }: { ccy: string }) {
  const tradeStore = useTradeStore()
  const liveMetricsStore = useLiveMetricsStore()
  const radarStore = useRadarStore()

  const trades = tradeStore.trades$.get()
  const metrics = liveMetricsStore.metrics$.get()
  const indicators = radarStore.indicators$.get()

  useEffect(() => {
    if (trades.length === 0) tradeStore.loadTrades()
  }, [tradeStore, trades.length])

  // Refresh prices whenever the set of active trades changes — prices are
  // only fetched for active tickers, so loading trades first matters.
  useEffect(() => {
    liveMetricsStore.refreshPrices()
  }, [liveMetricsStore, trades])

  // Drive the radar indicator load from this page too — the convergence
  // score, drift badge, and SMA column all read from radarStore.indicators$.
  // Mirrors useRadarView so the data is available even if the user hasn't
  // visited the Radar page in this session.
  useEffect(() => {
    const tradeSymbols = Array.from(
      new Set(
        trades.filter((t) => t.status !== 'canceled').map((t) => t.ticker.toUpperCase()),
      ),
    )
    radarStore.setDerivedSymbols(tradeSymbols)
  }, [trades, radarStore])

  useEffect(() => {
    radarStore.loadIndicators()
  }, [radarStore])

  const [query, setQuery] = useState('')

  const rows = useMemo(
    () => buildOrderedRows(trades, metrics, indicators),
    [trades, metrics, indicators],
  )
  const summary = useMemo(() => summarizeOrderedRows(rows), [rows])

  const filteredRows = useMemo(
    () => rows.filter((r) => matchesQuery(r, query)),
    [rows, query],
  )
  const highlightIds = useMemo(() => {
    if (!query.trim()) return new Set<number>()
    return new Set(rows.filter((r) => matchesQuery(r, query)).map((r) => r.tradeId))
  }, [rows, query])

  return (
    <section className={shared.section}>
      <div className={shared.sectionHeader}>
        <h3 className={`${shared.sectionTitle} ${shared.headerTitle}`}>Ordered</h3>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ticker or trade #"
          className={styles.searchInput}
          aria-label="Search ordered trades"
        />
      </div>
      <p className={shared.note}>
        Outstanding orders — capital is committed to the broker but the trade hasn't
        filled. <strong>Position %</strong> is signed distance from current price to
        planned entry; <strong>order age</strong> is days since the order was placed.
        High age or a "behind" drift badge are signals to refresh or cancel the order.
      </p>

      {rows.length === 0 ? (
        <p className={shared.empty}>No ordered trades right now.</p>
      ) : (
        <>
          <OrderedSummaryCard summary={summary} ccy={ccy} />
          <OrderedScatterChart
            rows={rows}
            highlightIds={highlightIds}
            hasActiveQuery={query.trim().length > 0}
          />
          <OrderedTable
            rows={filteredRows}
            ccy={ccy}
            highlightIds={highlightIds}
            hasDriftData={summary.hasDriftData}
          />
        </>
      )}
    </section>
  )
})
