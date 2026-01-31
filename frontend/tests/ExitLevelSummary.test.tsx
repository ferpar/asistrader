import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Decimal } from '../src/domain/shared/Decimal'
import { ExitLevelSummary } from '../src/components/ExitLevelSummary'
import type { ExitLevel } from '../src/domain/trade/types'

const mockLevels: ExitLevel[] = [
  {
    id: 1,
    tradeId: 1,
    levelType: 'tp',
    price: Decimal.from(110),
    unitsPct: Decimal.from(0.5),
    orderIndex: 1,
    status: 'hit',
    hitDate: new Date('2025-01-17'),
    unitsClosed: 50,
    moveSlToBreakeven: true,
  },
  {
    id: 2,
    tradeId: 1,
    levelType: 'tp',
    price: Decimal.from(120),
    unitsPct: Decimal.from(0.3),
    orderIndex: 2,
    status: 'pending',
    hitDate: null,
    unitsClosed: null,
    moveSlToBreakeven: false,
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
    // Date is rendered via toLocaleDateString(), check it's present
    const hitDate = new Date('2025-01-17').toLocaleDateString()
    expect(screen.getByText(hitDate)).toBeInTheDocument()
  })

  it('calculates units per level correctly', () => {
    render(<ExitLevelSummary levels={mockLevels} entryPrice={100} units={100} />)
    // 100 * 0.5 = 50 units for TP1, 100 * 0.3 = 30 units for TP2
    expect(screen.getByText('50 units')).toBeInTheDocument()
    expect(screen.getByText('30 units')).toBeInTheDocument()
  })

  it('shows move SL to BE indicator', () => {
    render(<ExitLevelSummary levels={mockLevels} entryPrice={100} units={100} />)
    // TP1 has moveSlToBreakeven=true, should have at least one BE indicator
    const beElements = screen.getAllByText('BE')
    expect(beElements.length).toBeGreaterThan(0)
  })
})
