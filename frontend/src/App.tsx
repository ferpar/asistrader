import { useEffect } from 'react'
import { observer } from '@legendapp/state/react'
import { Layout } from './components/Layout'
import { AuthForm } from './components/AuthForm'
import { ResetPasswordForm } from './components/ResetPasswordForm'
import { IndicatorBootstrap } from './components/IndicatorBootstrap'
import { TradeDashboard, FundDashboard, RadarDashboard, DriversDashboard, ScreeningDashboard, DetectionSandbox, StrategyAdmin, PortfoliosPage, BasketsPage } from './pages'
import { useAuthStore, useFundStore, useRouterStore, useRadarStore } from './container/ContainerContext'
import {
  DEFAULT_ROUTE,
  LOGIN_ROUTE,
  PORTFOLIO_ROUTE,
  RESET_PASSWORD_ROUTE,
  resolveRoute,
  type NavTarget,
  type PortfolioView,
  type TradingPage,
} from './domain/router/RouterStore'
import './styles/global.css'
import layoutStyles from './components/Layout.module.css'

const TRADING_PAGES: Record<TradingPage, JSX.Element> = {
  trades: <TradeDashboard />,
  fund: <FundDashboard />,
  radar: <RadarDashboard />,
  drivers: <DriversDashboard />,
  screening: <ScreeningDashboard />,
  'detection-sandbox': <DetectionSandbox />,
  strategies: <StrategyAdmin />,
}

function PortfolioAreaPage({ view }: { view: PortfolioView }) {
  return view.page === 'baskets' ? <BasketsPage basketId={view.id} /> : <PortfoliosPage portfolioId={view.id} />
}

/**
 * Root component and the single auth+router orchestrator: it observes both
 * stores and decides what to render. The RouterStore stays auth-agnostic, so
 * the redirect rules (bounce anonymous visitors to `/login`, restore their
 * intended page after sign-in) live here.
 */
const App = observer(function App() {
  const authStore = useAuthStore()
  const routerStore = useRouterStore()
  const fundStore = useFundStore()
  const radarStore = useRadarStore()

  const bootstrapping = authStore.bootstrapping$.get()
  const bootstrapError = authStore.bootstrapError$.get()
  const isAuthenticated = authStore.isAuthenticated()
  const userId = authStore.user$.get()?.id ?? null
  const route = routerStore.route$.get()
  const path = routerStore.path$.get()

  useEffect(() => {
    authStore.init()
  }, [authStore])

  // Scope the radar favorites to the signed-in account so they never leak across
  // accounts on a shared browser (clears on logout).
  useEffect(() => {
    radarStore.scopeToUser(userId)
  }, [userId, radarStore])

  useEffect(() => {
    if (isAuthenticated) {
      fundStore.loadSettings().then(() => fundStore.loadEvents())
    }
  }, [isAuthenticated, fundStore])

  // Keep the URL in step with the auth state. Rendering below never depends on
  // this having run — it only corrects the address bar.
  useEffect(() => {
    if (bootstrapping || route === RESET_PASSWORD_ROUTE) return
    if (!isAuthenticated && route !== LOGIN_ROUTE) {
      // Stash the full path, so deep links such as a Basket detail page survive sign-in.
      routerStore.intendedPath = path
      routerStore.navigate(LOGIN_ROUTE)
    } else if (isAuthenticated && route === LOGIN_ROUTE) {
      const target = routerStore.intendedPath ?? DEFAULT_ROUTE
      routerStore.intendedPath = null
      routerStore.navigate(target)
    }
  }, [bootstrapping, isAuthenticated, route, path, routerStore])

  // Reset links work the same for anonymous visitors, a browser signed in to
  // another account, or a failed session restore, so this comes before all of
  // the auth states below.
  if (route === RESET_PASSWORD_ROUTE) {
    return (
      <div className={layoutStyles.app}>
        <ResetPasswordForm />
      </div>
    )
  }

  if (bootstrapping) {
    return (
      <div className={layoutStyles.app}>
        <div className={layoutStyles.authLoading}>Loading...</div>
      </div>
    )
  }

  // Restore failed, but not because the credentials were rejected — the stored
  // tokens are still there and probably still good. Showing the sign-in form
  // here would read as "you've been logged out" for what is really a server
  // that didn't answer, so offer a retry instead.
  if (!isAuthenticated && bootstrapError) {
    return (
      <div className={layoutStyles.app}>
        <div className={layoutStyles.authUnreachable}>
          <p className={layoutStyles.authUnreachableTitle}>Can't reach the server</p>
          <p className={layoutStyles.authUnreachableDetail}>{bootstrapError}</p>
          <button type="button" onClick={() => void authStore.retry()}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className={layoutStyles.app}>
        <AuthForm />
      </div>
    )
  }

  // Authenticated. While `route` is briefly `login` (just after sign-in, before
  // the effect above redirects) fall back to the intended page or the default.
  const current = resolveRoute(route === LOGIN_ROUTE ? routerStore.intendedPath ?? DEFAULT_ROUTE : path)
  const navigate = (next: NavTarget) => routerStore.navigate(next)

  // IndicatorBootstrap stays mounted in both areas: portfolio pages need the
  // tickers and indicators too.
  if (current.key === PORTFOLIO_ROUTE) {
    return (
      <Layout area="portfolio" activeTab={current.portfolio.page} onNavigate={navigate}>
        <IndicatorBootstrap />
        <PortfolioAreaPage view={current.portfolio} />
      </Layout>
    )
  }

  const page: TradingPage =
    current.key === LOGIN_ROUTE || current.key === RESET_PASSWORD_ROUTE ? DEFAULT_ROUTE : current.key

  return (
    <Layout area="trading" activeTab={page} onNavigate={navigate}>
      <IndicatorBootstrap />
      {TRADING_PAGES[page]}
    </Layout>
  )
})

export default App
