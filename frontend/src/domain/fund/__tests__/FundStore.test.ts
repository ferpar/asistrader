import { describe, it, expect, beforeEach } from 'vitest'
import { Decimal } from '../../shared/Decimal'
import { FundStore } from '../FundStore'
import { FxStore } from '../../fx/FxStore'
import type { IFundRepository } from '../IFundRepository'
import type { IFxRepository } from '../../fx/IFxRepository'
import type { FxRate } from '../../fx/types'
import type { FundEvent } from '../types'
import type { FundSettingsDTO, FundSettingsRequest } from '../../../types/fund'

const D = (n: number | string) => Decimal.from(n)

class StubFxRepo implements IFxRepository {
  public calls: string[][] = []
  public syncCalls: string[][] = []
  constructor(private readonly data: Record<string, FxRate[]>) {}
  async getHistory(currencies: string[]): Promise<Record<string, FxRate[]>> {
    this.calls.push([...currencies])
    const out: Record<string, FxRate[]> = {}
    for (const c of currencies) out[c] = this.data[c] ?? []
    return out
  }
  async sync(currencies: string[]) {
    this.syncCalls.push([...currencies])
    return { results: {}, total_rows: 0, skipped: [], errors: {} }
  }
}

function makeFundRepo(opts: {
  events?: FundEvent[]
  settings?: FundSettingsDTO
} = {}): IFundRepository & { updateCalls: FundSettingsRequest[] } {
  const updateCalls: FundSettingsRequest[] = []
  let current: FundSettingsDTO = opts.settings ?? { risk_pct: 0.02, base_currency: 'USD' }
  return {
    updateCalls,
    async fetchEvents() {
      return opts.events ?? []
    },
    async createDeposit() {
      throw new Error('not used')
    },
    async createWithdrawal() {
      throw new Error('not used')
    },
    async createManualEvent() {
      throw new Error('not used')
    },
    async voidEvent() {
      throw new Error('not used')
    },
    async fetchSettings() {
      return current
    },
    async updateSettings(req) {
      updateCalls.push(req)
      current = {
        risk_pct: req.risk_pct ?? current.risk_pct,
        base_currency: req.base_currency ?? current.base_currency,
      }
      return current
    },
  }
}

function makeFxStore(rates: Record<string, FxRate[]> = {}): {
  store: FxStore
  repo: StubFxRepo
} {
  const repo = new StubFxRepo(rates)
  return { store: new FxStore(repo), repo }
}

describe('FundStore.loadSettings', () => {
  it('hydrates riskPct$ and baseCurrency$ from the API', async () => {
    const fundRepo = makeFundRepo({
      settings: { risk_pct: 0.05, base_currency: 'EUR' },
    })
    const { store: fx } = makeFxStore()
    const fund = new FundStore(fundRepo, fx)

    await fund.loadSettings()

    expect(fund.riskPct$.get().toNumber()).toBe(0.05)
    expect(fund.baseCurrency$.get()).toBe('EUR')
  })

  it('falls back to defaults when API rejects', async () => {
    const fundRepo = makeFundRepo()
    fundRepo.fetchSettings = async () => {
      throw new Error('network')
    }
    const { store: fx } = makeFxStore()
    const fund = new FundStore(fundRepo, fx)

    await fund.loadSettings()

    expect(fund.riskPct$.get().toNumber()).toBe(0.02)
    expect(fund.baseCurrency$.get()).toBe('USD')
  })
})

describe('FundStore.updateBaseCurrency', () => {
  let fundRepo: ReturnType<typeof makeFundRepo>
  let fxStore: FxStore
  let fxRepo: StubFxRepo

  beforeEach(() => {
    fundRepo = makeFundRepo({
      events: [
        {
          id: 1,
          userId: 1,
          eventType: 'deposit',
          amount: D(1000),
          currency: 'USD',
          description: null,
          tradeId: null,
          autoDetect: false,
          voided: false,
          eventDate: new Date('2026-05-01'),
          createdAt: new Date(),
        },
        {
          id: 2,
          userId: 1,
          eventType: 'deposit',
          amount: D(500),
          currency: 'EUR',
          description: null,
          tradeId: null,
          autoDetect: false,
          voided: false,
          eventDate: new Date('2026-05-01'),
          createdAt: new Date(),
        },
      ],
    })
    const fx = makeFxStore({
      EUR: [
        { currency: 'EUR', date: new Date('2026-05-01'), rateToUsd: D(1.10) },
      ],
    })
    fxStore = fx.store
    fxRepo = fx.repo
  })

  it('updates baseCurrency$ on the store', async () => {
    const fund = new FundStore(fundRepo, fxStore)
    expect(fund.baseCurrency$.get()).toBe('USD')

    await fund.updateBaseCurrency('EUR')

    expect(fund.baseCurrency$.get()).toBe('EUR')
  })

  it('sends the change to the repository', async () => {
    const fund = new FundStore(fundRepo, fxStore)
    await fund.updateBaseCurrency('EUR')

    expect(fundRepo.updateCalls).toHaveLength(1)
    expect(fundRepo.updateCalls[0]).toEqual({ base_currency: 'EUR' })
  })

  it('triggers FxStore.loadHistory covering events + new base', async () => {
    const fund = new FundStore(fundRepo, fxStore)
    // Load events first so the store knows about EUR + USD events.
    await fund.loadEvents()
    fxRepo.calls = [] // reset before the act under test.

    await fund.updateBaseCurrency('GBP')

    expect(fxRepo.calls.length).toBeGreaterThan(0)
    const requestedCurrencies = fxRepo.calls[0]
    // GBP (new base) is fetched. EUR (existing event currency) is fetched.
    // USD is filtered out by FxStore (anchor).
    expect(requestedCurrencies).toContain('GBP')
    expect(requestedCurrencies).toContain('EUR')
    expect(requestedCurrencies).not.toContain('USD')
  })

  it('balance$ recomputes in the new base currency', async () => {
    const fund = new FundStore(fundRepo, fxStore)
    await fund.loadEvents()
    // Flush the queued recompute microtask.
    await Promise.resolve()

    const usdBalance = fund.balance$.get()
    expect(usdBalance).not.toBeNull()
    // 1000 USD + 500 EUR × 1.10 = 1550 USD
    expect(usdBalance!.equity.toNumber()).toBeCloseTo(1550, 8)

    await fund.updateBaseCurrency('EUR')
    await Promise.resolve()

    const eurBalance = fund.balance$.get()
    expect(eurBalance).not.toBeNull()
    // Same events: 1000 USD ÷ 1.10 + 500 EUR ≈ 909.09 + 500 = 1409.09
    expect(eurBalance!.equity.toNumber()).toBeCloseTo(909.0909090909 + 500, 6)
    expect(eurBalance!.baseCurrency).toBe('EUR')
  })
})

describe('FundStore.loadEvents — FX hydration side effect', () => {
  it('asks FxStore for history covering every event currency + base', async () => {
    const fundRepo = makeFundRepo({
      events: [
        {
          id: 1, userId: 1, eventType: 'deposit', amount: D(100),
          currency: 'EUR', description: null, tradeId: null,
          autoDetect: false, voided: false,
          eventDate: new Date('2026-05-01'), createdAt: new Date(),
        },
        {
          id: 2, userId: 1, eventType: 'deposit', amount: D(200),
          currency: 'GBP', description: null, tradeId: null,
          autoDetect: false, voided: false,
          eventDate: new Date('2026-05-01'), createdAt: new Date(),
        },
      ],
    })
    const fx = makeFxStore()
    const fund = new FundStore(fundRepo, fx.store)

    await fund.loadEvents()

    expect(fx.repo.calls.length).toBeGreaterThan(0)
    const requested = fx.repo.calls[0]
    expect(requested).toContain('EUR')
    expect(requested).toContain('GBP')
  })

  it('does not call FxStore for currencies it has already loaded', async () => {
    // Even with repeats, the store de-dupes via Set. We just confirm one call
    // is made per loadEvents invocation rather than N per event.
    const fundRepo = makeFundRepo({
      events: [
        {
          id: 1, userId: 1, eventType: 'deposit', amount: D(100),
          currency: 'EUR', description: null, tradeId: null,
          autoDetect: false, voided: false,
          eventDate: new Date('2026-05-01'), createdAt: new Date(),
        },
        {
          id: 2, userId: 1, eventType: 'deposit', amount: D(200),
          currency: 'EUR', description: null, tradeId: null,
          autoDetect: false, voided: false,
          eventDate: new Date('2026-05-02'), createdAt: new Date(),
        },
      ],
    })
    const fx = makeFxStore()
    const fund = new FundStore(fundRepo, fx.store)

    await fund.loadEvents()

    expect(fx.repo.calls).toHaveLength(1)
    const uniqueRequested = new Set(fx.repo.calls[0])
    expect(uniqueRequested.size).toBe(fx.repo.calls[0].length)
  })
})

describe('FundStore.updateRiskPct', () => {
  it('persists risk_pct without touching base_currency', async () => {
    const fundRepo = makeFundRepo({
      settings: { risk_pct: 0.02, base_currency: 'EUR' },
    })
    const { store: fx } = makeFxStore()
    const fund = new FundStore(fundRepo, fx)
    await fund.loadSettings()

    await fund.updateRiskPct(0.05)

    expect(fundRepo.updateCalls).toContainEqual({ risk_pct: 0.05 })
    expect(fund.riskPct$.get().toNumber()).toBe(0.05)
    expect(fund.baseCurrency$.get()).toBe('EUR')
  })
})
