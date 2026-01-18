import { TradeStatus } from '../types/trade'

export type StatusFilter = 'all' | TradeStatus

const FILTER_OPTIONS: StatusFilter[] = ['all', 'plan', 'open', 'close']

interface TradeFiltersProps {
  value: StatusFilter
  onChange: (filter: StatusFilter) => void
}

export function TradeFilters({ value, onChange }: TradeFiltersProps) {
  return (
    <div className="filter-tabs">
      {FILTER_OPTIONS.map((filter) => (
        <button
          key={filter}
          className={`filter-tab ${value === filter ? 'active' : ''}`}
          onClick={() => onChange(filter)}
        >
          {filter.charAt(0).toUpperCase() + filter.slice(1)}
        </button>
      ))}
    </div>
  )
}
