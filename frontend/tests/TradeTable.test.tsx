import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TradeTable } from '../src/components/TradeTable'
import { Trade } from '../src/types/trade'

const mockTrade: Trade = {
  id: 1,
  number: 1,
  ticker: 'ASML',
  status: 'open',
  amount: 1000,
  units: 10,
  entry_price: 100,
  stop_loss: 95,
  take_profit: 115,
  date_planned: '2025-01-15',
  date_actual: '2025-01-16',
  exit_date: null,
  exit_type: null,
  exit_price: null,
  paper_trade: false,
  strategy_id: 1,
  strategy_name: 'Swing_82',
  risk_abs: -50,
  profit_abs: 150,
  risk_pct: -0.05,
  profit_pct: 0.15,
  ratio: 3.0,
  is_layered: false,
  remaining_units: null,
  exit_levels: [],
}

describe('TradeTable', () => {
  it('renders loading state', () => {
    render(<TradeTable trades={[]} loading={true} />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
    expect(screen.getByText('Loading trades...')).toBeInTheDocument()
  })

  it('renders error state', () => {
    render(<TradeTable trades={[]} error="Failed to fetch" />)
    expect(screen.getByTestId('error')).toBeInTheDocument()
    expect(screen.getByText('Failed to fetch')).toBeInTheDocument()
  })

  it('renders empty state when no trades', () => {
    render(<TradeTable trades={[]} />)
    expect(screen.getByTestId('empty')).toBeInTheDocument()
    expect(screen.getByText('No trades found')).toBeInTheDocument()
  })

  it('renders trade table with data', () => {
    render(<TradeTable trades={[mockTrade]} />)
    expect(screen.getByTestId('trade-table')).toBeInTheDocument()
    expect(screen.getByTestId('trade-row-1')).toBeInTheDocument()
  })

  it('displays trade ticker', () => {
    render(<TradeTable trades={[mockTrade]} />)
    expect(screen.getByText('ASML')).toBeInTheDocument()
  })

  it('displays trade status', () => {
    render(<TradeTable trades={[mockTrade]} />)
    expect(screen.getByText('open')).toBeInTheDocument()
  })

  it('displays formatted currency values', () => {
    render(<TradeTable trades={[mockTrade]} />)
    expect(screen.getByText('$1,000.00')).toBeInTheDocument()
    expect(screen.getByText('$100.00')).toBeInTheDocument()
  })

  it('displays calculated risk and profit', () => {
    render(<TradeTable trades={[mockTrade]} />)
    expect(screen.getByText('-$50.00')).toBeInTheDocument()
    expect(screen.getByText('$150.00')).toBeInTheDocument()
  })

  it('renders multiple trades', () => {
    const trades: Trade[] = [
      mockTrade,
      {
        ...mockTrade,
        id: 2,
        number: 2,
        ticker: 'NVDA',
        status: 'plan',
      },
    ]
    render(<TradeTable trades={trades} />)
    expect(screen.getByTestId('trade-row-1')).toBeInTheDocument()
    expect(screen.getByTestId('trade-row-2')).toBeInTheDocument()
    expect(screen.getByText('NVDA')).toBeInTheDocument()
  })

  it('renders table headers', () => {
    render(<TradeTable trades={[mockTrade]} />)
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
    render(<TradeTable trades={[mockTrade]} />)
    expect(screen.getByText('Swing_82')).toBeInTheDocument()
  })

  it('displays dash when no strategy', () => {
    const tradeWithoutStrategy: Trade = {
      ...mockTrade,
      id: 3,
      strategy_id: null,
      strategy_name: null,
    }
    render(<TradeTable trades={[tradeWithoutStrategy]} />)
    // Multiple '-' can appear (strategy, live metrics, etc), so we check at least one exists
    const dashes = screen.getAllByText('-')
    expect(dashes.length).toBeGreaterThan(0)
  })
})

// Layered trade tests
describe('TradeTable with layered trades', () => {
  const layeredMockTrade: Trade = {
    ...mockTrade,
    id: 10,
    units: 100,
    amount: 10000,
    is_layered: true,
    remaining_units: 50,
    exit_levels: [
      {
        id: 1,
        trade_id: 10,
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
        trade_id: 10,
        level_type: 'tp',
        price: 120,
        units_pct: 0.3,
        order_index: 2,
        status: 'pending',
        hit_date: null,
        units_closed: null,
        move_sl_to_breakeven: false,
      },
      {
        id: 3,
        trade_id: 10,
        level_type: 'tp',
        price: 130,
        units_pct: 0.2,
        order_index: 3,
        status: 'pending',
        hit_date: null,
        units_closed: null,
        move_sl_to_breakeven: false,
      },
    ],
  }

  it('displays layered indicator for layered trades', () => {
    render(<TradeTable trades={[layeredMockTrade]} />)
    expect(screen.getByText('Layered')).toBeInTheDocument()
  })

  it('shows remaining units for partially closed trades', () => {
    render(<TradeTable trades={[layeredMockTrade]} />)
    // remaining_units is 50
    expect(screen.getByText('50/100')).toBeInTheDocument()
  })

  it('displays simple indicator for non-layered trades', () => {
    render(<TradeTable trades={[mockTrade]} />)
    expect(screen.getByText('Simple')).toBeInTheDocument()
  })
})
