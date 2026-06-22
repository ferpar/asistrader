import { useEffect } from 'react'
import { observer } from '@legendapp/state/react'
import { Layout } from './components/Layout'
import { AuthForm } from './components/AuthForm'
import { IndicatorBootstrap } from './components/IndicatorBootstrap'
import { TradeDashboard, FundDashboard, RadarDashboard, DriversDashboard, ScreeningDashboard, DetectionSandbox, StrategyAdmin } from './pages'
import { useAuthStore, useFundStore, useRouterStore, useRadarStore } from './container/ContainerContext'
import { DEFAULT_ROUTE, LOGIN_ROUTE, type AppPage } from './domain/router/RouterStore'
import './styles/global.css'
import layoutStyles from './components/Layout.module.css'

const PAGES: Record<AppPage, JSX.Element> = {
  trades: <TradeDashboard />,
  fund: <FundDashboard />,
  radar: <RadarDashboard />,
  drivers: <DriversDashboard />,
  screening: <ScreeningDashboard />,
  'detection-sandbox': <DetectionSandbox />,
  strategies: <StrategyAdmin />,
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
  const isAuthenticated = authStore.isAuthenticated()
  const userId = authStore.user$.get()?.id ?? null
  const route = routerStore.route$.get()

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
    if (bootstrapping) return
    if (!isAuthenticated && route !== LOGIN_ROUTE) {
      routerStore.intendedRoute = route
      routerStore.navigate(LOGIN_ROUTE)
    } else if (isAuthenticated && route === LOGIN_ROUTE) {
      const target = routerStore.intendedRoute ?? DEFAULT_ROUTE
      routerStore.intendedRoute = null
      routerStore.navigate(target)
    }
  }, [bootstrapping, isAuthenticated, route, routerStore])

  if (bootstrapping) {
    return (
      <div className={layoutStyles.app}>
        <div className={layoutStyles.authLoading}>Loading...</div>
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
  const page: AppPage = route === LOGIN_ROUTE ? routerStore.intendedRoute ?? DEFAULT_ROUTE : route

  return (
    <Layout currentPage={page} onNavigate={(next) => routerStore.navigate(next)}>
      <IndicatorBootstrap />
      {PAGES[page]}
    </Layout>
  )
})

export default App
