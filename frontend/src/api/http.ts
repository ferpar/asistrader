/**
 * Shared HTTP primitives: a status-carrying error and a fetch that can't hang
 * forever.
 *
 * Both exist for the same reason. Several backend endpoints do external I/O
 * (yfinance) and can take minutes under rate-limiting; a browser `fetch` with
 * no timeout will wait on them indefinitely, and a caller that can't tell
 * "server said no" from "server never answered" will treat the second as the
 * first. On the session-restore path that means logging out a valid user.
 */

/** Anything that isn't obviously slow by nature. */
export const DEFAULT_TIMEOUT_MS = 15_000
/** Price and market-data reads: backed by yfinance, legitimately slow. */
export const MARKET_DATA_TIMEOUT_MS = 30_000
/** Bulk syncs: sequential per-symbol yfinance fetches. Slow by design. */
export const SYNC_TIMEOUT_MS = 120_000

/**
 * An HTTP error that remembers its status code.
 *
 * `status` is null when the request never produced a response at all — offline,
 * DNS failure, or our own timeout.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly timedOut = false,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /** True only when the server actively rejected our credentials. */
  get isAuthFailure(): boolean {
    return this.status === 401
  }

  /**
   * True when we never got an answer. The request may well have succeeded
   * server-side, so callers should not treat this as a negative result.
   */
  get isUnreachable(): boolean {
    return this.status === null || this.status >= 500
  }
}

/** Build an ApiError from a failed Response, preferring the API's `detail`. */
export async function apiErrorFrom(response: Response, fallback: string): Promise<ApiError> {
  const errorData = await response.json().catch(() => ({}))
  return new ApiError(errorData.detail || fallback, response.status)
}

/**
 * `fetch` with a hard deadline.
 *
 * Uses an explicit AbortController rather than `AbortSignal.timeout()` so the
 * timer can be cleared on completion, and so a caller-supplied signal still
 * works. An expired deadline surfaces as an ApiError with `timedOut` set,
 * never as a bare DOMException.
 */
export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (err) {
    if (controller.signal.aborted) {
      throw new ApiError(`Request timed out after ${timeoutMs}ms`, null, true)
    }
    throw new ApiError(err instanceof Error ? err.message : 'Network request failed', null)
  } finally {
    clearTimeout(timer)
  }
}
