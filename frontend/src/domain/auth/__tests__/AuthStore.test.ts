import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AuthStore } from '../AuthStore'
import type { User } from '../../../types/auth'

vi.mock('../../../api/auth', () => ({
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  refreshToken: vi.fn(),
  getCurrentUser: vi.fn(),
}))

import * as authApi from '../../../api/auth'

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

  it('ends anonymous when a refresh fails', async () => {
    localStorage.setItem('access_token', fakeJwt(-10))
    localStorage.setItem('refresh_token', 'refresh-token')
    api.refreshToken.mockRejectedValue(new Error('refresh failed'))
    const store = new AuthStore()

    await store.init()

    expect(store.user$.get()).toBeNull()
    expect(store.bootstrapping$.get()).toBe(false)
    expect(api.getCurrentUser).not.toHaveBeenCalled()
    expect(localStorage.getItem('access_token')).toBeNull()
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
