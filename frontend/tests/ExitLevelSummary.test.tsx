import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ExitLevelSummary } from '../src/components/ExitLevelSummary'
import { ExitLevel } from '../src/types/trade'

const mockLevels: ExitLevel[] = [
  {
    id: 1,
    trade_id: 1,
    level_type: 'tp',
    price: 110,
    units_pct: 0.5,
    order_index: 1,
    status: 'hit',
    hit_date: '2025-01-17',
    units_closed: 50,
    move_sl_to_breakeven: true,
  },
  {
    id: 2,
    trade_id: 1,
    level_type: 'tp',
    price: 120,
    units_pct: 0.3,
    order_index: 2,
    status: 'pending',
    hit_date: null,
    units_closed: null,
    move_sl_to_breakeven: false,
  },
]

describe('ExitLevelSummary', () => {
  it('renders TP levels table', () => {
    render(<ExitLevelSummary levels={mockLevels} entryPrice={100} units={100} />)
    expect(screen.getByText('Take Profit Levels')).toBeInTheDocument()
  })

  it('displays level prices', () => {
    render(<ExitLevelSummary levels={mockLevels} entryPrice={100} units={100} />)
    expect(screen.getByText('$110.00')).toBeInTheDocument()
    expect(screen.getByText('$120.00')).toBeInTheDocument()
  })

  it('displays level percentages', () => {
    render(<ExitLevelSummary levels={mockLevels} entryPrice={100} units={100} />)
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText('30%')).toBeInTheDocument()
  })

  it('displays hit status for completed levels', () => {
    render(<ExitLevelSummary levels={mockLevels} entryPrice={100} units={100} />)
    expect(screen.getByText('Hit')).toBeInTheDocument()
    expect(screen.getByText('Pending')).toBeInTheDocument()
  })

  it('displays hit date for completed levels', () => {
    render(<ExitLevelSummary levels={mockLevels} entryPrice={100} units={100} />)
    expect(screen.getByText('2025-01-17')).toBeInTheDocument()
  })

  it('calculates units per level correctly', () => {
    render(<ExitLevelSummary levels={mockLevels} entryPrice={100} units={100} />)
    // 100 * 0.5 = 50 units for TP1, 100 * 0.3 = 30 units for TP2
    expect(screen.getByText('50 units')).toBeInTheDocument()
    expect(screen.getByText('30 units')).toBeInTheDocument()
  })

  it('shows move SL to BE indicator', () => {
    render(<ExitLevelSummary levels={mockLevels} entryPrice={100} units={100} />)
    // TP1 has move_sl_to_breakeven=true, should have at least one BE indicator
    const beElements = screen.getAllByText('BE')
    expect(beElements.length).toBeGreaterThan(0)
  })
})
