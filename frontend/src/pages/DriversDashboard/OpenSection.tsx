import { useEffect, useMemo, useState } from 'react'
import { observer } from '@legendapp/state/react'
import {
  useFxStore,
  useIndicatorStore,
  useLiveMetricsStore,
  useTradeStore,
} from '../../container/ContainerContext'
import { Decimal } from '../../domain/shared/Decimal'
import { CollapsibleSection } from '../../components/CollapsibleSection'
import { OpenScatterChart } from './OpenScatterChart'
import { OpenSummaryCard } from './OpenSummaryCard'
import { OpenTable } from './OpenTable'
import { Toggle } from './Toggle'
import { filterBySign, matchesQuery, type SignFilter } from './orderedSelectors'
import { buildOpenRows, summarizeOpenRows, type ToBase } from './openSelectors'
import shared from './shared.module.css'
import styles from './OrderedSection.module.css'

// Mirrors the Mixed/Winners/Losers toggles elsewhere; here the two sides are
// the position rails — toward take-profit vs toward stop-loss.
const SIGN_OPTIONS: { id: SignFilter; label: string }[] = [
  { id: 'mixed', label: 'Mixed' },
  { id: 'positive', label: 'Toward TP' },
  { id: 'negative', label: 'Toward SL' },
]

export const OpenSection = observer(function OpenSection({ ccy }: { ccy: string }) {
  const tradeStore = useTradeStore()
  const liveMetricsStore = useLiveMetricsStore()
  const indicatorStore = useIndicatorStore()
  const fxStore = useFxStore()

  const trades = tradeStore.trades$.get()
  const metrics = liveMetricsStore.metrics$.get()
  // Health score and SMA column read shared indicators, loaded for the whole
  // universe by IndicatorBootstrap (a common ancestor).
  const indicators = indicatorStore.indicators$.get()

  useEffect(() => {
    if (trades.length === 0) tradeStore.loadTrades()
  }, [tradeStore, trades.length])

  // Prices are only fetched for active tickers, so loading trades first matters.
  useEffect(() => {
    liveMetricsStore.refreshPrices()
  }, [liveMetricsStore, trades])

  const [query, setQuery] = useState('')
  const [signFilter, setSignFilter] = useState<SignFilter>('mixed')

  // Committed capital is summed in the base currency to match the Unrealized
  // "Invested" figure. Trade currencies aren't part of the bootstrap FX sync
  // (only fund-event currencies are), so seed any missing ones here. `fxReady`
  // bumps once the rates resolve, forcing the rows to recompute in base.
  const [fxReady, setFxReady] = useState(0)
  // Reading this keeps the observer reactive to the bootstrap (false→true) load.
  fxStore.loaded$.get()
  useEffect(() => {
    const currencies = Array.from(
      new Set(
        trades
          .filter((t) => t.status === 'open')
          .map((t) => t.tickerCurrency ?? ccy),
      ),
    ).filter((c) => c !== ccy)
    if (currencies.length === 0) return
    let cancelled = false
    Promise.all(currencies.map((c) => fxStore.ensureLoaded(c))).then(() => {
      if (!cancelled) setFxReady((v) => v + 1)
    })
    return () => {
      cancelled = true
    }
  }, [trades, fxStore, ccy])

  const toBase = useMemo<ToBase>(() => {
    void fxReady // recompute when newly-seeded rates arrive
    return (amount, ccyOf, onDate) => {
      const from = ccyOf ?? ccy
      if (from === ccy) return amount
      try {
        return fxStore.convert(Decimal.from(amount), from, ccy, onDate).toNumber()
      } catch {
        return amount // mirror the backend's fall-back-to-native
      }
    }
  }, [fxStore, ccy, fxReady])

  const rows = useMemo(
    () => buildOpenRows(trades, metrics, indicators, new Date(), toBase),
    [trades, metrics, indicators, toBase],
  )

  // The segment filter narrows the whole section — summary, table, and chart all
  // read this set so the partial-data view stays coherent.
  const signedRows = useMemo(
    () => filterBySign(rows, signFilter, (r) => r.positionToTarget),
    [rows, signFilter],
  )
  const summary = useMemo(() => summarizeOpenRows(signedRows), [signedRows])

  const filteredRows = useMemo(
    () => signedRows.filter((r) => matchesQuery(r, query)),
    [signedRows, query],
  )
  const highlightIds = useMemo(() => {
    if (!query.trim()) return new Set<number>()
    return new Set(signedRows.filter((r) => matchesQuery(r, query)).map((r) => r.tradeId))
  }, [signedRows, query])

  const body =
    rows.length === 0 ? null : (
      <>
        <p className={shared.note}>
          Open positions — capital is filled and live. <strong>To target</strong> is how
          far price has travelled from PE toward the take-profit (above zero) or the
          stop-loss (below zero); <strong>holding</strong> is days since the fill. Dots are
          coloured by a health score that reads price drift toward TP (green) vs SL (red).
        </p>
        <OpenScatterChart
          rows={signedRows}
          highlightIds={highlightIds}
          hasActiveQuery={query.trim().length > 0}
          signFilter={signFilter}
        />
        <OpenTable rows={filteredRows} ccy={ccy} highlightIds={highlightIds} />
      </>
    )

  return (
    <CollapsibleSection
      title="Open"
      persistKey="drivers:open"
      defaultExpanded={false}
      count={rows.length}
      headerExtra={
        <>
          <Toggle options={SIGN_OPTIONS} value={signFilter} onChange={setSignFilter} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ticker or trade #"
            className={styles.searchInput}
            aria-label="Search open trades"
          />
        </>
      }
      summary={
        rows.length === 0 ? (
          <p className={shared.empty}>No open trades right now.</p>
        ) : (
          <OpenSummaryCard summary={summary} ccy={ccy} />
        )
      }
    >
      {body}
    </CollapsibleSection>
  )
})
