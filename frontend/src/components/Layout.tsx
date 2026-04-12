import { ReactNode } from 'react'
import type { AppPage } from '../App'
import { ThemeToggle } from './ThemeToggle'
import { UserHeader } from './UserHeader'
import styles from './Layout.module.css'

interface LayoutProps {
  children: ReactNode
  currentPage: AppPage
  onNavigate: (page: AppPage) => void
}

export function Layout({ children, currentPage, onNavigate }: LayoutProps) {
  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div>
          <h1>AsisTrader</h1>
          <p>Trading Operations Management</p>
        </div>
        <div className={styles.headerActions}>
          <UserHeader />
          <ThemeToggle />
        </div>
      </header>
      <nav className={styles.nav}>
        <button
          className={`${styles.navTab} ${currentPage === 'trades' ? styles.navTabActive : ''}`}
          onClick={() => onNavigate('trades')}
        >
          Trades
        </button>
        <button
          className={`${styles.navTab} ${currentPage === 'fund' ? styles.navTabActive : ''}`}
          onClick={() => onNavigate('fund')}
        >
          Fund
        </button>
        <button
          className={`${styles.navTab} ${currentPage === 'radar' ? styles.navTabActive : ''}`}
          onClick={() => onNavigate('radar')}
        >
          Radar
        </button>
      </nav>
      <main className={styles.main}>
        {children}
      </main>
    </div>
  )
}
