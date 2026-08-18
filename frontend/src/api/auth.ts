import { AuthResponse, LoginRequest, RefreshResponse, RegisterRequest, User } from '../types/auth'
import { apiErrorFrom, fetchWithTimeout, SYNC_TIMEOUT_MS } from './http'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

const jsonHeaders = { 'Content-Type': 'application/json' }

const bearer = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` })

export async function login(request: LoginRequest): Promise<AuthResponse> {
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(request),
  })
  if (!response.ok) {
    throw await apiErrorFrom(response, 'Invalid email or password')
  }
  return response.json()
}

export async function register(request: RegisterRequest): Promise<AuthResponse> {
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(request),
  })
  if (!response.ok) {
    throw await apiErrorFrom(response, 'Registration failed')
  }
  return response.json()
}

export async function refreshToken(refresh_token: string): Promise<RefreshResponse> {
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ refresh_token }),
  })
  if (!response.ok) {
    throw await apiErrorFrom(response, 'Token refresh failed')
  }
  return response.json()
}

export async function logout(accessToken: string, refreshToken: string): Promise<void> {
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/auth/logout`, {
    method: 'POST',
    headers: { ...jsonHeaders, ...bearer(accessToken) },
    body: JSON.stringify({ refresh_token: refreshToken }),
  })
  if (!response.ok) {
    throw await apiErrorFrom(response, 'Logout failed')
  }
}

export async function getCurrentUser(accessToken: string): Promise<User> {
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/auth/me`, {
    method: 'GET',
    headers: bearer(accessToken),
  })
  if (!response.ok) {
    throw await apiErrorFrom(response, 'Failed to get user')
  }
  return response.json()
}

/**
 * Kick off the server-side refresh of the user's FX rates and market data.
 *
 * Split out of `/me` so session restore never waits on yfinance — this call is
 * slow by nature and fired fire-and-forget once the session is established.
 */
export async function bootstrapSync(accessToken: string): Promise<{ errors: Record<string, string> }> {
  const response = await fetchWithTimeout(
    `${API_BASE_URL}/api/auth/bootstrap-sync`,
    { method: 'POST', headers: bearer(accessToken) },
    SYNC_TIMEOUT_MS,
  )
  if (!response.ok) {
    throw await apiErrorFrom(response, 'Bootstrap sync failed')
  }
  return response.json()
}
