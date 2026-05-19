import { observable } from '@legendapp/state'
import type { LoginRequest, RegisterRequest, User } from '../../types/auth'
import * as authApi from '../../api/auth'
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  isTokenExpired,
  setTokens,
} from '../../utils/tokenStorage'

const REFRESH_CHECK_INTERVAL_MS = 60_000

/**
 * Authentication state as an observable store, so it sits in the app container
 * alongside the other stores and can be consumed without React context.
 *
 * `isAuthenticated()` means the session was fully established (the `/me` call
 * succeeded) — not merely that a token is present — preserving the behaviour
 * of the React context this store replaced.
 */
export class AuthStore {
  readonly user$ = observable<User | null>(null)
  /** True until `init()` finishes restoring (or failing to restore) a session. */
  readonly bootstrapping$ = observable(true)

  private initialized = false
  private refreshTimer: ReturnType<typeof setInterval> | null = null

  isAuthenticated(): boolean {
    return this.user$.get() !== null
  }

  /** One-time bootstrap: restore a session from stored tokens, if any. */
  async init(): Promise<void> {
    if (this.initialized) return
    this.initialized = true

    try {
      const accessToken = getAccessToken()
      const refreshToken = getRefreshToken()
      if (!accessToken || !refreshToken) return

      if (isTokenExpired(accessToken) && !(await this.refreshAccessToken())) return

      const currentAccessToken = getAccessToken()
      if (currentAccessToken) {
        this.user$.set(await authApi.getCurrentUser(currentAccessToken))
      }
    } catch {
      clearTokens()
      this.user$.set(null)
    } finally {
      this.bootstrapping$.set(false)
      this.startRefreshTimer()
    }
  }

  async login(request: LoginRequest): Promise<void> {
    const response = await authApi.login(request)
    setTokens(response.tokens.access_token, response.tokens.refresh_token)
    this.user$.set(response.user)
  }

  async register(request: RegisterRequest): Promise<void> {
    const response = await authApi.register(request)
    setTokens(response.tokens.access_token, response.tokens.refresh_token)
    this.user$.set(response.user)
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
  }

  getAuthHeader(): Record<string, string> {
    const accessToken = getAccessToken()
    return accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
  }

  /** Exchange the refresh token for a fresh access token. */
  private async refreshAccessToken(): Promise<boolean> {
    const refreshToken = getRefreshToken()
    if (!refreshToken) return false
    try {
      const response = await authApi.refreshToken(refreshToken)
      setTokens(response.access_token, refreshToken)
      return true
    } catch {
      clearTokens()
      this.user$.set(null)
      return false
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
        void this.refreshAccessToken()
      }
    }, REFRESH_CHECK_INTERVAL_MS)
  }
}
