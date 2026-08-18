import { observable } from '@legendapp/state'
import type { LoginRequest, RegisterRequest, User } from '../../types/auth'
import * as authApi from '../../api/auth'
import { ApiError } from '../../api/http'
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  isTokenExpired,
  setTokens,
} from '../../utils/tokenStorage'

const REFRESH_CHECK_INTERVAL_MS = 60_000

/**
 * Did the server actually reject our credentials?
 *
 * Only a 401 counts. Timeouts, 5xx, offline browsers, and errors we don't
 * recognise all mean "no answer", not "bad token" — treating them as rejection
 * is what logs out users whose session is perfectly valid.
 */
function isCredentialRejection(err: unknown): boolean {
  return err instanceof ApiError && err.isAuthFailure
}

/**
 * Authentication state as an observable store, so it sits in the app container
 * alongside the other stores and can be consumed without React context.
 *
 * `isAuthenticated()` means the session was fully established (the `/me` call
 * succeeded) — not merely that a token is present.
 *
 * Session-destroying is deliberately narrow: stored tokens are discarded only
 * when the server actively rejects them with a 401. A timeout, a 5xx, or an
 * offline browser leaves the tokens in place and surfaces `bootstrapError$`
 * instead, because none of those tell us the credentials are bad — and
 * throwing them away logs out a user whose session is perfectly fine.
 */
export class AuthStore {
  readonly user$ = observable<User | null>(null)
  /** True until `init()` finishes restoring (or failing to restore) a session. */
  readonly bootstrapping$ = observable(true)
  /**
   * Set when session restore failed for a reason that is *not* bad credentials.
   * Non-null means "we couldn't reach the server", not "you are signed out" —
   * the tokens survive and `retry()` can still recover the session.
   */
  readonly bootstrapError$ = observable<string | null>(null)

  private initialized = false
  private refreshTimer: ReturnType<typeof setInterval> | null = null

  isAuthenticated(): boolean {
    return this.user$.get() !== null
  }

  /** One-time bootstrap: restore a session from stored tokens, if any. */
  async init(): Promise<void> {
    if (this.initialized) return
    this.initialized = true

    await this.restoreSession()
    this.bootstrapping$.set(false)
    this.startRefreshTimer()
  }

  /**
   * Re-attempt a session restore that failed because the server was
   * unreachable. No-op once a session is established, or when the stored
   * tokens are already gone.
   */
  async retry(): Promise<void> {
    if (this.isAuthenticated()) return
    this.bootstrapping$.set(true)
    await this.restoreSession()
    this.bootstrapping$.set(false)
  }

  async login(request: LoginRequest): Promise<void> {
    const response = await authApi.login(request)
    setTokens(response.tokens.access_token, response.tokens.refresh_token)
    this.user$.set(response.user)
    this.bootstrapError$.set(null)
    void this.syncUserData()
  }

  async register(request: RegisterRequest): Promise<void> {
    const response = await authApi.register(request)
    setTokens(response.tokens.access_token, response.tokens.refresh_token)
    this.user$.set(response.user)
    this.bootstrapError$.set(null)
    void this.syncUserData()
  }

  async logout(): Promise<void> {
    const accessToken = getAccessToken()
    const refreshToken = getRefreshToken()
    if (accessToken && refreshToken) {
      try {
        await authApi.logout(accessToken, refreshToken)
      } catch {
        // Ignore logout errors — the local session is cleared regardless.
      }
    }
    clearTokens()
    this.user$.set(null)
    this.bootstrapError$.set(null)
  }

  getAuthHeader(): Record<string, string> {
    const accessToken = getAccessToken()
    return accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
  }

  /** Restore the session from stored tokens. Never throws. */
  private async restoreSession(): Promise<void> {
    const accessToken = getAccessToken()
    const refreshToken = getRefreshToken()
    if (!accessToken || !refreshToken) {
      this.user$.set(null)
      this.bootstrapError$.set(null)
      return
    }

    try {
      if (isTokenExpired(accessToken)) {
        await this.renewAccessToken()
      }
      const currentAccessToken = getAccessToken()
      if (!currentAccessToken) {
        this.user$.set(null)
        return
      }
      this.user$.set(await authApi.getCurrentUser(currentAccessToken))
      this.bootstrapError$.set(null)
      void this.syncUserData()
    } catch (err) {
      this.user$.set(null)
      if (isCredentialRejection(err)) {
        this.endSession()
      } else {
        this.bootstrapError$.set(
          err instanceof Error ? err.message : 'Could not reach the server',
        )
      }
    }
  }

  /** Drop the stored credentials. Only ever called on a confirmed 401. */
  private endSession(): void {
    clearTokens()
    this.user$.set(null)
    this.bootstrapError$.set(null)
  }

  /** Exchange the refresh token for a fresh access token. Throws on failure. */
  private async renewAccessToken(): Promise<void> {
    const refreshToken = getRefreshToken()
    if (!refreshToken) {
      throw new ApiError('No refresh token stored', 401)
    }
    const response = await authApi.refreshToken(refreshToken)
    setTokens(response.access_token, refreshToken)
  }

  /**
   * Fire the server-side market-data refresh. Fire-and-forget: it is slow
   * (external HTTP) and stale prices are never a reason to hold up — or tear
   * down — a session.
   */
  private async syncUserData(): Promise<void> {
    const accessToken = getAccessToken()
    if (!accessToken) return
    try {
      await authApi.bootstrapSync(accessToken)
    } catch {
      // Best effort by design.
    }
  }

  /**
   * Proactively refresh the access token shortly before it expires. The timer
   * runs for the app's lifetime and no-ops while there is no token (logged out).
   */
  private startRefreshTimer(): void {
    if (this.refreshTimer !== null) return
    this.refreshTimer = setInterval(() => {
      const accessToken = getAccessToken()
      if (accessToken && isTokenExpired(accessToken)) {
        void this.renewAccessToken().catch((err) => {
          // Same rule as bootstrap: only a hard 401 ends the session. On a
          // network blip we leave the established session untouched and let
          // the next tick try again, rather than signing the user out.
          if (isCredentialRejection(err)) this.endSession()
        })
      }
    }, REFRESH_CHECK_INTERVAL_MS)
  }
}
