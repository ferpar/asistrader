import { useAuth } from './context/AuthContext'
import { Layout } from './components/Layout'
import { AuthForm } from './components/AuthForm'
import { TradeDashboard } from './pages'
import './styles/global.css'
import layoutStyles from './components/Layout.module.css'

function App() {
  const { isAuthenticated, isLoading } = useAuth()

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
    <Layout>
      <TradeDashboard />
    </Layout>
  )
}

export default App
