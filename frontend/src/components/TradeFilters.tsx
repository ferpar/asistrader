import { ExtendedFilter } from '../types/trade'

export type StatusFilter = ExtendedFilter

const FILTER_OPTIONS: StatusFilter[] = ['all', 'plan', 'open', 'close', 'winners', 'losers']

const FILTER_LABELS: Record<StatusFilter, string> = {
  all: 'All',
  plan: 'Plan',
  open: 'Open',
  close: 'Closed',
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
      <div className="filter-tabs filter-tabs-desktop">
        {FILTER_OPTIONS.map((filter) => (
          <button
            key={filter}
            className={`filter-tab ${value === filter ? 'active' : ''}`}
            onClick={() => onChange(filter)}
          >
            {FILTER_LABELS[filter]}
          </button>
        ))}
      </div>

      {/* Mobile: dropdown select */}
      <div className="filter-tabs filter-tabs-mobile">
        <label htmlFor="filter-select" className="filter-label">Filter:</label>
        <select
          id="filter-select"
          className="filter-select"
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
