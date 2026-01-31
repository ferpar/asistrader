import { Trade } from '../../../types/trade'

export function buildTrade(overrides?: Partial<Trade>): Trade {
  return {
    id: 1,
    number: 1,
    ticker: 'AAPL',
    status: 'open',
    amount: 1500,
    units: 10,
    entry_price: 150,
    stop_loss: 140,
    take_profit: 170,
    date_planned: '2025-01-10',
    date_actual: '2025-01-11',
    exit_date: null,
    exit_type: null,
    exit_price: null,
    paper_trade: false,
    is_layered: false,
    remaining_units: null,
    exit_levels: [],
    strategy_id: null,
    strategy_name: null,
    risk_abs: -100,
    profit_abs: 200,
    risk_pct: -0.0667,
    profit_pct: 0.1333,
    ratio: 2.0,
    ...overrides,
  }
}
