export type TradeStatus = 'plan' | 'open' | 'close'
export type ExitType = 'sl' | 'tp'
export type Bias = 'long' | 'short' | 'neutral'
export type Beta = 'low' | 'medium' | 'high'

export interface Strategy {
  id: number
  name: string
  pe_method: string | null
  sl_method: string | null
  tp_method: string | null
  description: string | null
}

export interface Trade {
  id: number
  number: number | null
  ticker: string
  status: TradeStatus
  amount: number
  units: number
  entry_price: number
  stop_loss: number
  take_profit: number
  date_planned: string
  date_actual: string | null
  exit_date: string | null
  exit_type: ExitType | null
  exit_price: number | null
  strategy_id: number | null
  strategy_name: string | null
  risk_abs: number
  profit_abs: number
}

export interface TradeListResponse {
  trades: Trade[]
  count: number
}
