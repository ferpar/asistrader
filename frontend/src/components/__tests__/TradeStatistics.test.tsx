import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Decimal } from '../../domain/shared/Decimal'
import { TradeStatistics } from '../TradeStatistics'
import { ContainerProvider } from '../../container/ContainerContext'
import type { AppContainer } from '../../container/types'
import type { TradeWithMetrics } from '../../domain/trade/types'
import { FundStore } from '../../domain/fund/FundStore'
import { FxStore } from '../../domain/fx/FxStore'
import { TradeStore } from '../../domain/trade/TradeStore'
import { LiveMetricsStore } from '../../domain/trade/LiveMetricsStore'
import { TradeMetricsStore } from '../../domain/trade/TradeMetricsStore'
import type { IFundRepository } from '../../domain/fund/IFundRepository'
import type { IFxRepository } from '../../domain/fx/IFxRepository'
import type { ITradeRepository, IPriceProvider } from '../../domain/trade/ITradeRepository'

const D = (n: number | string) => Decimal.from(n)

const stubFxRepo: IFxRepository = {
  async getHistory() {
    return {}
  },
}

const stubFundRepo: IFundRepository = {
  async fetchEvents() { return [] },
  async createDeposit() { throw new Error('nope') },
  async createWithdrawal() { throw new Error('nope') },
  async createManualEvent() { throw new Error('nope') },
  async voidEvent() { throw new Error('nope') },
  async fetchSettings() { return { risk_pct: 0.02, base_currency: 'USD' } },
  async updateSettings() { return { risk_pct: 0.02, base_currency: 'USD' } },
}

const stubTradeRepo: ITradeRepository = {
  async fetchTrades() { return [] },
  async createTrade() { throw new Error('nope') },
  async updateTrade() { throw new Error('nope') },
  async detectTradeHits() { throw new Error('nope') },
  async markLevelHit() { throw new Error('nope') },
  async unmarkLevelHit() { throw new Error('nope') },
  async reopenTrade() { throw new Error('nope') },
  async revertOpenToOrdered() { throw new Error('nope') },
} as unknown as ITradeRepository

const stubPriceProvider: IPriceProvider = {
  async fetchBatchPrices() { return {} },
}

function makeTrade(overrides: Partial<TradeWithMetrics>): TradeWithMetrics {
  return {
    id: 1,
    number: 1,
    ticker: 'TEST',
    tickerName: null,
    tickerCurrency: 'USD',
    tickerPriceHint: null,
    status: 'close',
    amount: D(1000),
    units: 10,
    remainingUnits: null,
    entryPrice: D(100),
    stopLoss: D(95),
    takeProfit: D(115),
    datePlanned: new Date('2026-04-01'),
    dateActual: new Date('2026-04-15'),
    exitDate: new Date('2026-05-01'),
    exitType: 'tp',
    exitPrice: D(110),
    orderType: null,
    timeInEffect: null,
    gtdDate: null,
    autoDetect: false,
    isLayered: false,
    exitLevels: [],
    strategyId: null,
    strategyName: null,
    cancelReason: null,
    riskAbs: D(0),
    profitAbs: D(0),
    riskPct: D(0),
    profitPct: D(0),
    ratio: D(0),
    ...overrides,
  }
}

interface TestContainer {
  container: AppContainer
  fxStore: FxStore
  fundStore: FundStore
  tradeStore: TradeStore
  tradeMetricsStore: TradeMetricsStore
}

function buildContainer(): TestContainer {
  const fxStore = new FxStore(stubFxRepo)
  const fundStore = new FundStore(stubFundRepo, fxStore)
  const tradeStore = new TradeStore(stubTradeRepo)
  const liveMetricsStore = new LiveMetricsStore(tradeStore, stubPriceProvider)
  const tradeMetricsStore = new TradeMetricsStore(
    tradeStore,
    liveMetricsStore,
    fundStore,
    fxStore,
  )
  return {
    container: { fxStore, fundStore, tradeStore, liveMetricsStore, tradeMetricsStore } as unknown as AppContainer,
    fxStore, fundStore, tradeStore, tradeMetricsStore,
  }
}

function renderWithContainer(container: AppContainer, ui: React.ReactElement) {
  return render(<ContainerProvider container={container}>{ui}</ContainerProvider>)
}

const flushMicrotasks = async () => {
  // Two cycles: one for the scheduled queueMicrotask, one for any chained
  // observable propagation triggered by setting the result.
  await Promise.resolve()
  await Promise.resolve()
}

describe('TradeStatistics — rendering', () => {
  it('shows skeleton placeholders before the first compute lands', () => {
    const { container } = buildContainer()
    renderWithContainer(
      container,
      <TradeStatistics allTrades={[]} filteredTrades={[]} filter="all" />,
    )
    // Money cells render skeleton spans (no $/€ amount visible yet).
    expect(screen.queryByText(/\$/)).toBeNull()
  })

  it('renders the realized total once compute completes', async () => {
    const { container, tradeStore } = buildContainer()
    const trade = makeTrade({
      tickerCurrency: 'USD',
      entryPrice: D(100),
      exitPrice: D(110),
      units: 10,
      exitType: 'tp',
    })
    tradeStore.trades$.set([trade])
    await flushMicrotasks()

    renderWithContainer(
      container,
      <TradeStatistics
        allTrades={[trade]}
        filteredTrades={[trade]}
        filter="close"
      />,
    )

    // (110 - 100) × 10 = $100 profit; rendered as $100.00 in Total P&L.
    expect(screen.getAllByText('$100.00').length).toBeGreaterThan(0)
  })

  it('uses the user base currency symbol for totals', async () => {
    const { container, tradeStore, fundStore } = buildContainer()
    fundStore.baseCurrency$.set('EUR')
    // Seed an EUR trade that needs no conversion in EUR base.
    const trade = makeTrade({
      tickerCurrency: 'EUR',
      entryPrice: D(40),
      exitPrice: D(50),
      units: 10,
      exitType: 'tp',
    })
    tradeStore.trades$.set([trade])
    await flushMicrotasks()

    renderWithContainer(
      container,
      <TradeStatistics
        allTrades={[trade]}
        filteredTrades={[trade]}
        filter="close"
      />,
    )

    expect(screen.getAllByText(/€/).length).toBeGreaterThan(0)
  })

  it('shows skeletons again while a recompute is in flight', async () => {
    const { container, tradeStore, fundStore } = buildContainer()
    const trade = makeTrade({ tickerCurrency: 'USD', exitType: 'tp' })
    tradeStore.trades$.set([trade])
    await flushMicrotasks()

    renderWithContainer(
      container,
      <TradeStatistics
        allTrades={[trade]}
        filteredTrades={[trade]}
        filter="close"
      />,
    )
    // First compute landed.
    expect(screen.getAllByText(/\$/).length).toBeGreaterThan(0)

    // Trigger a recompute by changing base currency.
    fundStore.baseCurrency$.set('EUR')
    // computing$ is now true; the component re-renders to skeletons.
    // We don't await microtasks here — we want to catch the in-flight state.
    expect(container.tradeMetricsStore.computing$.get()).toBe(true)
  })
})
