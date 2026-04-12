import { useState, useEffect } from 'react'
import { useAuth } from './context/AuthContext'
import { Layout } from './components/Layout'
import { AuthForm } from './components/AuthForm'
import { TradeDashboard, FundDashboard, RadarDashboard } from './pages'
import { useFundStore } from './container/ContainerContext'
import './styles/global.css'
import layoutStyles from './components/Layout.module.css'

export type AppPage = 'trades' | 'fund' | 'radar'

function App() {
  const { isAuthenticated, isLoading } = useAuth()
  const [page, setPage] = useState<AppPage>('trades')
  const fundStore = useFundStore()

  useEffect(() => {
    if (isAuthenticated) {
      fundStore.loadEvents()
      fundStore.loadRiskPct()
    }
  }, [isAuthenticated, fundStore])

  if (isLoading) {
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

  return (
    <Layout currentPage={page} onNavigate={setPage}>
      {page === 'trades' ? <TradeDashboard /> : page === 'fund' ? <FundDashboard /> : <RadarDashboard />}
    </Layout>
  )
}

export default App
