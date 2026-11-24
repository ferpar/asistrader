/**
 * The market-data window shared by every page that measures close series
 * (radar tickers, benchmarks, Basket Indexes): how far back to sync and fetch,
 * and how often a page may ask the backend to sync again.
 */

/**
 * Sync/fetch window, in calendar days. 400 covers the 253 trading days the
 * Momentum Score's 1-year return needs, with room for holidays.
 */
const INDICATOR_WINDOW_DAYS = 400

/** Start of the indicator window, as an ISO date. */
export function startDate(): string {
  const d = new Date()
  d.setDate(d.getDate() - INDICATOR_WINDOW_DAYS)
  return d.toISOString().split('T')[0]
}

/** Minimum time between two syncs triggered by the same store. */
export const SYNC_THROTTLE_MS = 5 * 60 * 1000
