import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Decimal } from '../src/domain/shared/Decimal'
import { TradeTable } from '../src/components/TradeTable'
import type { TradeWithMetrics } from '../src/domain/trade/types'
import { ContainerProvider } from '../src/container/ContainerContext'

function renderWithContainer(ui: React.ReactElement) {
  return render(<ContainerProvider>{ui}</ContainerProvider>)
}

const mockTrade: TradeWithMetrics = {
  id: 1,
  number: 1,
  ticker: 'ASML',
  status: 'open',
  amount: Decimal.from(1000),
  units: 10,
  entryPrice: Decimal.from(100),
  stopLoss: Decimal.from(95),
  takeProfit: Decimal.from(115),
  datePlanned: new Date('2025-01-15'),
  dateActual: new Date('2025-01-16'),
  exitDate: null,
  exitType: null,
  exitPrice: null,
  paperTrade: false,
  strategyId: 1,
  strategyName: 'Swing_82',
  riskAbs: Decimal.from(-50),
  profitAbs: Decimal.from(150),
  riskPct: Decimal.from(-0.05),
  profitPct: Decimal.from(0.15),
  ratio: Decimal.from(3.0),
  isLayered: false,
  remainingUnits: null,
  exitLevels: [],
}

describe('TradeTable', () => {
  it('renders loading state', () => {
    renderWithContainer(<TradeTable trades={[]} loading={true} />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
    expect(screen.getByText('Loading trades...')).toBeInTheDocument()
  })

  it('renders error state', () => {
    renderWithContainer(<TradeTable trades={[]} error="Failed to fetch" />)
    expect(screen.getByTestId('error')).toBeInTheDocument()
    expect(screen.getByText('Failed to fetch')).toBeInTheDocument()
  })

  it('renders empty state when no trades', () => {
    renderWithContainer(<TradeTable trades={[]} />)
    expect(screen.getByTestId('empty')).toBeInTheDocument()
    expect(screen.getByText('No trades found')).toBeInTheDocument()
  })

  it('renders trade table with data', () => {
    renderWithContainer(<TradeTable trades={[mockTrade]} />)
    expect(screen.getByTestId('trade-table')).toBeInTheDocument()
    expect(screen.getByTestId('trade-row-1')).toBeInTheDocument()
  })

  it('displays trade ticker', () => {
    renderWithContainer(<TradeTable trades={[mockTrade]} />)
    expect(screen.getByText('ASML')).toBeInTheDocument()
  })

  it('displays trade status', () => {
    renderWithContainer(<TradeTable trades={[mockTrade]} />)
    expect(screen.getByText('open')).toBeInTheDocument()
  })

  it('displays formatted currency values', () => {
    renderWithContainer(<TradeTable trades={[mockTrade]} />)
    expect(screen.getByText('$1,000.00')).toBeInTheDocument()
    expect(screen.getByText('$100.00')).toBeInTheDocument()
  })

  it('displays calculated risk and profit', () => {
    renderWithContainer(<TradeTable trades={[mockTrade]} />)
    expect(screen.getByText('-$50.00')).toBeInTheDocument()
    expect(screen.getByText('$150.00')).toBeInTheDocument()
  })

  it('renders multiple trades', () => {
    const trades: TradeWithMetrics[] = [
      mockTrade,
      {
        ...mockTrade,
        id: 2,
        number: 2,
        ticker: 'NVDA',
        status: 'plan',
      },
    ]
    renderWithContainer(<TradeTable trades={trades} />)
    expect(screen.getByTestId('trade-row-1')).toBeInTheDocument()
    expect(screen.getByTestId('trade-row-2')).toBeInTheDocument()
    expect(screen.getByText('NVDA')).toBeInTheDocument()
  })

  it('renders table headers', () => {
    renderWithContainer(<TradeTable trades={[mockTrade]} />)
    expect(screen.getByText('Ticker')).toBeInTheDocument()
    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByText('Amount')).toBeInTheDocument()
    expect(screen.getByText('Entry')).toBeInTheDocument()
    expect(screen.getByText('Stop Loss')).toBeInTheDocument()
    expect(screen.getByText('Take Profit')).toBeInTheDocument()
    expect(screen.getByText('Risk')).toBeInTheDocument()
    expect(screen.getByText('Risk %')).toBeInTheDocument()
    expect(screen.getByText('Profit')).toBeInTheDocument()
    expect(screen.getByText('Profit %')).toBeInTheDocument()
    expect(screen.getByText('Ratio')).toBeInTheDocument()
    expect(screen.getByText('Strategy')).toBeInTheDocument()
    expect(screen.getByText('Mode')).toBeInTheDocument()
    expect(screen.getByText('Remaining')).toBeInTheDocument()
  })

  it('displays strategy name', () => {
    renderWithContainer(<TradeTable trades={[mockTrade]} />)
    expect(screen.getByText('Swing_82')).toBeInTheDocument()
  })

  it('displays dash when no strategy', () => {
    const tradeWithoutStrategy: TradeWithMetrics = {
      ...mockTrade,
      id: 3,
      strategyId: null,
      strategyName: null,
    }
    renderWithContainer(<TradeTable trades={[tradeWithoutStrategy]} />)
    // Multiple '-' can appear (strategy, live metrics, etc), so we check at least one exists
    const dashes = screen.getAllByText('-')
    expect(dashes.length).toBeGreaterThan(0)
  })
})

// Layered trade tests
describe('TradeTable with layered trades', () => {
  const layeredMockTrade: TradeWithMetrics = {
    ...mockTrade,
    id: 10,
    units: 100,
    amount: Decimal.from(10000),
    isLayered: true,
    remainingUnits: 50,
    exitLevels: [
      {
        id: 1,
        tradeId: 10,
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
        tradeId: 10,
        levelType: 'tp',
        price: Decimal.from(120),
        unitsPct: Decimal.from(0.3),
        orderIndex: 2,
        status: 'pending',
        hitDate: null,
        unitsClosed: null,
        moveSlToBreakeven: false,
      },
      {
        id: 3,
        tradeId: 10,
        levelType: 'tp',
        price: Decimal.from(130),
        unitsPct: Decimal.from(0.2),
        orderIndex: 3,
        status: 'pending',
        hitDate: null,
        unitsClosed: null,
        moveSlToBreakeven: false,
      },
    ],
  }

  it('displays layered indicator for layered trades', () => {
    renderWithContainer(<TradeTable trades={[layeredMockTrade]} />)
    expect(screen.getByText(/Layered/)).toBeInTheDocument()
  })

  it('shows remaining units for partially closed trades', () => {
    renderWithContainer(<TradeTable trades={[layeredMockTrade]} />)
    // remaining_units is 50
    expect(screen.getByText('50/100')).toBeInTheDocument()
  })

  it('displays simple indicator for non-layered trades', () => {
    renderWithContainer(<TradeTable trades={[mockTrade]} />)
    expect(screen.getByText('Simple')).toBeInTheDocument()
  })
})
