import { ReactNode, useState } from 'react'
import type { AppPage } from '../domain/router/RouterStore'
import { ThemeToggle } from './ThemeToggle'
import { UserHeader } from './UserHeader'
import styles from './Layout.module.css'

interface LayoutProps {
  children: ReactNode
  currentPage: AppPage
  onNavigate: (page: AppPage) => void
}

const TABS: ReadonlyArray<{ page: AppPage; label: string }> = [
  { page: 'trades', label: 'Trades' },
  { page: 'fund', label: 'Fund' },
  { page: 'radar', label: 'Radar' },
  { page: 'drivers', label: 'Drivers' },
  { page: 'screening', label: 'Screening' },
  { page: 'detection-sandbox', label: 'Detection' },
]

export function Layout({ children, currentPage, onNavigate }: LayoutProps) {
  const [menuOpen, setMenuOpen] = useState(false)

  const handleNavigate = (page: AppPage) => {
    onNavigate(page)
    setMenuOpen(false)
  }

  return (
    <div className={styles.app}>
      <header className={`${styles.navbar} ${menuOpen ? styles.navbarOpen : ''}`}>
        <div className={styles.brand}>
          <h1>AsisTrader</h1>
          <p>Trading Operations Management</p>
        </div>
        <button
          className={styles.hamburger}
          onClick={() => setMenuOpen((open) => !open)}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
        >
          {menuOpen ? '✕' : '☰'}
        </button>
        <nav className={styles.tabs}>
          {TABS.map(({ page, label }) => (
            <button
              key={page}
              className={`${styles.tab} ${currentPage === page ? styles.tabActive : ''}`}
              onClick={() => handleNavigate(page)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className={styles.userActions}>
          <UserHeader />
          <ThemeToggle />
        </div>
      </header>
      <main className={styles.main}>
        {children}
      </main>
    </div>
  )
}
