import { useEffect, useMemo, useState } from 'react'
import { observer } from '@legendapp/state/react'
import {
  useIndicatorStore,
  useLiveMetricsStore,
  useTradeStore,
} from '../../container/ContainerContext'
import { CollapsibleSection } from '../../components/CollapsibleSection'
import { OrderedDistributions } from './OrderedDistributions'
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
  const indicatorStore = useIndicatorStore()

  const trades = tradeStore.trades$.get()
  const metrics = liveMetricsStore.metrics$.get()
  // The convergence score, drift badge, and SMA column read shared indicators,
  // loaded for the whole universe by IndicatorBootstrap (a common ancestor).
  const indicators = indicatorStore.indicators$.get()

  useEffect(() => {
    if (trades.length === 0) tradeStore.loadTrades()
  }, [tradeStore, trades.length])

  // Refresh prices whenever the set of active trades changes — prices are
  // only fetched for active tickers, so loading trades first matters.
  useEffect(() => {
    liveMetricsStore.refreshPrices()
  }, [liveMetricsStore, trades])

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

  const body =
    rows.length === 0 ? null : (
      <>
        <p className={shared.note}>
          Outstanding orders — capital is committed to the broker but the trade hasn't
          filled. <strong>Position %</strong> is signed distance from current price to
          planned entry; <strong>order age</strong> is days since the order was placed.
          High age or a "behind" drift badge are signals to refresh or cancel the order.
        </p>
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
        <OrderedDistributions rows={rows} />
      </>
    )

  return (
    <CollapsibleSection
      title="Ordered"
      persistKey="drivers:ordered"
      defaultExpanded={false}
      count={rows.length}
      headerExtra={
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ticker or trade #"
          className={styles.searchInput}
          aria-label="Search ordered trades"
        />
      }
      summary={
        rows.length === 0 ? (
          <p className={shared.empty}>No ordered trades right now.</p>
        ) : (
          <OrderedSummaryCard summary={summary} ccy={ccy} />
        )
      }
    >
      {body}
    </CollapsibleSection>
  )
})
