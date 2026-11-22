import { describe, it, expect, beforeEach } from 'vitest'
import { RouterStore, routeFromPath, resolveRoute } from '../RouterStore'

beforeEach(() => {
  window.history.replaceState({}, '', '/')
})

describe('routeFromPath', () => {
  it('resolves known routes', () => {
    expect(routeFromPath('/radar')).toBe('radar')
    expect(routeFromPath('/login')).toBe('login')
  })

  it('resolves the reset password route', () => {
    expect(routeFromPath('/reset-password')).toBe('reset-password')
  })

  it('falls back to the default route for unknown or empty paths', () => {
    expect(routeFromPath('/nonsense')).toBe('trades')
    expect(routeFromPath('/')).toBe('trades')
    expect(routeFromPath('')).toBe('trades')
  })

  it('resolves trading pages by their first segment, ignoring extra segments', () => {
    expect(routeFromPath('/radar/extra/stuff')).toBe('radar')
  })
})

describe('resolveRoute', () => {
  it('resolves the portfolio area root to the Portfolios list', () => {
    expect(resolveRoute('/portfolio')).toEqual({
      key: 'portfolio',
      path: '/portfolio',
      portfolio: { page: 'portfolios', id: null },
    })
  })

  it('resolves Portfolio detail, Baskets list and Basket detail paths', () => {
    expect(resolveRoute('/portfolio/portfolios/5')).toEqual({
      key: 'portfolio',
      path: '/portfolio/portfolios/5',
      portfolio: { page: 'portfolios', id: '5' },
    })
    expect(resolveRoute('/portfolio/baskets')).toEqual({
      key: 'portfolio',
      path: '/portfolio/baskets',
      portfolio: { page: 'baskets', id: null },
    })
    expect(resolveRoute('/portfolio/baskets/12')).toEqual({
      key: 'portfolio',
      path: '/portfolio/baskets/12',
      portfolio: { page: 'baskets', id: '12' },
    })
  })

  it('normalises unknown or over-long portfolio paths to the nearest known page', () => {
    expect(resolveRoute('/portfolio/nonsense').path).toBe('/portfolio')
    expect(resolveRoute('/portfolio/portfolios').path).toBe('/portfolio')
    expect(resolveRoute('/portfolio/baskets/').path).toBe('/portfolio/baskets')
    expect(resolveRoute('/portfolio/baskets/12/extra').path).toBe('/portfolio/baskets/12')
  })
})

describe('RouterStore', () => {
  it('initialises its route from the current URL', () => {
    window.history.replaceState({}, '', '/radar')
    const router = new RouterStore()
    expect(router.route$.get()).toBe('radar')
  })

  it('normalises an unknown path to the default route in the address bar', () => {
    window.history.replaceState({}, '', '/bogus')
    const router = new RouterStore()
    expect(router.route$.get()).toBe('trades')
    expect(window.location.pathname).toBe('/trades')
  })

  it('keeps a nested portfolio path in the address bar on startup (reload)', () => {
    window.history.replaceState({}, '', '/portfolio/baskets/12')
    const router = new RouterStore()
    expect(router.route$.get()).toBe('portfolio')
    expect(router.path$.get()).toBe('/portfolio/baskets/12')
    expect(window.location.pathname).toBe('/portfolio/baskets/12')
  })

  it('keeps the reset token in the URL on startup', () => {
    window.history.replaceState({}, '', '/reset-password#token=abc123')
    const router = new RouterStore()
    expect(router.route$.get()).toBe('reset-password')
    expect(window.location.hash).toBe('#token=abc123')
  })

  it('navigate updates both the route and the URL', () => {
    const router = new RouterStore()
    router.navigate('fund')
    expect(router.route$.get()).toBe('fund')
    expect(window.location.pathname).toBe('/fund')
  })

  it('navigate can reach the login route', () => {
    const router = new RouterStore()
    router.navigate('login')
    expect(router.route$.get()).toBe('login')
    expect(window.location.pathname).toBe('/login')
  })

  it('pushes a history entry per navigation, so back/forward works', () => {
    const router = new RouterStore()
    const before = window.history.length
    router.navigate('radar')
    router.navigate('drivers')
    expect(window.history.length).toBe(before + 2)
  })

  it('syncs the route when the user navigates back/forward (popstate)', () => {
    const router = new RouterStore()
    router.navigate('radar')

    window.history.replaceState({}, '', '/fund')
    window.dispatchEvent(new PopStateEvent('popstate'))

    expect(router.route$.get()).toBe('fund')
  })

  it('navigates to a nested portfolio path, exposing where in the area we are', () => {
    const router = new RouterStore()
    router.navigate('/portfolio/portfolios/5')
    expect(router.route$.get()).toBe('portfolio')
    expect(router.portfolio$.get()).toEqual({ page: 'portfolios', id: '5' })
    expect(window.location.pathname).toBe('/portfolio/portfolios/5')
  })

  it('pushes a history entry when moving between two detail pages of the same area', () => {
    const router = new RouterStore()
    router.navigate('/portfolio/baskets/1')
    const before = window.history.length
    router.navigate('/portfolio/baskets/2')
    expect(window.history.length).toBe(before + 1)
    expect(router.portfolio$.get()).toEqual({ page: 'baskets', id: '2' })
  })

  it('restores the nested portfolio page on back/forward (popstate)', () => {
    const router = new RouterStore()
    router.navigate('/portfolio/baskets/2')

    window.history.replaceState({}, '', '/portfolio/baskets/1')
    window.dispatchEvent(new PopStateEvent('popstate'))

    expect(router.portfolio$.get()).toEqual({ page: 'baskets', id: '1' })
  })

  it('has no portfolio view outside the portfolio area', () => {
    window.history.replaceState({}, '', '/radar')
    const router = new RouterStore()
    expect(router.portfolio$.get()).toBeNull()
  })
})
