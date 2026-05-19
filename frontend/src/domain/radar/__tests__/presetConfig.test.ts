import { describe, it, expect } from 'vitest'
import {
  DEFAULT_VIEW_STATE,
  type RadarViewState,
  type TickerScope,
  type TradeScope,
} from '../filterSort/types'
import {
  diffFromDefault,
  mergeWithDefault,
  viewMatchesConfig,
} from '../filterSort/presetConfig'

/** Build a view state from sparse, deeply-partial overrides. */
function buildViewState(overrides?: {
  ticker?: Partial<TickerScope>
  trade?: Partial<TradeScope>
  sort?: RadarViewState['sort']
  flatView?: boolean
}): RadarViewState {
  return {
    ticker: { ...DEFAULT_VIEW_STATE.ticker, ...(overrides?.ticker ?? {}) },
    trade: { ...DEFAULT_VIEW_STATE.trade, ...(overrides?.trade ?? {}) },
    sort: overrides?.sort ?? { ...DEFAULT_VIEW_STATE.sort },
    flatView: overrides?.flatView ?? DEFAULT_VIEW_STATE.flatView,
  }
}

describe('diffFromDefault', () => {
  it('returns an empty config for the default view', () => {
    expect(diffFromDefault(DEFAULT_VIEW_STATE)).toEqual({})
  })

  it('captures only the settings that differ from defaults', () => {
    const view = buildViewState({
      ticker: { rsiZone: 'oversold', hideErrored: true },
      sort: { key: 'rsi', dir: 'asc' },
    })
    expect(diffFromDefault(view)).toEqual({
      ticker: { rsiZone: 'oversold', hideErrored: true },
      sort: { key: 'rsi', dir: 'asc' },
    })
  })

  it('never persists the transient search text', () => {
    const view = buildViewState({ ticker: { search: 'AAPL' } })
    expect(diffFromDefault(view)).toEqual({})
  })

  it('captures an enabled proximity filter', () => {
    const view = buildViewState({
      trade: { proximity: { target: 'tp', withinPct: 5 } },
    })
    expect(diffFromDefault(view).trade).toEqual({
      proximity: { target: 'tp', withinPct: 5 },
    })
  })
})

describe('mergeWithDefault', () => {
  it('resolves an empty config to the full defaults', () => {
    expect(mergeWithDefault({})).toEqual(DEFAULT_VIEW_STATE)
  })

  it('elided settings fall back to their defaults', () => {
    const merged = mergeWithDefault({ ticker: { rsiZone: 'overbought' } })
    expect(merged.ticker.rsiZone).toBe('overbought')
    expect(merged.ticker.structure).toBe(DEFAULT_VIEW_STATE.ticker.structure)
    expect(merged.trade).toEqual(DEFAULT_VIEW_STATE.trade)
    expect(merged.sort).toEqual(DEFAULT_VIEW_STATE.sort)
  })

  it('ignores unknown keys so old presets survive radar changes', () => {
    const merged = mergeWithDefault({
      ticker: { rsiZone: 'oversold', removedSetting: 'whatever' },
      brandNewScope: { x: 1 },
    })
    expect(merged.ticker.rsiZone).toBe('oversold')
    expect(merged).toEqual(buildViewState({ ticker: { rsiZone: 'oversold' } }))
  })

  it('coerces invalid enum values back to defaults', () => {
    const merged = mergeWithDefault({
      ticker: { structure: 'not-a-real-value' },
      sort: { key: 'bogus', dir: 'sideways' },
    })
    expect(merged.ticker.structure).toBe(DEFAULT_VIEW_STATE.ticker.structure)
    expect(merged.sort).toEqual(DEFAULT_VIEW_STATE.sort)
  })

  it('rejects a malformed proximity filter', () => {
    expect(mergeWithDefault({ trade: { proximity: { target: 'xx' } } }).trade.proximity).toBeNull()
    expect(
      mergeWithDefault({ trade: { proximity: { target: 'sl', withinPct: 999 } } }).trade
        .proximity,
    ).toBeNull()
  })
})

describe('diff/merge round-trip', () => {
  it('a diffed-then-merged view equals the original', () => {
    const view = buildViewState({
      ticker: { structure: 'bullish', divergence: 'bearish', hideErrored: true },
      trade: { status: 'open', proximity: { target: 'sl', withinPct: 10 } },
      sort: { key: 'biggestLoser', dir: 'asc' },
      flatView: true,
    })
    expect(mergeWithDefault(diffFromDefault(view))).toEqual(view)
  })

  it('round-trips the default view', () => {
    expect(mergeWithDefault(diffFromDefault(DEFAULT_VIEW_STATE))).toEqual(DEFAULT_VIEW_STATE)
  })
})

describe('viewMatchesConfig', () => {
  const config = { ticker: { rsiZone: 'oversold' }, sort: { key: 'rsi', dir: 'asc' } }

  it('matches the view produced by applying the preset', () => {
    const applied = mergeWithDefault(config)
    expect(viewMatchesConfig(applied, config)).toBe(true)
  })

  it('detects drift once a setting changes', () => {
    const applied = mergeWithDefault(config)
    const drifted = buildViewState({
      ticker: { rsiZone: 'oversold', structure: 'bullish' },
      sort: { key: 'rsi', dir: 'asc' },
    })
    expect(viewMatchesConfig(applied, config)).toBe(true)
    expect(viewMatchesConfig(drifted, config)).toBe(false)
  })

  it('ignores search text — it is never part of a preset', () => {
    const withSearch = mergeWithDefault({ ...config, ticker: { ...config.ticker, search: 'AAPL' } })
    expect(viewMatchesConfig(withSearch, config)).toBe(true)
  })

  it('still matches when the stored config carries stale or unknown keys', () => {
    const applied = mergeWithDefault(config)
    const staleConfig = { ...config, ticker: { rsiZone: 'oversold', removedSetting: 'x' } }
    expect(viewMatchesConfig(applied, staleConfig)).toBe(true)
  })

  it('treats the default view as matching an empty config', () => {
    expect(viewMatchesConfig(DEFAULT_VIEW_STATE, {})).toBe(true)
  })
})
