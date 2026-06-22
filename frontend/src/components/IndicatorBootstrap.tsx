import { useEffect } from 'react'
import { observer } from '@legendapp/state/react'
import { useTickerStore, useTradeStore, useIndicatorStore } from '../container/ContainerContext'
import { computeUniverse } from '../domain/radar/IndicatorStore'

/**
 * Eagerly loads the shared ticker indicators for the whole universe — every
 * ticker in the DB ∪ traded tickers — from a common ancestor, so the Radar,
 * Screening, and Drivers pages all read a complete, page-independent set. The
 * per-user watchlist no longer gates this (it's a display-only favorites filter
 * now); the trades union just guards against a traded symbol that somehow isn't
 * in the ticker list. Mounted only in the authenticated tree. Renders nothing.
 */
export const IndicatorBootstrap = observer(function IndicatorBootstrap() {
  const tickerStore = useTickerStore()
  const tradeStore = useTradeStore()
  const indicatorStore = useIndicatorStore()

  const tickers = tickerStore.tickers$.get()
  const trades = tradeStore.trades$.get()

  useEffect(() => {
    tickerStore.loadTickers()
  }, [tickerStore])

  useEffect(() => {
    tradeStore.loadTrades()
  }, [tradeStore])

  useEffect(() => {
    const allSymbols = tickers.map((t) => t.symbol)
    indicatorStore.load(computeUniverse(allSymbols, trades))
  }, [tickers, trades, indicatorStore])

  return null
})
