import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Decimal } from '../../shared/Decimal'
import type { IFxRepository } from '../IFxRepository'
import type { FxRate } from '../types'
import { FxStore } from '../FxStore'

class StubFxRepo implements IFxRepository {
  public calls: string[][] = []
  constructor(private readonly data: Record<string, FxRate[]>) {}
  async getHistory(currencies: string[]): Promise<Record<string, FxRate[]>> {
    this.calls.push([...currencies])
    const out: Record<string, FxRate[]> = {}
    for (const c of currencies) out[c] = this.data[c] ?? []
    return out
  }
}

const D = (n: number | string) => Decimal.from(n)

describe('FxStore.convert', () => {
  let store: FxStore

  beforeEach(async () => {
    const repo = new StubFxRepo({
      EUR: [
        { currency: 'EUR', date: new Date('2026-04-30'), rateToUsd: D(1.05) },
        { currency: 'EUR', date: new Date('2026-05-01'), rateToUsd: D(1.10) },
      ],
      GBP: [
        { currency: 'GBP', date: new Date('2026-05-01'), rateToUsd: D(1.25) },
      ],
    })
    store = new FxStore(repo)
    await store.loadHistory(['EUR', 'GBP'])
  })

  it('returns same amount when from === to', () => {
    expect(store.convert(D(100), 'EUR', 'EUR', new Date('2026-05-01')).toNumber()).toBe(100)
  })

  it('converts to USD using the rate-to-usd', () => {
    const out = store.convert(D(100), 'EUR', 'USD', new Date('2026-05-01'))
    expect(out.toNumber()).toBeCloseTo(110, 8)
  })

  it('converts from USD by dividing through', () => {
    const out = store.convert(D(110), 'USD', 'EUR', new Date('2026-05-01'))
    expect(out.toNumber()).toBeCloseTo(100, 8)
  })

  it('triangulates A → USD → B', () => {
    // 100 EUR -> 110 USD -> 110 / 1.25 = 88 GBP
    const out = store.convert(D(100), 'EUR', 'GBP', new Date('2026-05-01'))
    expect(out.toNumber()).toBeCloseTo(88, 8)
  })

  it('walks back to most-recent-on-or-before for weekend dates', () => {
    // Sunday → uses Friday's rate (2026-05-01 is the most recent we have).
    const sun = new Date('2026-05-03')
    const out = store.convert(D(100), 'EUR', 'USD', sun)
    expect(out.toNumber()).toBeCloseTo(110, 8)
  })

  it('throws when no rate within fallback window', () => {
    const tooFar = new Date('2026-04-01')
    expect(() => store.convert(D(100), 'EUR', 'USD', tooFar)).toThrow()
  })

  it('USD passthrough does not require rate history', () => {
    const empty = new FxStore(new StubFxRepo({}))
    // Has not called loadHistory, but USD is implicit.
    expect(empty.convert(D(100), 'USD', 'USD', new Date('2026-05-01')).toNumber()).toBe(100)
  })
})

describe('FxStore.latestRate', () => {
  it('returns 1.0 for USD', async () => {
    const store = new FxStore(new StubFxRepo({}))
    expect(store.latestRate('USD')?.toNumber()).toBe(1)
  })

  it('returns the newest stored rate', async () => {
    const repo = new StubFxRepo({
      EUR: [
        { currency: 'EUR', date: new Date('2026-04-30'), rateToUsd: D(1.05) },
        { currency: 'EUR', date: new Date('2026-05-01'), rateToUsd: D(1.10) },
      ],
    })
    const store = new FxStore(repo)
    await store.loadHistory(['EUR'])
    expect(store.latestRate('EUR')?.toNumber()).toBeCloseTo(1.10, 8)
  })

  it('returns null for an uncovered non-USD currency', async () => {
    const store = new FxStore(new StubFxRepo({}))
    await store.loadHistory(['EUR'])
    expect(store.latestRate('JPY')).toBeNull()
  })
})

describe('FxStore — sub-unit currencies (GBp / GBX)', () => {
  let store: FxStore
  let repo: StubFxRepo

  beforeEach(async () => {
    repo = new StubFxRepo({
      GBP: [
        { currency: 'GBP', date: new Date('2026-05-01'), rateToUsd: D(1.25) },
      ],
    })
    store = new FxStore(repo)
    await store.loadHistory(['GBp'])
  })

  it('loadHistory(["GBp"]) fetches the canonical GBP series', () => {
    // The repo was asked for GBP, never GBp.
    expect(repo.calls).toEqual([['GBP']])
  })

  it('rateToUsd("GBp") = rateToUsd("GBP") / 100', () => {
    const rate = store.rateToUsd('GBp', new Date('2026-05-01'))
    expect(rate.toNumber()).toBeCloseTo(0.0125, 8)
  })

  it('GBX is an alias of GBp', () => {
    const rate = store.rateToUsd('GBX', new Date('2026-05-01'))
    expect(rate.toNumber()).toBeCloseTo(0.0125, 8)
  })

  it('converts a GBp amount to USD via the parent rate', () => {
    // RR.L at 1132.60 GBp at 1.25 GBP/USD = 14.1575 USD
    const usd = store.convert(D(1132.60), 'GBp', 'USD', new Date('2026-05-01'))
    expect(usd.toNumber()).toBeCloseTo(14.1575, 6)
  })

  it('latestRate("GBp") returns parent / 100', () => {
    const latest = store.latestRate('GBp')
    expect(latest?.toNumber()).toBeCloseTo(0.0125, 8)
  })

  it('hasRatesFor recognises GBp via its canonical parent', () => {
    expect(store.hasRatesFor(['GBp'])).toBe(true)
  })
})

describe('FxStore.loadHistory', () => {
  it('flips loaded$ to true even when called with only USD', async () => {
    const store = new FxStore(new StubFxRepo({}))
    await store.loadHistory(['USD'])
    expect(store.loaded$.get()).toBe(true)
  })

  it('skips repeat fetches by overwriting cache idempotently', async () => {
    const spy = vi.fn(async (currencies: string[]) => {
      const out: Record<string, FxRate[]> = {}
      for (const c of currencies) {
        out[c] = [{ currency: c, date: new Date('2026-05-01'), rateToUsd: D(1.10) }]
      }
      return out
    })
    const store = new FxStore({ getHistory: spy } as IFxRepository)
    await store.loadHistory(['EUR'])
    await store.loadHistory(['EUR'])
    expect(spy).toHaveBeenCalledTimes(2)
    // Cache stays valid — convert still works.
    expect(store.convert(D(10), 'EUR', 'USD', new Date('2026-05-01')).toNumber()).toBeCloseTo(11, 8)
  })
})
