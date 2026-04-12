import { ExtendedFilter } from '../types/trade'
import styles from './TradeFilters.module.css'

export type StatusFilter = ExtendedFilter

const FILTER_OPTIONS: StatusFilter[] = ['all', 'plan', 'ordered', 'open', 'winning', 'losing', 'close', 'winners', 'losers', 'canceled']

const FILTER_LABELS: Record<StatusFilter, string> = {
  all: 'All',
  plan: 'Plan',
  ordered: 'Ordered',
  open: 'Open',
  winning: 'Winning',
  losing: 'Losing',
  close: 'Closed',
  canceled: 'Canceled',
  winners: 'Winners',
  losers: 'Losers',
}

interface TradeFiltersProps {
  value: StatusFilter
  onChange: (filter: StatusFilter) => void
}

export function TradeFilters({ value, onChange }: TradeFiltersProps) {
  return (
    <>
      {/* Desktop: button tabs */}
      <div className={`${styles.filterTabs} ${styles.filterTabsDesktop}`}>
        {FILTER_OPTIONS.map((filter) => (
          <button
            key={filter}
            className={`${styles.filterTab} ${value === filter ? styles.active : ''}`}
            onClick={() => onChange(filter)}
          >
            {FILTER_LABELS[filter]}
          </button>
        ))}
      </div>

      {/* Mobile: dropdown select */}
      <div className={`${styles.filterTabs} ${styles.filterTabsMobile}`}>
        <label htmlFor="filter-select" className={styles.filterLabel}>Filter:</label>
        <select
          id="filter-select"
          className={styles.filterSelect}
          value={value}
          onChange={(e) => onChange(e.target.value as StatusFilter)}
        >
          {FILTER_OPTIONS.map((filter) => (
            <option key={filter} value={filter}>
              {FILTER_LABELS[filter]}
            </option>
          ))}
        </select>
      </div>
    </>
  )
}
