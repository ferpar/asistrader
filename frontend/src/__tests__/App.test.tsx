import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { observable } from '@legendapp/state'
import App from '../App'
import { RouterStore } from '../domain/router/RouterStore'

const stores = vi.hoisted(() => ({
  auth: null as unknown as Record<string, unknown>,
  router: null as unknown,
  signIn: (() => {}) as () => void,
}))

vi.mock('../container/ContainerContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../container/ContainerContext')>()),
  useAuthStore: () => stores.auth,
  useRouterStore: () => stores.router,
  useFundStore: () => ({ loadSettings: vi.fn().mockResolvedValue(undefined), loadEvents: vi.fn() }),
  useRadarStore: () => ({ scopeToUser: vi.fn() }),
}))

// The authenticated tree is stubbed down to the shell: these tests are about
// which route App lands on, not about the pages themselves.
vi.mock('../components/IndicatorBootstrap', () => ({ IndicatorBootstrap: () => null }))
vi.mock('../components/ThemeToggle', () => ({ ThemeToggle: () => null }))
vi.mock('../pages', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pages')>()),
  TradeDashboard: () => <div>Trades page</div>,
}))

function setUp(path: string, auth: { bootstrapping?: boolean; bootstrapError?: string | null } = {}) {
  window.history.replaceState({}, '', path)
  const user$ = observable<{ id: number } | null>(null)
  stores.signIn = () => user$.set({ id: 1 })
  stores.auth = {
    bootstrapping$: observable(auth.bootstrapping ?? false),
    bootstrapError$: observable(auth.bootstrapError ?? null),
    user$,
    isAuthenticated: () => user$.get() !== null,
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

describe('App auth redirects', () => {
  it('returns to the nested page asked for once the visitor signs in', async () => {
    setUp('/portfolio/baskets/12')
    render(<App />)
    await waitFor(() => expect(window.location.pathname).toBe('/login'))

    act(() => stores.signIn())

    await waitFor(() => expect(window.location.pathname).toBe('/portfolio/baskets/12'))
    expect(screen.getByRole('heading', { name: 'Basket 12' })).toBeInTheDocument()
  })

  it('lands on the default page after sign-in when nothing was asked for', async () => {
    setUp('/login')
    render(<App />)

    act(() => stores.signIn())

    await waitFor(() => expect(window.location.pathname).toBe('/trades'))
    expect(screen.getByText('Trades page')).toBeInTheDocument()
  })
})
