import { describe, it, expect } from 'vitest'
import { Decimal } from '../../shared/Decimal'
import { TradeStore } from '../TradeStore'
import { LiveMetricsStore } from '../LiveMetricsStore'
import { TradeMetricsStore } from '../TradeMetricsStore'
import { FundStore } from '../../fund/FundStore'
import { FxStore } from '../../fx/FxStore'
import type { ITradeRepository, IPriceProvider } from '../ITradeRepository'
import type { IFundRepository } from '../../fund/IFundRepository'
import type { IFxRepository } from '../../fx/IFxRepository'
import type { FxRate } from '../../fx/types'
import type { TradeWithMetrics } from '../types'

const D = (n: number | string) => Decimal.from(n)

class StubFxRepo implements IFxRepository {
  constructor(private readonly data: Record<string, FxRate[]>) {}
  async getHistory(currencies: string[]): Promise<Record<string, FxRate[]>> {
    const out: Record<string, FxRate[]> = {}
    for (const c of currencies) out[c] = this.data[c] ?? []
    return out
  }
  async sync() {
    return { results: {}, total_rows: 0, skipped: [], errors: {} }
  }
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

const stubTradeRepo = {} as unknown as ITradeRepository
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

const flushMicrotasks = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

interface Bundle {
  fxStore: FxStore
  fundStore: FundStore
  tradeStore: TradeStore
  liveMetricsStore: LiveMetricsStore
  metricsStore: TradeMetricsStore
}

async function buildBundle(opts: {
  baseCurrency?: string
  rates?: Record<string, FxRate[]>
} = {}): Promise<Bundle> {
  const fxStore = new FxStore(new StubFxRepo(opts.rates ?? {}))
  if (opts.rates) await fxStore.loadHistory(Object.keys(opts.rates))
  const fundStore = new FundStore(stubFundRepo, fxStore)
  fundStore.baseCurrency$.set(opts.baseCurrency ?? 'USD')
  const tradeStore = new TradeStore(stubTradeRepo)
  const liveMetricsStore = new LiveMetricsStore(tradeStore, stubPriceProvider)
  const metricsStore = new TradeMetricsStore(
    tradeStore,
    liveMetricsStore,
    fundStore,
    fxStore,
  )
  return { fxStore, fundStore, tradeStore, liveMetricsStore, metricsStore }
}

describe('TradeMetricsStore — initial state', () => {
  it('starts with all observables null and not computing', async () => {
    const b = await buildBundle()
    expect(b.metricsStore.realized$.get()).toBeNull()
    expect(b.metricsStore.unrealized$.get()).toBeNull()
    expect(b.metricsStore.perTicker$.get()).toBeNull()
    expect(b.metricsStore.computing$.get()).toBe(false)
  })

  it('flips computing$ true when trades change, then false after microtask', async () => {
    const b = await buildBundle()
    b.tradeStore.trades$.set([makeTrade({})])
    expect(b.metricsStore.computing$.get()).toBe(true)
    await flushMicrotasks()
    expect(b.metricsStore.computing$.get()).toBe(false)
    expect(b.metricsStore.realized$.get()).not.toBeNull()
  })
})

describe('TradeMetricsStore — realized aggregation', () => {
  it('sums realized P&L across mixed-CCY trades in base', async () => {
    const b = await buildBundle({
      baseCurrency: 'USD',
      rates: {
        EUR: [{ currency: 'EUR', date: new Date('2026-05-01'), rateToUsd: D(1.10) }],
      },
    })
    const usd = makeTrade({ id: 1, tickerCurrency: 'USD', exitPrice: D(110) })
    const eur = makeTrade({
      id: 2, ticker: 'MTS.MC', tickerCurrency: 'EUR',
      entryPrice: D(40), exitPrice: D(50),
    })
    b.tradeStore.trades$.set([usd, eur])
    await flushMicrotasks()

    const realized = b.metricsStore.realized$.get()
    // USD profit: (110-100)×10 = $100
    // EUR profit: (50-40)×10 = €100 → at 1.10 = $110
    expect(realized!.totalPnL).toBeCloseTo(210, 6)
    expect(realized!.wins).toBe(2)
  })

  it('counts a losing trade in lossPnL', async () => {
    const b = await buildBundle({
      baseCurrency: 'USD',
      rates: {
        EUR: [{ currency: 'EUR', date: new Date('2026-05-01'), rateToUsd: D(1.10) }],
      },
    })
    const eurLoser = makeTrade({
      tickerCurrency: 'EUR', exitPrice: D(80), exitType: 'sl',
    })
    b.tradeStore.trades$.set([eurLoser])
    await flushMicrotasks()

    const realized = b.metricsStore.realized$.get()
    // (80-100)×10 = -€200 → -$220
    expect(realized!.totalPnL).toBeCloseTo(-220, 6)
    expect(realized!.losses).toBe(1)
  })

  it('skips trades whose FX rate is not loaded (no crash)', async () => {
    const b = await buildBundle({ baseCurrency: 'USD', rates: {} })
    const gbp = makeTrade({ tickerCurrency: 'GBP' })
    b.tradeStore.trades$.set([gbp])
    await flushMicrotasks()

    const realized = b.metricsStore.realized$.get()
    expect(realized).not.toBeNull()
    expect(realized!.totalPnL).toBe(0)  // skipped, not crashed
  })
})

describe('TradeMetricsStore — unrealized aggregation', () => {
  it('converts open-trade pnl using today\'s rate', async () => {
    const today = new Date()
    const b = await buildBundle({
      baseCurrency: 'USD',
      rates: {
        EUR: [{ currency: 'EUR', date: new Date(today.toISOString().slice(0, 10)), rateToUsd: D(1.20) }],
      },
    })

    const open = makeTrade({
      tickerCurrency: 'EUR',
      status: 'open',
      exitDate: null,
      exitPrice: null,
      exitType: null,
    })
    b.tradeStore.trades$.set([open])

    // Inject a live unrealizedPnL via the prices observable. LiveMetricsStore
    // computes metrics from prices; we shortcut by directly setting prices to
    // induce a pnl computation in computeMetrics.
    b.liveMetricsStore.prices$.set({
      [open.ticker]: { price: D(110), currency: 'EUR', valid: true },
    })
    await flushMicrotasks()

    const unrealized = b.metricsStore.unrealized$.get()
    expect(unrealized).not.toBeNull()
    // (110 - 100) × 10 = €100 unrealized → at 1.20 = $120
    expect(unrealized!.totalPnL).toBeCloseTo(120, 6)
  })
})

describe('TradeMetricsStore — perTicker', () => {
  it('groups closed trades by symbol (not affected by filter)', async () => {
    const b = await buildBundle()
    const t1 = makeTrade({ id: 1, ticker: 'AAA' })
    const t2 = makeTrade({ id: 2, ticker: 'BBB' })
    b.tradeStore.trades$.set([t1, t2])
    await flushMicrotasks()

    const perTicker = b.metricsStore.perTicker$.get()
    expect(perTicker).not.toBeNull()
    expect(perTicker!.map((s) => s.symbol).sort()).toEqual(['AAA', 'BBB'])
  })
})

describe('TradeMetricsStore — memoization', () => {
  it('does not recompute when inputs are unchanged', async () => {
    const b = await buildBundle()
    const trade = makeTrade({})
    b.tradeStore.trades$.set([trade])
    await flushMicrotasks()
    const first = b.metricsStore.realized$.get()

    // Setting the same trades array reference shouldn't trigger recompute,
    // but legendapp/state still fires onChange. The key check inside the
    // store should short-circuit. Verify computing$ doesn't flip true.
    let flipped = false
    b.metricsStore.computing$.onChange(({ value }) => {
      if (value) flipped = true
    })
    b.tradeStore.trades$.set([trade])
    await flushMicrotasks()
    // Memoization key (length + filter + base + ...) is unchanged → no flip.
    expect(flipped).toBe(false)
    expect(b.metricsStore.realized$.get()).toBe(first)
  })

  it('does recompute when base currency changes', async () => {
    const b = await buildBundle({
      baseCurrency: 'USD',
      rates: {
        EUR: [{ currency: 'EUR', date: new Date('2026-05-01'), rateToUsd: D(1.10) }],
      },
    })
    b.tradeStore.trades$.set([makeTrade({ tickerCurrency: 'USD' })])
    await flushMicrotasks()

    let flipped = false
    b.metricsStore.computing$.onChange(({ value }) => {
      if (value) flipped = true
    })
    b.fundStore.baseCurrency$.set('EUR')
    expect(flipped).toBe(true)
  })
})

describe('TradeMetricsStore — filter respect', () => {
  it('realized stats respect tradeStore.filter$ (winners only)', async () => {
    const b = await buildBundle()
    const winner = makeTrade({ id: 1, exitType: 'tp', exitPrice: D(110) })
    const loser = makeTrade({ id: 2, exitType: 'sl', exitPrice: D(90) })
    b.tradeStore.trades$.set([winner, loser])
    b.tradeStore.filter$.set('winners')
    await flushMicrotasks()

    const realized = b.metricsStore.realized$.get()
    expect(realized!.wins).toBe(1)
    expect(realized!.losses).toBe(0)
    // Only the winner is summed: $100
    expect(realized!.totalPnL).toBeCloseTo(100, 6)
  })
})
