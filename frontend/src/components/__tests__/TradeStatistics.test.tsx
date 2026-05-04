import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Decimal } from '../../domain/shared/Decimal'
import { TradeStatistics } from '../TradeStatistics'
import { ContainerProvider } from '../../container/ContainerContext'
import type { AppContainer } from '../../container/types'
import type { TradeWithMetrics, LiveMetrics } from '../../domain/trade/types'
import type { FxRate } from '../../domain/fx/types'
import type { IFxRepository } from '../../domain/fx/IFxRepository'
import type { IFundRepository } from '../../domain/fund/IFundRepository'
import { FxStore } from '../../domain/fx/FxStore'
import { FundStore } from '../../domain/fund/FundStore'

class StubFxRepo implements IFxRepository {
  constructor(private readonly data: Record<string, FxRate[]>) {}
  async getHistory(currencies: string[]): Promise<Record<string, FxRate[]>> {
    const out: Record<string, FxRate[]> = {}
    for (const c of currencies) out[c] = this.data[c] ?? []
    return out
  }
}

const stubFundRepo: IFundRepository = {
  async fetchEvents() {
    return []
  },
  async createDeposit() {
    throw new Error('not implemented')
  },
  async createWithdrawal() {
    throw new Error('not implemented')
  },
  async createManualEvent() {
    throw new Error('not implemented')
  },
  async voidEvent() {
    throw new Error('not implemented')
  },
  async fetchSettings() {
    return { risk_pct: 0.02, base_currency: 'USD' }
  },
  async updateSettings() {
    return { risk_pct: 0.02, base_currency: 'USD' }
  },
}

const D = (n: number | string) => Decimal.from(n)

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

async function makeContainer(opts: {
  baseCurrency?: string
  rates?: Record<string, FxRate[]>
}): Promise<AppContainer> {
  const fxRepo = new StubFxRepo(opts.rates ?? {})
  const fxStore = new FxStore(fxRepo)
  await fxStore.loadHistory(Object.keys(opts.rates ?? {}))
  const fundStore = new FundStore(stubFundRepo, fxStore)
  fundStore.baseCurrency$.set(opts.baseCurrency ?? 'USD')
  return {
    fxStore,
    fundStore,
  } as unknown as AppContainer
}

function renderWithContainer(container: AppContainer, ui: React.ReactElement) {
  return render(<ContainerProvider container={container}>{ui}</ContainerProvider>)
}

describe('TradeStatistics — multi-currency aggregation', () => {
  it('sums realized P&L across mixed-CCY trades in the user base currency', async () => {
    // USD trade: profit = (110 - 100) × 10 = $100
    const usdTrade = makeTrade({
      id: 1,
      tickerCurrency: 'USD',
      entryPrice: D(100),
      exitPrice: D(110),
      units: 10,
      exitDate: new Date('2026-05-01'),
      exitType: 'tp',
    })
    // EUR trade: profit = (50 - 40) × 10 = €100. At 1.10 → $110
    const eurTrade = makeTrade({
      id: 2,
      ticker: 'MTS.MC',
      tickerCurrency: 'EUR',
      entryPrice: D(40),
      exitPrice: D(50),
      units: 10,
      exitDate: new Date('2026-05-01'),
      exitType: 'tp',
    })

    const container = await makeContainer({
      baseCurrency: 'USD',
      rates: {
        EUR: [{ currency: 'EUR', date: new Date('2026-05-01'), rateToUsd: D(1.10) }],
      },
    })

    renderWithContainer(
      container,
      <TradeStatistics
        allTrades={[usdTrade, eurTrade]}
        filteredTrades={[usdTrade, eurTrade]}
        liveMetrics={{}}
        filter="close"
      />,
    )

    // 100 USD + 110 USD = $210.00 expected total realized.
    expect(screen.getByText('$210.00')).toBeInTheDocument()
  })

  it('aggregates a losing EUR trade as a loss in base currency', async () => {
    const eurLoser = makeTrade({
      id: 1,
      tickerCurrency: 'EUR',
      entryPrice: D(100),
      exitPrice: D(80),
      units: 10,
      exitDate: new Date('2026-05-01'),
      exitType: 'sl',
    })

    const container = await makeContainer({
      baseCurrency: 'USD',
      rates: {
        EUR: [{ currency: 'EUR', date: new Date('2026-05-01'), rateToUsd: D(1.10) }],
      },
    })

    renderWithContainer(
      container,
      <TradeStatistics
        allTrades={[eurLoser]}
        filteredTrades={[eurLoser]}
        liveMetrics={{}}
        filter="close"
      />,
    )

    // (80 - 100) × 10 = -€200. At 1.10 → -$220 → displayed as -$220.00.
    expect(screen.getByText('-$220.00')).toBeInTheDocument()
  })

  it('renders totals using the user base currency symbol', async () => {
    const usdTrade = makeTrade({
      id: 1,
      tickerCurrency: 'USD',
      entryPrice: D(100),
      exitPrice: D(110),
      units: 10,
      exitDate: new Date('2026-05-01'),
      exitType: 'tp',
    })

    const container = await makeContainer({
      baseCurrency: 'EUR',
      rates: {
        USD: [], // present but empty — USD passthrough still works
        EUR: [{ currency: 'EUR', date: new Date('2026-05-01'), rateToUsd: D(1.10) }],
      },
    })

    renderWithContainer(
      container,
      <TradeStatistics
        allTrades={[usdTrade]}
        filteredTrades={[usdTrade]}
        liveMetrics={{}}
        filter="close"
      />,
    )

    // $100 profit converted to EUR: 100 / 1.10 ≈ €90.91. Multiple stat
    // cells show this (Total + Avg Win). Just confirm at least one renders.
    expect(screen.getAllByText(/€/).length).toBeGreaterThan(0)
  })

  it('aggregates unrealized P&L for open EUR trades using today\'s rate', async () => {
    const today = new Date()
    const openEur = makeTrade({
      id: 1,
      tickerCurrency: 'EUR',
      status: 'open',
      exitDate: null,
      exitPrice: null,
      exitType: null,
    })
    const liveMetrics: Record<number, LiveMetrics> = {
      1: {
        currentPrice: D(110),
        distanceToSL: null,
        distanceToTP: null,
        distanceToPE: null,
        unrealizedPnL: D(100),  // already in EUR
        unrealizedPnLPct: null,
      },
    }

    // Today's rate of 1.20 → €100 unrealized = $120.
    // Use a date one week before today plus today to make sure walk-back works.
    const todayIso = today.toISOString().slice(0, 10)
    const container = await makeContainer({
      baseCurrency: 'USD',
      rates: {
        EUR: [
          { currency: 'EUR', date: new Date(todayIso), rateToUsd: D(1.20) },
        ],
      },
    })

    renderWithContainer(
      container,
      <TradeStatistics
        allTrades={[openEur]}
        filteredTrades={[openEur]}
        liveMetrics={liveMetrics}
        filter="open"
      />,
    )

    // €100 unrealized × today's rate 1.20 = $120 in base. Total + Avg Win
    // both show this — assert at least one cell matches.
    expect(screen.getAllByText('$120.00').length).toBeGreaterThan(0)
  })

  it('skips trades whose FX rate is not loaded (no crash)', async () => {
    // GBP rate not loaded — trade should be skipped silently.
    const gbpTrade = makeTrade({
      id: 1,
      tickerCurrency: 'GBP',
      entryPrice: D(100),
      exitPrice: D(110),
      units: 10,
      exitDate: new Date('2026-05-01'),
      exitType: 'tp',
    })

    const container = await makeContainer({ baseCurrency: 'USD', rates: {} })

    renderWithContainer(
      container,
      <TradeStatistics
        allTrades={[gbpTrade]}
        filteredTrades={[gbpTrade]}
        liveMetrics={{}}
        filter="close"
      />,
    )

    // Total P&L renders as $0.00 (skipped, not crashed).
    expect(screen.getAllByText('$0.00').length).toBeGreaterThan(0)
  })
})
