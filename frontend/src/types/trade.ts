export type TradeStatus = 'plan' | 'open' | 'close'
export type ExitType = 'sl' | 'tp'

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
  risk_abs: number
  profit_abs: number
}

export interface TradeListResponse {
  trades: Trade[]
  count: number
}
