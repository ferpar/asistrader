import { computed, observable } from '@legendapp/state'

/** The pages of the trading area. */
export type TradingPage = 'trades' | 'fund' | 'radar' | 'drivers' | 'screening' | 'detection-sandbox' | 'strategies'

/** The authenticated top-level routes: every trading page plus the portfolio area. */
export type AppPage = TradingPage | 'portfolio'

/** Every addressable top-level route, including the auth pages. */
export type RouteKey = AppPage | 'login' | 'reset-password'

export const ROUTES: readonly RouteKey[] = ['trades', 'fund', 'radar', 'drivers', 'screening', 'detection-sandbox', 'strategies', 'portfolio', 'login', 'reset-password']

/** An absolute URL pathname. */
export type Path = `/${string}`

/** Something `navigate` accepts: a top-level route key or a full path. */
export type NavTarget = RouteKey | Path

/** The pages of the portfolio area (`/portfolio/*`). */
export type PortfolioPage = 'portfolios' | 'baskets'

/**
 * Where in the portfolio area a URL points: a list page (`id: null`) or the
 * detail page of one Portfolio / Basket.
 */
export interface PortfolioView {
  page: PortfolioPage
  id: string | null
}

/**
 * A URL resolved to a known place in the app. `path` is its canonical
 * pathname; `portfolio` is set only inside the portfolio area.
 */
export type Route =
  | { key: Exclude<RouteKey, 'portfolio'>; path: Path; portfolio: null }
  | { key: 'portfolio'; path: Path; portfolio: PortfolioView }

// Declared as literal types so comparing against them narrows RouteKey to AppPage.
export const DEFAULT_ROUTE = 'trades' as const
export const LOGIN_ROUTE = 'login' as const
export const RESET_PASSWORD_ROUTE = 'reset-password' as const
export const PORTFOLIO_ROUTE = 'portfolio' as const

/** Resolve a URL pathname to a known route, falling back to the default. */
export function resolveRoute(pathname: string): Route {
  const [first, ...rest] = pathname.split('/').filter(Boolean)
  const key: RouteKey = ROUTES.includes(first as RouteKey) ? (first as RouteKey) : DEFAULT_ROUTE
  if (key !== PORTFOLIO_ROUTE) {
    return { key, path: `/${key}`, portfolio: null }
  }
  const [page, id] = rest
  if (page === 'baskets') {
    return id
      ? { key, path: `/portfolio/baskets/${id}`, portfolio: { page, id } }
      : { key, path: '/portfolio/baskets', portfolio: { page, id: null } }
  }
  if (page === 'portfolios' && id) {
    return { key, path: `/portfolio/portfolios/${id}`, portfolio: { page, id } }
  }
  return { key, path: '/portfolio', portfolio: { page: 'portfolios', id: null } }
}

/** Resolve a URL pathname to its top-level route key. */
export function routeFromPath(pathname: string): RouteKey {
  return resolveRoute(pathname).key
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
  /** The canonical pathname of the current route; the single source of truth. */
  readonly path$ = observable<Path>(resolveRoute(window.location.pathname).path)

  /** The current top-level route key. */
  readonly route$ = computed<RouteKey>(() => resolveRoute(this.path$.get()).key)

  /** Where in the portfolio area we are, or null outside it. */
  readonly portfolio$ = computed<PortfolioView | null>(() => resolveRoute(this.path$.get()).portfolio)

  /**
   * A path a visitor asked for before being bounced to `/login`. `App` stashes
   * it here and consumes it once the visitor authenticates.
   */
  intendedPath: Path | null = null

  constructor() {
    window.addEventListener('popstate', this.handlePopState)
    // Normalise the address bar (e.g. '/' or an unknown path) without adding a
    // history entry for the pre-normalised URL. A URL that is already canonical
    // is left untouched, so its hash (the reset token) survives.
    this.replaceUrl(this.path$.get())
  }

  /**
   * Navigate to a route key (`'fund'`) or a path (`'/portfolio/baskets/12'`),
   * pushing a new browser history entry.
   */
  navigate(target: NavTarget): void {
    const path = resolveRoute(target.startsWith('/') ? target : `/${target}`).path
    if (path !== this.path$.get()) {
      this.path$.set(path)
    }
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path)
    }
  }

  private replaceUrl(path: Path): void {
    if (window.location.pathname !== path) {
      window.history.replaceState({}, '', path)
    }
  }

  /** Keep the route in sync when the user uses the browser back/forward buttons. */
  private handlePopState = (): void => {
    this.path$.set(resolveRoute(window.location.pathname).path)
  }
}
