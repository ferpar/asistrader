import { ReactNode } from 'react'
import { ThemeToggle } from './ThemeToggle'
import { UserHeader } from './UserHeader'

interface LayoutProps {
  children: ReactNode
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>AsisTrader</h1>
          <p>Trading Operations Management</p>
        </div>
        <div className="header-actions">
          <UserHeader />
          <ThemeToggle />
        </div>
      </header>
      <main className="main">
        {children}
      </main>
    </div>
  )
}
