import { createContext, useContext, useRef, ReactNode } from 'react'
import { AppContainer } from './types'
import { createAppContainer } from './AppContainer'

const ContainerCtx = createContext<AppContainer | null>(null)

export function ContainerProvider({ children }: { children: ReactNode }) {
  const containerRef = useRef<AppContainer | null>(null)
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
