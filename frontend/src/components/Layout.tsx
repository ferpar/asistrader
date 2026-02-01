import { ReactNode } from 'react'
import { ThemeToggle } from './ThemeToggle'
import { UserHeader } from './UserHeader'
import styles from './Layout.module.css'

interface LayoutProps {
  children: ReactNode
}

export function Layout({ children }: LayoutProps) {
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
      <main className={styles.main}>
        {children}
      </main>
    </div>
  )
}
