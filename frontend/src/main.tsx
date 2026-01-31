import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider } from './context/ThemeContext'
import { AuthProvider } from './context/AuthContext'
import { ContainerProvider } from './container/ContainerContext'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <ContainerProvider>
          <App />
        </ContainerProvider>
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>,
)
