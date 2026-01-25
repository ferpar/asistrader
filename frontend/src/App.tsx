import { useAuth } from './context/AuthContext'
import { Layout } from './components/Layout'
import { AuthForm } from './components/AuthForm'
import { TradeDashboard } from './pages'
import './App.css'

function App() {
  const { isAuthenticated, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="app">
        <div className="auth-loading">Loading...</div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="app">
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
