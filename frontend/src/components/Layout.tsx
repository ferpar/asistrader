import { ReactNode, useState } from 'react'
import type { NavTarget } from '../domain/router/RouterStore'
import { ThemeToggle } from './ThemeToggle'
import { UserHeader } from './UserHeader'
import styles from './Layout.module.css'

/** The two areas of the app (ADR 0003), each with its own navigation. */
export type Area = 'trading' | 'portfolio'

interface LayoutProps {
  children: ReactNode
  area: Area
  /** The id of the active tab within the area's navigation. */
  activeTab: string
  onNavigate: (target: NavTarget) => void
}

interface Tab {
  id: string
  label: string
  target: NavTarget
}

const AREAS: Record<Area, { label: string; subtitle: string; home: NavTarget; tabs: readonly Tab[] }> = {
  trading: {
    label: 'Trading',
    subtitle: 'Trading Operations Management',
    home: 'trades',
    tabs: [
      { id: 'trades', label: 'Trades', target: 'trades' },
      { id: 'fund', label: 'Fund', target: 'fund' },
      { id: 'radar', label: 'Radar', target: 'radar' },
      { id: 'drivers', label: 'Drivers', target: 'drivers' },
      { id: 'screening', label: 'Screening', target: 'screening' },
      { id: 'detection-sandbox', label: 'Detection', target: 'detection-sandbox' },
      { id: 'strategies', label: 'Strategies', target: 'strategies' },
    ],
  },
  portfolio: {
    label: 'Portfolio',
    subtitle: 'Long-term Portfolios',
    home: '/portfolio',
    tabs: [
      { id: 'portfolios', label: 'Portfolios', target: '/portfolio' },
      { id: 'baskets', label: 'Baskets', target: '/portfolio/baskets' },
    ],
  },
}

const AREA_ORDER: readonly Area[] = ['trading', 'portfolio']

export function Layout({ children, area, activeTab, onNavigate }: LayoutProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const { subtitle, tabs } = AREAS[area]

  const handleNavigate = (target: NavTarget) => {
    onNavigate(target)
    setMenuOpen(false)
  }

  return (
    <div className={styles.app}>
      <header className={`${styles.navbar} ${menuOpen ? styles.navbarOpen : ''}`}>
        <div className={styles.brand}>
          <h1>AsisTrader</h1>
          <p>{subtitle}</p>
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
          {tabs.map(({ id, label, target }) => (
            <button
              key={id}
              className={`${styles.tab} ${activeTab === id ? styles.tabActive : ''}`}
              onClick={() => handleNavigate(target)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className={styles.userActions}>
          <div className={styles.areaSwitcher} role="group" aria-label="Switch area">
            {AREA_ORDER.map((a) => (
              <button
                key={a}
                type="button"
                className={`${styles.areaOption} ${a === area ? styles.areaOptionActive : ''}`}
                aria-pressed={a === area}
                onClick={() => a !== area && handleNavigate(AREAS[a].home)}
              >
                {AREAS[a].label}
              </button>
            ))}
          </div>
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
