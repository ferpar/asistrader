import { describe, it, expect } from 'vitest'
import { Decimal } from '../../shared/Decimal'
import { FxStore } from '../../fx/FxStore'
import type { IFxRepository } from '../../fx/IFxRepository'
import type { FxRate } from '../../fx/types'
import { computeBalance } from '../computeBalance'
import type { FundEvent } from '../types'

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

const D = (n: number | string) => Decimal.from(n)

function event(partial: Partial<FundEvent> & Pick<FundEvent, 'eventType' | 'amount' | 'currency' | 'eventDate'>): FundEvent {
  return {
    id: 0,
    userId: 1,
    description: null,
    tradeId: null,
    autoDetect: false,
    voided: false,
    createdAt: new Date(),
    ...partial,
  } as FundEvent
}

async function makeFxStore() {
  const repo = new StubFxRepo({
    EUR: [
      { currency: 'EUR', date: new Date('2026-05-01'), rateToUsd: D(1.10) },
    ],
  })
  const store = new FxStore(repo)
  await store.loadHistory(['EUR'])
  return store
}

describe('computeBalance multi-currency', () => {
  it('sums USD-only events directly', async () => {
    const fx = await makeFxStore()
    const events: FundEvent[] = [
      event({ eventType: 'deposit', amount: D(1000), currency: 'USD', eventDate: new Date('2026-05-01') }),
      event({ eventType: 'withdrawal', amount: D(200), currency: 'USD', eventDate: new Date('2026-05-01') }),
    ]
    const balance = computeBalance(events, D(0.02), 'USD', fx)
    expect(balance.equity.toNumber()).toBe(800)
    expect(balance.baseCurrency).toBe('USD')
  })

  it('converts EUR deposit to USD using the event-date rate', async () => {
    const fx = await makeFxStore()
    const events: FundEvent[] = [
      event({ eventType: 'deposit', amount: D(1000), currency: 'USD', eventDate: new Date('2026-05-01') }),
      event({ eventType: 'deposit', amount: D(500), currency: 'EUR', eventDate: new Date('2026-05-01') }),
    ]
    const balance = computeBalance(events, D(0.02), 'USD', fx)
    // 1000 USD + 500 EUR × 1.10 = 1550 USD
    expect(balance.equity.toNumber()).toBeCloseTo(1550, 8)
  })

  it('re-renders the same events in EUR when base flips', async () => {
    const fx = await makeFxStore()
    const events: FundEvent[] = [
      event({ eventType: 'deposit', amount: D(1100), currency: 'USD', eventDate: new Date('2026-05-01') }),
    ]
    const balance = computeBalance(events, D(0.02), 'EUR', fx)
    // 1100 USD ÷ 1.10 = 1000 EUR
    expect(balance.equity.toNumber()).toBeCloseTo(1000, 8)
    expect(balance.baseCurrency).toBe('EUR')
  })

  it('treats reserves as committed in base currency', async () => {
    const fx = await makeFxStore()
    const events: FundEvent[] = [
      event({ eventType: 'deposit', amount: D(2000), currency: 'USD', eventDate: new Date('2026-05-01') }),
      event({ eventType: 'reserve', amount: D(500), currency: 'EUR', eventDate: new Date('2026-05-01') }),
    ]
    const balance = computeBalance(events, D(0.02), 'USD', fx)
    expect(balance.committed.toNumber()).toBeCloseTo(550, 8)
    expect(balance.available.toNumber()).toBeCloseTo(2000 - 550, 8)
  })

  it('skips events with missing FX rates without crashing', async () => {
    const fx = await makeFxStore()
    const events: FundEvent[] = [
      event({ eventType: 'deposit', amount: D(1000), currency: 'USD', eventDate: new Date('2026-05-01') }),
      // GBP rate not loaded — should be skipped silently.
      event({ eventType: 'deposit', amount: D(500), currency: 'GBP', eventDate: new Date('2026-05-01') }),
    ]
    const balance = computeBalance(events, D(0.02), 'USD', fx)
    expect(balance.equity.toNumber()).toBe(1000)
  })

  it('ignores voided events', async () => {
    const fx = await makeFxStore()
    const events: FundEvent[] = [
      event({ eventType: 'deposit', amount: D(1000), currency: 'USD', eventDate: new Date('2026-05-01') }),
      event({ eventType: 'deposit', amount: D(500), currency: 'EUR', eventDate: new Date('2026-05-01'), voided: true }),
    ]
    const balance = computeBalance(events, D(0.02), 'USD', fx)
    expect(balance.equity.toNumber()).toBe(1000)
  })
})
