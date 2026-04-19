import { observable } from '@legendapp/state'
import type { IRadarRepository } from './IRadarRepository'
import type { TickerIndicators } from './types'
import type { MarketDataRowDTO } from '../../types/radar'
import type { IBenchmarkRepository } from '../benchmark/IBenchmarkRepository'
import type { BenchmarkIndicators } from '../benchmark/types'
import type { BenchmarkMarketDataRowDTO } from '../../types/benchmark'
import { computeSmaStructure, computePriceChanges } from './indicators'

type TickerBulkResult = { data: Record<string, MarketDataRowDTO[]>; errors: Record<string, string> }
type BenchmarkBulkResult = { data: Record<string, BenchmarkMarketDataRowDTO[]>; errors: Record<string, string> }

const STORAGE_KEY = 'asistrader:radar:symbols'
const BENCHMARK_STORAGE_KEY = 'asistrader:radar:benchmarks'

function loadFromStorage(key: string): string[] {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveToStorage(key: string, values: string[]) {
  localStorage.setItem(key, JSON.stringify(values))
}

function startDate(): string {
  const d = new Date()
  d.setDate(d.getDate() - 300)
  return d.toISOString().split('T')[0]
}

const SYNC_THROTTLE_MS = 5 * 60 * 1000

const EMPTY_SMA = { sma5: null, sma20: null, sma50: null, sma200: null, structure: null }
const EMPTY_CHANGES = { avgChange50d: null, avgChangePct50d: null, avgChange5d: null, avgChangePct5d: null }

function buildBenchmarkIndicators(
  symbol: string,
  rows: { date: string; close: number | null }[],
  error: string | null,
): BenchmarkIndicators {
  if (error) {
    return { symbol, name: null, currentPrice: null, sma: EMPTY_SMA, priceChanges: EMPTY_CHANGES, error }
  }
  const closes = rows.map((r) => r.close).filter((c): c is number => c !== null)
  if (closes.length === 0) {
    return {
      symbol,
      name: null,
      currentPrice: null,
      sma: EMPTY_SMA,
      priceChanges: EMPTY_CHANGES,
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
    error: null,
  }
}

export class RadarStore {
  readonly symbols$ = observable<string[]>(loadFromStorage(STORAGE_KEY))
  readonly derivedSymbols$ = observable<string[]>([])
  readonly indicators$ = observable<TickerIndicators[]>([])
  readonly benchmarkSymbols$ = observable<string[]>(loadFromStorage(BENCHMARK_STORAGE_KEY))
  readonly benchmarkIndicators$ = observable<BenchmarkIndicators[]>([])
  readonly loading$ = observable(false)
  readonly error$ = observable<string | null>(null)
  private lastSyncTime = 0

  constructor(
    private readonly repo: IRadarRepository,
    private readonly benchmarkRepo: IBenchmarkRepository,
  ) {}

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
    const tickerSymbols = this.allSymbols()
    const benchmarkSymbols = this.benchmarkSymbols$.get()
    if (tickerSymbols.length === 0 && benchmarkSymbols.length === 0) {
      this.indicators$.set([])
      this.benchmarkIndicators$.set([])
      return
    }

    this.loading$.set(true)
    this.error$.set(null)
    try {
      const start = startDate()
      const now = Date.now()
      const shouldSync = force || now - this.lastSyncTime > SYNC_THROTTLE_MS

      const syncPromises: Promise<unknown>[] = []
      if (shouldSync && tickerSymbols.length > 0) {
        syncPromises.push(this.repo.syncMarketData(tickerSymbols, start))
      }
      if (shouldSync && benchmarkSymbols.length > 0) {
        syncPromises.push(this.benchmarkRepo.syncBenchmarkData(benchmarkSymbols, start))
      }
      if (syncPromises.length > 0) {
        await Promise.all(syncPromises)
        this.lastSyncTime = Date.now()
      }

      const emptyTicker: TickerBulkResult = { data: {}, errors: {} }
      const emptyBenchmark: BenchmarkBulkResult = { data: {}, errors: {} }
      const tickerPromise: Promise<TickerBulkResult> =
        tickerSymbols.length > 0
          ? this.repo.fetchBulkMarketData(tickerSymbols, start)
          : Promise.resolve(emptyTicker)
      const benchmarkPromise: Promise<BenchmarkBulkResult> =
        benchmarkSymbols.length > 0
          ? this.benchmarkRepo.fetchBulkBenchmarkData(benchmarkSymbols, start)
          : Promise.resolve(emptyBenchmark)
      const [tickerResult, benchmarkResult] = await Promise.all([
        tickerPromise,
        benchmarkPromise,
      ])

      const indicators: TickerIndicators[] = tickerSymbols.map((symbol) => {
        if (tickerResult.errors[symbol]) {
          return {
            symbol,
            name: null,
            currentPrice: null,
            sma: EMPTY_SMA,
            priceChanges: EMPTY_CHANGES,
            datedCloses: [],
            error: tickerResult.errors[symbol],
          }
        }

        const rows = tickerResult.data[symbol] ?? []
        const datedCloses = rows
          .filter((r): r is typeof r & { close: number } => r.close !== null)
          .map((r) => ({ date: r.date, close: r.close }))
        const closes = datedCloses.map((r) => r.close)

        if (closes.length === 0) {
          return {
            symbol,
            name: null,
            currentPrice: null,
            sma: EMPTY_SMA,
            priceChanges: EMPTY_CHANGES,
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

      const benchmarkIndicators: BenchmarkIndicators[] = benchmarkSymbols.map((symbol) =>
        buildBenchmarkIndicators(
          symbol,
          benchmarkResult.data[symbol] ?? [],
          benchmarkResult.errors[symbol] ?? null,
        ),
      )

      this.indicators$.set(indicators)
      this.benchmarkIndicators$.set(benchmarkIndicators)
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
    saveToStorage(STORAGE_KEY, updated)
    this.loadIndicators()
  }

  removeSymbol(symbol: string): void {
    const updated = this.symbols$.get().filter((s) => s !== symbol)
    this.symbols$.set(updated)
    saveToStorage(STORAGE_KEY, updated)
    if (!this.derivedSymbols$.get().includes(symbol)) {
      this.indicators$.set(this.indicators$.get().filter((i) => i.symbol !== symbol))
    }
  }

  addBenchmark(symbol: string): void {
    const current = this.benchmarkSymbols$.get()
    const upper = symbol.toUpperCase()
    if (current.includes(upper)) return
    const updated = [...current, upper]
    this.benchmarkSymbols$.set(updated)
    saveToStorage(BENCHMARK_STORAGE_KEY, updated)
    this.loadIndicators()
  }

  removeBenchmark(symbol: string): void {
    const updated = this.benchmarkSymbols$.get().filter((s) => s !== symbol)
    this.benchmarkSymbols$.set(updated)
    saveToStorage(BENCHMARK_STORAGE_KEY, updated)
    this.benchmarkIndicators$.set(
      this.benchmarkIndicators$.get().filter((i) => i.symbol !== symbol),
    )
  }
}
