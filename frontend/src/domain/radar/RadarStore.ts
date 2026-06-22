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

// Favorites are scoped per account: the user id is appended to these bases (see
// scopeToUser), so two accounts on the same browser never share a list. Pre-scope
// (logged out) nothing persists. Benchmarks/view remain per-browser for now.
const FAVORITES_KEY_BASE = 'asistrader:radar:symbols'
const FAVORITES_ONLY_KEY_BASE = 'asistrader:radar:favoritesOnly'
const BENCHMARK_STORAGE_KEY = 'asistrader:radar:benchmarks'
const VIEW_STORAGE_KEY = 'asistrader:radar:view'

function loadFlagFromStorage(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true'
  } catch {
    return false
  }
}

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
 * Radar-specific state: the favorites set (persisted), the favorites-only flag,
 * the display view/filter, saved presets, and benchmarks. Ticker indicators live
 * in the shared IndicatorStore, loaded over *every* DB ticker ∪ traded — so the
 * favorites set no longer scopes the universe; it only powers a display filter
 * and the per-card star. Benchmarks stay here because they're radar-only.
 */
export class RadarStore {
  // The user's favorites (formerly the watchlist). No longer gates what the radar
  // shows — every DB ticker is loaded — it just powers the optional favorites
  // filter and the per-card star. Empty until scopeToUser() hydrates it from the
  // account-scoped key (so it never leaks across accounts on a shared browser).
  readonly symbols$ = observable<string[]>([])
  // When true, the radar/screening views show favorites only. Account-scoped too.
  readonly favoritesOnly$ = observable<boolean>(false)
  readonly benchmarkSymbols$ = observable<string[]>(loadFromStorage(BENCHMARK_STORAGE_KEY))
  readonly benchmarkIndicators$ = observable<BenchmarkIndicators[]>([])
  readonly loading$ = observable(false)
  readonly error$ = observable<string | null>(null)
  readonly view$ = observable<RadarViewState>(loadViewFromStorage())
  readonly presets$ = observable<RadarPreset[]>([])
  readonly presetsError$ = observable<string | null>(null)
  private lastSyncTime = 0
  // The account the favorites are currently scoped to (null = logged out).
  private userId: number | null = null

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

  private favoritesKey(): string | null {
    return this.userId == null ? null : `${FAVORITES_KEY_BASE}:${this.userId}`
  }

  private favoritesOnlyKey(): string | null {
    return this.userId == null ? null : `${FAVORITES_ONLY_KEY_BASE}:${this.userId}`
  }

  /**
   * Point the favorites at `userId` (call on login/logout). Re-hydrates from that
   * account's keys, so switching accounts on one browser never shows another
   * user's list. Logged out (null) clears it and stops persisting.
   */
  scopeToUser(userId: number | null): void {
    if (userId === this.userId) return
    this.userId = userId
    const fk = this.favoritesKey()
    this.symbols$.set(fk ? loadFromStorage(fk) : [])
    const fok = this.favoritesOnlyKey()
    this.favoritesOnly$.set(fok ? loadFlagFromStorage(fok) : false)
  }

  addSymbol(symbol: string): void {
    const symbols = this.symbols$.get()
    const upper = symbol.toUpperCase()
    if (symbols.includes(upper)) return
    const updated = [...symbols, upper]
    this.symbols$.set(updated)
    const key = this.favoritesKey()
    if (key) saveToStorage(key, updated)
  }

  removeSymbol(symbol: string): void {
    const updated = this.symbols$.get().filter((s) => s !== symbol)
    this.symbols$.set(updated)
    const key = this.favoritesKey()
    if (key) saveToStorage(key, updated)
  }

  /** Favorite/unfavorite a symbol (the per-card star). */
  toggleSymbol(symbol: string): void {
    const upper = symbol.toUpperCase()
    if (this.symbols$.get().includes(upper)) {
      this.removeSymbol(upper)
    } else {
      this.addSymbol(upper)
    }
  }

  setFavoritesOnly(on: boolean): void {
    this.favoritesOnly$.set(on)
    const key = this.favoritesOnlyKey()
    if (!key) return
    try {
      localStorage.setItem(key, String(on))
    } catch {
      // non-fatal
    }
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
