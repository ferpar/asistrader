import { useEffect } from 'react'
import { observer } from '@legendapp/state/react'
import { useRadarStore, useTradeStore, useIndicatorStore } from '../container/ContainerContext'
import { computeUniverse } from '../domain/radar/IndicatorStore'

/**
 * Eagerly loads the shared ticker indicators for the whole universe
 * (watchlist ∪ traded tickers) from a common ancestor, so both the Radar and
 * Screening pages read a complete, page-independent set. Mounted only in the
 * authenticated tree. Renders nothing.
 */
export const IndicatorBootstrap = observer(function IndicatorBootstrap() {
  const radarStore = useRadarStore()
  const tradeStore = useTradeStore()
  const indicatorStore = useIndicatorStore()

  const watchlist = radarStore.symbols$.get()
  const trades = tradeStore.trades$.get()

  useEffect(() => {
    tradeStore.loadTrades()
  }, [tradeStore])

  useEffect(() => {
    indicatorStore.load(computeUniverse(watchlist, trades))
  }, [watchlist, trades, indicatorStore])

  return null
})
