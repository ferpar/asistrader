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
    <div className="filter-tabs">
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
  )
}
