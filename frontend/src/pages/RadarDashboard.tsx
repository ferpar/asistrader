import { useState } from 'react'
import { observer } from '@legendapp/state/react'
import { TickerSearchInput } from '../components/TickerSearchInput'
import { BenchmarkSearchInput } from '../components/BenchmarkSearchInput'
import { TradeCreationForm } from '../components/TradeCreationForm'
import { RadarTickerCard } from '../components/radar/RadarTickerCard'
import { RadarBenchmarkCard } from '../components/radar/RadarBenchmarkCard'
import { RadarFilterBar } from '../components/radar/RadarFilterBar'
import { RadarFlatTradeRow } from '../components/radar/RadarFlatTradeRow'
import { useRadarView } from '../hooks/useRadarView'
import styles from './RadarDashboard.module.css'

export const RadarDashboard = observer(function RadarDashboard() {
  const radar = useRadarView()
  const [selectedTicker, setSelectedTicker] = useState('')
  const [newTradeTicker, setNewTradeTicker] = useState<string | null>(null)

  const handleTickerSelect = (symbol: string) => {
    setSelectedTicker('')
    radar.addTickerSymbol(symbol)
  }

  const renderTickersSection = () => {
    if (radar.indicators.length === 0 && !radar.loading) {
      return <div className={styles.empty}>No tickers in your radar. Add one above to get started.</div>
    }

    if (radar.view.flatView) {
      const visible = radar.flat.rows.length
      return (
        <>
          <div className={styles.sectionHeadingRow}>
            <h3 className={styles.sectionHeading}>Trades</h3>
            <span className={styles.countBadge}>
              {visible} of {radar.totalActiveTrades} active trades
            </span>
          </div>
          {visible === 0 ? (
            <div className={styles.empty}>No trades match the current filters.</div>
          ) : (
            <div className={styles.flatList}>
              {radar.flat.rows.map((row) => (
                <RadarFlatTradeRow
                  key={row.trade.id}
                  indicator={row.indicator}
                  ticker={radar.tickerMap[row.indicator.symbol] ?? null}
                  trade={row.trade}
                  metric={radar.liveMetrics[row.trade.id]}
                />
              ))}
            </div>
          )}
        </>
      )
    }

    const shownCards = radar.grouped.indicators.length
    return (
      <>
        <div className={styles.sectionHeadingRow}>
          <h3 className={styles.sectionHeading}>Tickers</h3>
          <span className={styles.countBadge}>
            {shownCards} of {radar.indicators.length} cards
          </span>
        </div>
        {shownCards === 0 ? (
          <div className={styles.empty}>No tickers match the current filters.</div>
        ) : (
          <div className={styles.cardList}>
            {radar.grouped.indicators.map((ind) => (
              <RadarTickerCard
                key={ind.symbol}
                indicators={ind}
                ticker={radar.tickerMap[ind.symbol] ?? null}
                trades={radar.grouped.tradesBySymbol[ind.symbol] ?? []}
                liveMetrics={radar.liveMetrics}
                removable={radar.watchlistSet.has(ind.symbol)}
                onRemove={radar.removeTickerSymbol}
                onNewTrade={setNewTradeTicker}
              />
            ))}
          </div>
        )}
      </>
    )
  }

  return (
    <section>
      <h2>Radar</h2>

      <div className={styles.controls}>
        <div className={styles.addTicker}>
          <label className={styles.addLabel}>Add Ticker</label>
          <TickerSearchInput
            existingTickers={radar.tickers}
            selectedTicker={selectedTicker}
            onTickerSelect={handleTickerSelect}
            onTickerCreated={radar.registerCreatedTicker}
          />
        </div>
        <div className={styles.addTicker}>
          <label className={styles.addLabel}>Add Benchmark</label>
          <BenchmarkSearchInput
            existingBenchmarks={radar.benchmarks}
            onBenchmarkSelect={radar.addBenchmark}
          />
        </div>
        <button
          className={styles.refreshBtn}
          onClick={radar.refreshIndicators}
          disabled={radar.loading}
        >
          {radar.loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {radar.error && <div className={styles.error}>{radar.error}</div>}

      <div className={styles.section}>
        <h3 className={styles.sectionHeading}>Benchmarks</h3>
        {radar.benchmarkIndicators.length === 0 && !radar.loading && (
          <div className={styles.empty}>
            No benchmarks added. Search for an index above to compare against.
          </div>
        )}
        <div className={styles.cardList}>
          {radar.benchmarkIndicators.map((ind) => (
            <RadarBenchmarkCard
              key={ind.symbol}
              indicators={ind}
              benchmark={radar.benchmarkMap[ind.symbol] ?? null}
              onRemove={radar.removeBenchmark}
            />
          ))}
        </div>
      </div>

      <div className={styles.section}>
        <RadarFilterBar value={radar.view} onChange={radar.setView} onReset={radar.resetView} />
        {renderTickersSection()}
      </div>

      {newTradeTicker && (
        <TradeCreationForm
          initialTicker={newTradeTicker}
          onClose={() => setNewTradeTicker(null)}
        />
      )}
    </section>
  )
})
