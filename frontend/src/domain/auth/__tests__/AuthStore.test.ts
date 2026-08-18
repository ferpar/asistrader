import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AuthStore } from '../AuthStore'
import type { User } from '../../../types/auth'

vi.mock('../../../api/auth', () => ({
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  refreshToken: vi.fn(),
  getCurrentUser: vi.fn(),
  bootstrapSync: vi.fn(),
}))

import * as authApi from '../../../api/auth'
import { ApiError } from '../../../api/http'

const api = vi.mocked(authApi)

const USER: User = { id: 1, email: 'trader@example.com', is_active: true, created_at: null }

/** A token whose JWT payload expires `seconds` from now. */
function fakeJwt(seconds: number): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + seconds }))
  return `header.${payload}.signature`
}

const tokens = (access: string, refresh = 'refresh-token') => ({
  access_token: access,
  refresh_token: refresh,
})

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  api.bootstrapSync.mockResolvedValue({ errors: {} })
})

describe('AuthStore login / register', () => {
  it('stores the user and tokens on login', async () => {
    api.login.mockResolvedValue({ user: USER, tokens: tokens('access-token') })
    const store = new AuthStore()

    await store.login({ email: USER.email, password: 'pw' })

    expect(store.user$.get()).toEqual(USER)
    expect(store.isAuthenticated()).toBe(true)
    expect(localStorage.getItem('access_token')).toBe('access-token')
    expect(localStorage.getItem('refresh_token')).toBe('refresh-token')
  })

  it('leaves the store anonymous when login fails', async () => {
    api.login.mockRejectedValue(new Error('Invalid email or password'))
    const store = new AuthStore()

    await expect(store.login({ email: 'x', password: 'y' })).rejects.toThrow(
      'Invalid email or password',
    )
    expect(store.user$.get()).toBeNull()
    expect(store.isAuthenticated()).toBe(false)
  })

  it('stores the user and tokens on register', async () => {
    api.register.mockResolvedValue({ user: USER, tokens: tokens('access-token') })
    const store = new AuthStore()

    await store.register({ email: USER.email, password: 'pw' })

    expect(store.user$.get()).toEqual(USER)
    expect(localStorage.getItem('access_token')).toBe('access-token')
  })
})

describe('AuthStore logout', () => {
  it('clears the user and tokens', async () => {
    api.login.mockResolvedValue({ user: USER, tokens: tokens('access-token') })
    api.logout.mockResolvedValue(undefined)
    const store = new AuthStore()
    await store.login({ email: USER.email, password: 'pw' })

    await store.logout()

    expect(api.logout).toHaveBeenCalledWith('access-token', 'refresh-token')
    expect(store.user$.get()).toBeNull()
    expect(localStorage.getItem('access_token')).toBeNull()
  })

  it('still clears local state when the logout request fails', async () => {
    api.login.mockResolvedValue({ user: USER, tokens: tokens('access-token') })
    api.logout.mockRejectedValue(new Error('network down'))
    const store = new AuthStore()
    await store.login({ email: USER.email, password: 'pw' })

    await store.logout()

    expect(store.user$.get()).toBeNull()
    expect(localStorage.getItem('refresh_token')).toBeNull()
  })
})

describe('AuthStore init (bootstrap)', () => {
  it('stays anonymous when there are no stored tokens', async () => {
    const store = new AuthStore()
    expect(store.bootstrapping$.get()).toBe(true)

    await store.init()

    expect(store.bootstrapping$.get()).toBe(false)
    expect(store.user$.get()).toBeNull()
    expect(api.getCurrentUser).not.toHaveBeenCalled()
  })

  it('restores the session from a valid stored token', async () => {
    localStorage.setItem('access_token', fakeJwt(3600))
    localStorage.setItem('refresh_token', 'refresh-token')
    api.getCurrentUser.mockResolvedValue(USER)
    const store = new AuthStore()

    await store.init()

    expect(api.getCurrentUser).toHaveBeenCalledOnce()
    expect(store.user$.get()).toEqual(USER)
    expect(store.bootstrapping$.get()).toBe(false)
  })

  it('refreshes an expired access token before fetching the user', async () => {
    localStorage.setItem('access_token', fakeJwt(-10))
    localStorage.setItem('refresh_token', 'refresh-token')
    api.refreshToken.mockResolvedValue({ access_token: fakeJwt(3600) })
    api.getCurrentUser.mockResolvedValue(USER)
    const store = new AuthStore()

    await store.init()

    expect(api.refreshToken).toHaveBeenCalledWith('refresh-token')
    expect(store.user$.get()).toEqual(USER)
  })

  it('discards the session when the refresh token is rejected with a 401', async () => {
    localStorage.setItem('access_token', fakeJwt(-10))
    localStorage.setItem('refresh_token', 'refresh-token')
    api.refreshToken.mockRejectedValue(new ApiError('Invalid refresh token', 401))
    const store = new AuthStore()

    await store.init()

    expect(store.user$.get()).toBeNull()
    expect(store.bootstrapping$.get()).toBe(false)
    expect(api.getCurrentUser).not.toHaveBeenCalled()
    expect(localStorage.getItem('access_token')).toBeNull()
    expect(store.bootstrapError$.get()).toBeNull()
  })

  it('runs the bootstrap only once', async () => {
    localStorage.setItem('access_token', fakeJwt(3600))
    localStorage.setItem('refresh_token', 'refresh-token')
    api.getCurrentUser.mockResolvedValue(USER)
    const store = new AuthStore()

    await store.init()
    await store.init()

    expect(api.getCurrentUser).toHaveBeenCalledOnce()
  })
})


describe('AuthStore does not sign out on server trouble', () => {
  const UNREACHABLE: [string, ApiError][] = [
    ['a timeout', new ApiError('Request timed out after 15000ms', null, true)],
    ['a 500', new ApiError('Internal Server Error', 500)],
    ['a 504 from a proxy', new ApiError('Gateway Timeout', 504)],
  ]

  it.each(UNREACHABLE)('keeps the tokens when /me fails with %s', async (_label, err) => {
    localStorage.setItem('access_token', fakeJwt(3600))
    localStorage.setItem('refresh_token', 'refresh-token')
    api.getCurrentUser.mockRejectedValue(err)
    const store = new AuthStore()

    await store.init()

    expect(localStorage.getItem('access_token')).not.toBeNull()
    expect(localStorage.getItem('refresh_token')).toBe('refresh-token')
    expect(store.bootstrapError$.get()).toBe(err.message)
    expect(store.isAuthenticated()).toBe(false)
    expect(store.bootstrapping$.get()).toBe(false)
  })

  it('clears the tokens when /me returns a real 401', async () => {
    localStorage.setItem('access_token', fakeJwt(3600))
    localStorage.setItem('refresh_token', 'refresh-token')
    api.getCurrentUser.mockRejectedValue(new ApiError('Token has expired', 401))
    const store = new AuthStore()

    await store.init()

    expect(localStorage.getItem('access_token')).toBeNull()
    expect(store.bootstrapError$.get()).toBeNull()
    expect(store.isAuthenticated()).toBe(false)
  })

  it('treats an unrecognised error as unreachable rather than as a rejection', async () => {
    localStorage.setItem('access_token', fakeJwt(3600))
    localStorage.setItem('refresh_token', 'refresh-token')
    api.getCurrentUser.mockRejectedValue(new TypeError('Failed to fetch'))
    const store = new AuthStore()

    await store.init()

    expect(localStorage.getItem('access_token')).not.toBeNull()
    expect(store.bootstrapError$.get()).toBe('Failed to fetch')
  })

  it('retry() recovers the session once the server comes back', async () => {
    localStorage.setItem('access_token', fakeJwt(3600))
    localStorage.setItem('refresh_token', 'refresh-token')
    api.getCurrentUser.mockRejectedValueOnce(new ApiError('Gateway Timeout', 504))
    const store = new AuthStore()

    await store.init()
    expect(store.isAuthenticated()).toBe(false)

    api.getCurrentUser.mockResolvedValue(USER)
    await store.retry()

    expect(store.user$.get()).toEqual(USER)
    expect(store.bootstrapError$.get()).toBeNull()
    expect(store.bootstrapping$.get()).toBe(false)
  })

  it('retry() is a no-op once a session is established', async () => {
    localStorage.setItem('access_token', fakeJwt(3600))
    localStorage.setItem('refresh_token', 'refresh-token')
    api.getCurrentUser.mockResolvedValue(USER)
    const store = new AuthStore()
    await store.init()

    await store.retry()

    expect(api.getCurrentUser).toHaveBeenCalledOnce()
  })
})

describe('AuthStore bootstrap sync', () => {
  it('fires the data sync after a successful restore, without blocking it', async () => {
    localStorage.setItem('access_token', fakeJwt(3600))
    localStorage.setItem('refresh_token', 'refresh-token')
    api.getCurrentUser.mockResolvedValue(USER)
    const store = new AuthStore()

    await store.init()

    expect(store.user$.get()).toEqual(USER)
    expect(api.bootstrapSync).toHaveBeenCalledWith(localStorage.getItem('access_token'))
  })

  it('fires the data sync after login', async () => {
    api.login.mockResolvedValue({ user: USER, tokens: tokens('access-token') })
    const store = new AuthStore()

    await store.login({ email: USER.email, password: 'pw' })

    expect(api.bootstrapSync).toHaveBeenCalledWith('access-token')
  })

  it('a failing data sync never disturbs the session', async () => {
    localStorage.setItem('access_token', fakeJwt(3600))
    localStorage.setItem('refresh_token', 'refresh-token')
    api.getCurrentUser.mockResolvedValue(USER)
    api.bootstrapSync.mockRejectedValue(new ApiError('Request timed out', null, true))
    const store = new AuthStore()

    await store.init()
    await Promise.resolve()

    expect(store.isAuthenticated()).toBe(true)
    expect(store.bootstrapError$.get()).toBeNull()
    expect(localStorage.getItem('access_token')).not.toBeNull()
  })
})
