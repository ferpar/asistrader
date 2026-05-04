import { createContext, useContext, useRef, ReactNode } from 'react'
import { AppContainer } from './types'
import { createAppContainer } from './AppContainer'

const ContainerCtx = createContext<AppContainer | null>(null)

export function ContainerProvider({
  children,
  container,
}: {
  children: ReactNode
  /** Inject a pre-built container — used by tests. */
  container?: AppContainer
}) {
  const containerRef = useRef<AppContainer | null>(container ?? null)
  if (containerRef.current === null) {
    containerRef.current = createAppContainer()
  }
  return (
    <ContainerCtx.Provider value={containerRef.current}>
      {children}
    </ContainerCtx.Provider>
  )
}

export function useContainer(): AppContainer {
  const container = useContext(ContainerCtx)
  if (!container) {
    throw new Error('useContainer must be used within a ContainerProvider')
  }
  return container
}

export function useTradeStore() {
  return useContainer().tradeStore
}

export function useLiveMetricsStore() {
  return useContainer().liveMetricsStore
}

export function useStrategyRepo() {
  return useContainer().strategyRepo
}

export function useMarketDataRepo() {
  return useContainer().marketDataRepo
}

export function useTickerStore() {
  return useContainer().tickerStore
}

export function useFundStore() {
  return useContainer().fundStore
}

export function useFxStore() {
  return useContainer().fxStore
}

export function useRadarStore() {
  return useContainer().radarStore
}

export function useBenchmarkStore() {
  return useContainer().benchmarkStore
}
