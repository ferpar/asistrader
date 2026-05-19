import { describe, it, expect, beforeEach } from 'vitest'
import { RouterStore, routeFromPath } from '../RouterStore'

beforeEach(() => {
  window.history.replaceState({}, '', '/')
})

describe('routeFromPath', () => {
  it('resolves known routes', () => {
    expect(routeFromPath('/radar')).toBe('radar')
    expect(routeFromPath('/login')).toBe('login')
  })

  it('falls back to the default route for unknown or empty paths', () => {
    expect(routeFromPath('/nonsense')).toBe('trades')
    expect(routeFromPath('/')).toBe('trades')
    expect(routeFromPath('')).toBe('trades')
  })

  it('uses only the first path segment', () => {
    expect(routeFromPath('/radar/extra/stuff')).toBe('radar')
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
})
