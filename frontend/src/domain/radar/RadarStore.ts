import { observable } from '@legendapp/state'
import type { IRadarPresetRepository } from './IRadarPresetRepository'
import type { RadarPreset } from './types'
import type { IBenchmarkRepository } from '../benchmark/IBenchmarkRepository'
import type { BenchmarkIndicators } from '../benchmark/types'
import {
  computeSmaStructure,
  computePriceChanges,
  computeLinearRegressionStructure,
  computeRsi,
} from './indicators'
import {
  EMPTY_SMA,
  EMPTY_CHANGES,
  EMPTY_LR,
  EMPTY_RSI,
  startDate,
  SYNC_THROTTLE_MS,
} from './indicatorBuild'
import {
  DEFAULT_VIEW_STATE,
  diffFromDefault,
  mergeWithDefault,
  type RadarViewState,
} from './filterSort'

const STORAGE_KEY = 'asistrader:radar:symbols'
const BENCHMARK_STORAGE_KEY = 'asistrader:radar:benchmarks'
const VIEW_STORAGE_KEY = 'asistrader:radar:view'

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

function loadViewFromStorage(): RadarViewState {
  try {
    const raw = localStorage.getItem(VIEW_STORAGE_KEY)
    if (!raw) return DEFAULT_VIEW_STATE
    return mergeWithDefault(JSON.parse(raw))
  } catch {
    return DEFAULT_VIEW_STATE
  }
}

function saveViewToStorage(state: RadarViewState) {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // non-fatal
  }
}

export function buildBenchmarkIndicators(
  symbol: string,
  rows: { date: string; close: number | null }[],
  error: string | null,
): BenchmarkIndicators {
  if (error) {
    return {
      symbol,
      name: null,
      currentPrice: null,
      sma: EMPTY_SMA,
      priceChanges: EMPTY_CHANGES,
      linearRegression: EMPTY_LR,
      rsi: EMPTY_RSI,
      datedCloses: [],
      error,
    }
  }
  const datedCloses = rows
    .filter((r): r is { date: string; close: number } => r.close !== null)
    .map((r) => ({ date: r.date, close: r.close }))
  const closes = datedCloses.map((d) => d.close)
  if (closes.length === 0) {
    return {
      symbol,
      name: null,
      currentPrice: null,
      sma: EMPTY_SMA,
      priceChanges: EMPTY_CHANGES,
      linearRegression: EMPTY_LR,
      rsi: EMPTY_RSI,
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
    linearRegression: computeLinearRegressionStructure(closes),
    rsi: computeRsi(datedCloses),
    datedCloses,
    error: null,
  }
}

/**
 * Radar-specific state: the watchlist (persisted), the display view/filter, saved
 * presets, and benchmarks. Ticker indicators now live in the shared IndicatorStore
 * (loaded from a common ancestor over watchlist ∪ traded), so this store no longer
 * owns or scopes them — the Radar page reads IndicatorStore.indicators$ and filters
 * it for display. Benchmarks stay here because they're radar-only.
 */
export class RadarStore {
  readonly symbols$ = observable<string[]>(loadFromStorage(STORAGE_KEY))
  readonly benchmarkSymbols$ = observable<string[]>(loadFromStorage(BENCHMARK_STORAGE_KEY))
  readonly benchmarkIndicators$ = observable<BenchmarkIndicators[]>([])
  readonly loading$ = observable(false)
  readonly error$ = observable<string | null>(null)
  readonly view$ = observable<RadarViewState>(loadViewFromStorage())
  readonly presets$ = observable<RadarPreset[]>([])
  readonly presetsError$ = observable<string | null>(null)
  private lastSyncTime = 0

  constructor(
    private readonly benchmarkRepo: IBenchmarkRepository,
    private readonly presetRepo: IRadarPresetRepository,
  ) {}

  async loadBenchmarks(force = false): Promise<void> {
    const benchmarkSymbols = this.benchmarkSymbols$.get()
    if (benchmarkSymbols.length === 0) {
      this.benchmarkIndicators$.set([])
      return
    }

    this.loading$.set(true)
    this.error$.set(null)
    try {
      const start = startDate()
      const now = Date.now()
      if (force || now - this.lastSyncTime > SYNC_THROTTLE_MS) {
        await this.benchmarkRepo.syncBenchmarkData(benchmarkSymbols, start)
        this.lastSyncTime = Date.now()
      }
      const result = await this.benchmarkRepo.fetchBulkBenchmarkData(benchmarkSymbols, start)
      this.benchmarkIndicators$.set(
        benchmarkSymbols.map((symbol) =>
          buildBenchmarkIndicators(symbol, result.data[symbol] ?? [], result.errors[symbol] ?? null),
        ),
      )
    } catch (err) {
      this.error$.set(err instanceof Error ? err.message : 'Failed to load benchmarks')
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
  }

  removeSymbol(symbol: string): void {
    const updated = this.symbols$.get().filter((s) => s !== symbol)
    this.symbols$.set(updated)
    saveToStorage(STORAGE_KEY, updated)
  }

  addBenchmark(symbol: string): void {
    const current = this.benchmarkSymbols$.get()
    const upper = symbol.toUpperCase()
    if (current.includes(upper)) return
    const updated = [...current, upper]
    this.benchmarkSymbols$.set(updated)
    saveToStorage(BENCHMARK_STORAGE_KEY, updated)
    this.loadBenchmarks()
  }

  removeBenchmark(symbol: string): void {
    const updated = this.benchmarkSymbols$.get().filter((s) => s !== symbol)
    this.benchmarkSymbols$.set(updated)
    saveToStorage(BENCHMARK_STORAGE_KEY, updated)
    this.benchmarkIndicators$.set(
      this.benchmarkIndicators$.get().filter((i) => i.symbol !== symbol),
    )
  }

  setView(next: RadarViewState): void {
    this.view$.set(next)
    saveViewToStorage(next)
  }

  resetView(): void {
    this.view$.set(DEFAULT_VIEW_STATE)
    try {
      localStorage.removeItem(VIEW_STORAGE_KEY)
    } catch {
      // non-fatal
    }
  }

  // --- Presets ---------------------------------------------------------

  private sortPresets(presets: RadarPreset[]): RadarPreset[] {
    return [...presets].sort((a, b) => a.name.localeCompare(b.name))
  }

  async loadPresets(): Promise<void> {
    this.presetsError$.set(null)
    try {
      this.presets$.set(this.sortPresets(await this.presetRepo.fetchPresets()))
    } catch (err) {
      this.presetsError$.set(err instanceof Error ? err.message : 'Failed to load presets')
    }
  }

  /** Save the current live view as a new named preset (sparse diff from defaults). */
  async savePreset(name: string): Promise<RadarPreset> {
    this.presetsError$.set(null)
    try {
      const config = diffFromDefault(this.view$.get())
      const preset = await this.presetRepo.createPreset(name.trim(), config)
      this.presets$.set(this.sortPresets([...this.presets$.get(), preset]))
      return preset
    } catch (err) {
      this.presetsError$.set(err instanceof Error ? err.message : 'Failed to save preset')
      throw err
    }
  }

  /** Apply a preset: elided settings reset to their current defaults. */
  applyPreset(preset: RadarPreset): void {
    this.setView(mergeWithDefault(preset.config))
  }

  /** Overwrite an existing preset's config with the current live view. */
  async overwritePreset(id: number): Promise<void> {
    this.presetsError$.set(null)
    try {
      const config = diffFromDefault(this.view$.get())
      const updated = await this.presetRepo.updatePreset(id, { config })
      this.presets$.set(
        this.sortPresets(this.presets$.get().map((p) => (p.id === id ? updated : p))),
      )
    } catch (err) {
      this.presetsError$.set(err instanceof Error ? err.message : 'Failed to update preset')
      throw err
    }
  }

  async renamePreset(id: number, name: string): Promise<void> {
    this.presetsError$.set(null)
    try {
      const updated = await this.presetRepo.updatePreset(id, { name: name.trim() })
      this.presets$.set(
        this.sortPresets(this.presets$.get().map((p) => (p.id === id ? updated : p))),
      )
    } catch (err) {
      this.presetsError$.set(err instanceof Error ? err.message : 'Failed to rename preset')
      throw err
    }
  }

  async deletePreset(id: number): Promise<void> {
    this.presetsError$.set(null)
    try {
      await this.presetRepo.deletePreset(id)
      this.presets$.set(this.presets$.get().filter((p) => p.id !== id))
    } catch (err) {
      this.presetsError$.set(err instanceof Error ? err.message : 'Failed to delete preset')
      throw err
    }
  }
}
