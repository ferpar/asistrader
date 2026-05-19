import {
  DEFAULT_VIEW_STATE,
  SORT_KEY_DEFAULT_DIR,
  type RadarViewState,
  type TickerScope,
  type TradeScope,
  type SortKey,
  type SortDir,
  type ProximityFilter,
} from './types'

/**
 * A saved radar preset is an *open* sparse partial of {@link RadarViewState}:
 * it carries only the settings that differ from the radar defaults. Anything
 * absent resolves to its current default on apply, so presets survive the
 * radar gaining, losing, or re-defaulting settings over time.
 *
 * `ticker.search` is deliberately never persisted by {@link diffFromDefault} —
 * it is transient text, not a reusable filter.
 */
export type RadarPresetConfig = {
  ticker?: Partial<Omit<TickerScope, 'search'>>
  trade?: Partial<TradeScope>
  sort?: { key: SortKey; dir: SortDir }
  flatView?: boolean
}

// Ticker keys that a preset may carry — `search` is intentionally omitted.
const TICKER_KEYS = [
  'structure',
  'trendSign',
  'rsiZone',
  'divergence',
  'activity',
  'hideErrored',
] as const satisfies readonly Exclude<keyof TickerScope, 'search'>[]

const TRADE_KEYS = [
  'status',
  'pnlSign',
  'drift',
  'proximity',
] as const satisfies readonly (keyof TradeScope)[]

// Accepted values per enum field. Anything outside these sets is treated as
// corrupt input on apply and falls back to the default.
const ALLOWED = {
  structure: ['any', 'bullish', 'bearish', 'mixed'],
  trendSign: ['any', 'up', 'down'],
  rsiZone: ['any', 'overbought', 'oversold', 'neutral'],
  divergence: ['any', 'present', 'bullish', 'bearish', 'none'],
  activity: ['any', 'hasOpen', 'hasPlan', 'hasActive', 'hasNone'],
  status: ['any', 'plan', 'ordered', 'open'],
  pnlSign: ['any', 'winning', 'losing'],
  drift: ['any', 'ahead', 'behind', 'on-pace'],
} as const

const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * Reduce a full view state to the sparse set of settings that differ from the
 * radar defaults. The result is what gets stored as a preset's `config`.
 */
export function diffFromDefault(view: RadarViewState): RadarPresetConfig {
  const config: RadarPresetConfig = {}

  const ticker: Record<string, unknown> = {}
  for (const key of TICKER_KEYS) {
    if (!eq(view.ticker[key], DEFAULT_VIEW_STATE.ticker[key])) {
      ticker[key] = view.ticker[key]
    }
  }
  if (Object.keys(ticker).length > 0) config.ticker = ticker as RadarPresetConfig['ticker']

  const trade: Record<string, unknown> = {}
  for (const key of TRADE_KEYS) {
    if (!eq(view.trade[key], DEFAULT_VIEW_STATE.trade[key])) {
      trade[key] = view.trade[key]
    }
  }
  if (Object.keys(trade).length > 0) config.trade = trade as RadarPresetConfig['trade']

  if (!eq(view.sort, DEFAULT_VIEW_STATE.sort)) config.sort = { ...view.sort }
  if (view.flatView !== DEFAULT_VIEW_STATE.flatView) config.flatView = view.flatView

  return config
}

function pickEnum<T extends string>(
  value: unknown,
  allowed: readonly string[],
  fallback: T,
): T {
  return typeof value === 'string' && allowed.includes(value) ? (value as T) : fallback
}

function mergeProximity(raw: unknown): ProximityFilter {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  if (p.target !== 'sl' && p.target !== 'tp' && p.target !== 'pe') return null
  const pct = Number(p.withinPct)
  if (!Number.isFinite(pct) || pct < 1 || pct > 100) return null
  return { target: p.target, withinPct: pct }
}

function mergeTicker(raw: unknown): TickerScope {
  const d = DEFAULT_VIEW_STATE.ticker
  const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    structure: pickEnum(t.structure, ALLOWED.structure, d.structure),
    trendSign: pickEnum(t.trendSign, ALLOWED.trendSign, d.trendSign),
    rsiZone: pickEnum(t.rsiZone, ALLOWED.rsiZone, d.rsiZone),
    divergence: pickEnum(t.divergence, ALLOWED.divergence, d.divergence),
    activity: pickEnum(t.activity, ALLOWED.activity, d.activity),
    // `search` is preserved when present (live-view storage carries it) but is
    // never emitted into a preset config by diffFromDefault.
    search: typeof t.search === 'string' ? t.search : d.search,
    hideErrored: typeof t.hideErrored === 'boolean' ? t.hideErrored : d.hideErrored,
  }
}

function mergeTrade(raw: unknown): TradeScope {
  const d = DEFAULT_VIEW_STATE.trade
  const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    status: pickEnum(t.status, ALLOWED.status, d.status),
    pnlSign: pickEnum(t.pnlSign, ALLOWED.pnlSign, d.pnlSign),
    drift: pickEnum(t.drift, ALLOWED.drift, d.drift),
    proximity: 'proximity' in t ? mergeProximity(t.proximity) : d.proximity,
  }
}

function mergeSort(raw: unknown): { key: SortKey; dir: SortDir } {
  const d = DEFAULT_VIEW_STATE.sort
  if (!raw || typeof raw !== 'object') return { ...d }
  const s = raw as Record<string, unknown>
  const key =
    typeof s.key === 'string' && s.key in SORT_KEY_DEFAULT_DIR ? (s.key as SortKey) : d.key
  const dir: SortDir =
    s.dir === 'asc' || s.dir === 'desc' ? s.dir : SORT_KEY_DEFAULT_DIR[key]
  return { key, dir }
}

/**
 * Resolve a preset config (or any partial/untrusted view-ish object) into a
 * complete, sanitized {@link RadarViewState} by overlaying it onto a fresh copy
 * of the radar defaults. Unknown keys are ignored; invalid values fall back to
 * their default. This is the single point where a stored config becomes a
 * usable view — both for applying presets and for restoring the live view.
 */
export function mergeWithDefault(config: unknown): RadarViewState {
  const c = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>
  return {
    ticker: mergeTicker(c.ticker),
    trade: mergeTrade(c.trade),
    sort: mergeSort(c.sort),
    flatView: typeof c.flatView === 'boolean' ? c.flatView : DEFAULT_VIEW_STATE.flatView,
  }
}

/**
 * Whether a live view still exactly reproduces a saved preset. Both sides are
 * reduced to their canonical sparse form first, so a preset config with stale
 * or unknown keys still compares cleanly. The transient `ticker.search` is
 * ignored — it is never part of a preset.
 */
export function viewMatchesConfig(view: RadarViewState, config: unknown): boolean {
  const canonical = (c: unknown): string =>
    JSON.stringify(diffFromDefault(mergeWithDefault(c)))
  return JSON.stringify(diffFromDefault(view)) === canonical(config)
}
