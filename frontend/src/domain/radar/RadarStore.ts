import { observable } from '@legendapp/state'
import type { IRadarRepository } from './IRadarRepository'
import type { TickerIndicators } from './types'
import { computeSmaStructure, computePriceChanges } from './indicators'

const STORAGE_KEY = 'asistrader:radar:symbols'

function loadSymbols(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveSymbols(symbols: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(symbols))
}

function startDate(): string {
  const d = new Date()
  d.setDate(d.getDate() - 300)
  return d.toISOString().split('T')[0]
}

const SYNC_THROTTLE_MS = 5 * 60 * 1000

export class RadarStore {
  readonly symbols$ = observable<string[]>(loadSymbols())
  readonly derivedSymbols$ = observable<string[]>([])
  readonly indicators$ = observable<TickerIndicators[]>([])
  readonly loading$ = observable(false)
  readonly error$ = observable<string | null>(null)
  private lastSyncTime = 0

  constructor(private readonly repo: IRadarRepository) {}

  private allSymbols(): string[] {
    const watchlist = this.symbols$.get()
    const derived = this.derivedSymbols$.get()
    const seen = new Set(watchlist)
    const extras = derived.filter((s) => !seen.has(s))
    return [...watchlist, ...extras]
  }

  setDerivedSymbols(symbols: string[]): void {
    const normalized = Array.from(new Set(symbols.map((s) => s.toUpperCase())))
    const prev = this.derivedSymbols$.get()
    const same = prev.length === normalized.length && prev.every((s, i) => s === normalized[i])
    if (same) return
    this.derivedSymbols$.set(normalized)
    this.loadIndicators()
  }

  async loadIndicators(force = false): Promise<void> {
    const symbols = this.allSymbols()
    if (symbols.length === 0) {
      this.indicators$.set([])
      return
    }

    this.loading$.set(true)
    this.error$.set(null)
    try {
      const start = startDate()
      const now = Date.now()
      if (force || now - this.lastSyncTime > SYNC_THROTTLE_MS) {
        await this.repo.syncMarketData(symbols, start)
        this.lastSyncTime = Date.now()
      }
      const { data, errors } = await this.repo.fetchBulkMarketData(symbols, start)

      const indicators: TickerIndicators[] = symbols.map((symbol) => {
        if (errors[symbol]) {
          return {
            symbol,
            name: null,
            currentPrice: null,
            sma: { sma5: null, sma20: null, sma50: null, sma200: null, structure: null },
            priceChanges: { avgChange50d: null, avgChangePct50d: null, avgChange5d: null, avgChangePct5d: null },
            datedCloses: [],
            error: errors[symbol],
          }
        }

        const rows = data[symbol] ?? []
        const datedCloses = rows
          .filter((r): r is typeof r & { close: number } => r.close !== null)
          .map((r) => ({ date: r.date, close: r.close }))
        const closes = datedCloses.map((r) => r.close)

        if (closes.length === 0) {
          return {
            symbol,
            name: null,
            currentPrice: null,
            sma: { sma5: null, sma20: null, sma50: null, sma200: null, structure: null },
            priceChanges: { avgChange50d: null, avgChangePct50d: null, avgChange5d: null, avgChangePct5d: null },
            datedCloses: [],
            error: 'No price data available',
          }
        }

        const currentPrice = closes[closes.length - 1]
        return {
          symbol,
          name: null,
          currentPrice,
          sma: computeSmaStructure(closes, currentPrice),
          priceChanges: computePriceChanges(closes),
          datedCloses,
          error: null,
        }
      })

      this.indicators$.set(indicators)
    } catch (err) {
      this.error$.set(err instanceof Error ? err.message : 'Failed to load indicators')
    } finally {
      this.loading$.set(false)
    }
  }

  addSymbol(symbol: string): void {
    const symbols = this.symbols$.get()
    const upper = symbol.toUpperCase()
    if (symbols.includes(upper)) return
    const updated = [...symbols, upper]
    this.symbols$.set(updated)
    saveSymbols(updated)
    this.loadIndicators()
  }

  removeSymbol(symbol: string): void {
    const updated = this.symbols$.get().filter((s) => s !== symbol)
    this.symbols$.set(updated)
    saveSymbols(updated)
    if (!this.derivedSymbols$.get().includes(symbol)) {
      this.indicators$.set(this.indicators$.get().filter((i) => i.symbol !== symbol))
    }
  }
}
