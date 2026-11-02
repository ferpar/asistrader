import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { observable } from '@legendapp/state'
import App from '../App'
import { RouterStore } from '../domain/router/RouterStore'

const stores = vi.hoisted(() => ({
  auth: null as unknown as Record<string, unknown>,
  router: null as unknown,
}))

vi.mock('../container/ContainerContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../container/ContainerContext')>()),
  useAuthStore: () => stores.auth,
  useRouterStore: () => stores.router,
  useFundStore: () => ({ loadSettings: vi.fn().mockResolvedValue(undefined), loadEvents: vi.fn() }),
  useRadarStore: () => ({ scopeToUser: vi.fn() }),
}))

function setUp(path: string, auth: { bootstrapping?: boolean; bootstrapError?: string | null } = {}) {
  window.history.replaceState({}, '', path)
  stores.auth = {
    bootstrapping$: observable(auth.bootstrapping ?? false),
    bootstrapError$: observable(auth.bootstrapError ?? null),
    user$: observable(null),
    isAuthenticated: () => false,
    init: vi.fn(),
    logout: vi.fn(),
  }
  stores.router = new RouterStore()
}

beforeEach(() => {
  window.history.replaceState({}, '', '/')
})

describe('App reset password route', () => {
  it('shows the reset form to anonymous visitors instead of redirecting to login', async () => {
    setUp('/reset-password#token=abc123')
    render(<App />)

    expect(screen.getByText('Set a New Password')).toBeInTheDocument()
    await waitFor(() => expect(window.location.pathname).toBe('/reset-password'))
  })

  it('shows the reset form while the session is restoring', () => {
    setUp('/reset-password#token=abc123', { bootstrapping: true })
    render(<App />)

    expect(screen.getByText('Set a New Password')).toBeInTheDocument()
  })

  it('shows the reset form when session restore could not reach the server', () => {
    setUp('/reset-password#token=abc123', { bootstrapError: 'Server unreachable' })
    render(<App />)

    expect(screen.getByText('Set a New Password')).toBeInTheDocument()
  })

  it('still sends anonymous visitors on other pages to login', async () => {
    setUp('/trades')
    render(<App />)

    await waitFor(() => expect(window.location.pathname).toBe('/login'))
  })
})
