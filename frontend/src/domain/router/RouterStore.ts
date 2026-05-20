import { observable } from '@legendapp/state'

/** The authenticated pages. */
export type AppPage = 'trades' | 'fund' | 'radar' | 'drivers' | 'detection-sandbox'

/** Every addressable route, including the auth page. */
export type RouteKey = AppPage | 'login'

export const ROUTES: readonly RouteKey[] = ['trades', 'fund', 'radar', 'drivers', 'detection-sandbox', 'login']
// Declared as literal types so `route !== LOGIN_ROUTE` narrows RouteKey to AppPage.
export const DEFAULT_ROUTE = 'trades' as const
export const LOGIN_ROUTE = 'login' as const

/** Resolve a URL pathname to a known route, falling back to the default. */
export function routeFromPath(pathname: string): RouteKey {
  const segment = pathname.replace(/^\/+/, '').split('/')[0]
  return ROUTES.includes(segment as RouteKey) ? (segment as RouteKey) : DEFAULT_ROUTE
}

/**
 * Minimal History-API router as an observable store.
 *
 * It is deliberately **auth-agnostic** — it only maps the URL to a route and
 * back. Auth-aware redirects (sending an anonymous visitor to `/login` and
 * restoring their destination after sign-in) are orchestrated by `App`, which
 * is the one place that already observes both this store and the AuthStore.
 */
export class RouterStore {
  readonly route$ = observable<RouteKey>(routeFromPath(window.location.pathname))

  /**
   * A page a visitor asked for before being bounced to `/login`. `App` stashes
   * it here and consumes it once the visitor authenticates.
   */
  intendedRoute: AppPage | null = null

  constructor() {
    window.addEventListener('popstate', this.handlePopState)
    // Normalise the address bar (e.g. '/' or an unknown path) without adding a
    // history entry for the pre-normalised URL.
    this.replaceUrl(this.route$.get())
  }

  /** Navigate to a route, pushing a new browser history entry. */
  navigate(route: RouteKey): void {
    if (route !== this.route$.get()) {
      this.route$.set(route)
    }
    const target = `/${route}`
    if (window.location.pathname !== target) {
      window.history.pushState({}, '', target)
    }
  }

  private replaceUrl(route: RouteKey): void {
    const target = `/${route}`
    if (window.location.pathname !== target) {
      window.history.replaceState({}, '', target)
    }
  }

  /** Keep the route in sync when the user uses the browser back/forward buttons. */
  private handlePopState = (): void => {
    this.route$.set(routeFromPath(window.location.pathname))
  }
}
