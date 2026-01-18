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
  strategy_id: 1,
  strategy_name: 'Swing_82',
  risk_abs: -50,
  profit_abs: 150,
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
    expect(screen.getByText('Profit')).toBeInTheDocument()
    expect(screen.getByText('Strategy')).toBeInTheDocument()
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
    expect(screen.getByText('-')).toBeInTheDocument()
  })
})
