export type FundEventType = 'deposit' | 'withdrawal' | 'reserve' | 'benefit' | 'loss'

export interface FundEventDTO {
  id: number
  user_id: number
  event_type: FundEventType
  amount: number
  currency: string
  description: string | null
  trade_id: number | null
  auto_detect: boolean
  voided: boolean
  event_date: string
  created_at: string
}

export interface FundEventListResponseDTO {
  events: FundEventDTO[]
  count: number
}

export interface FundEventResponseDTO {
  event: FundEventDTO
  message: string
}

export interface DepositRequest {
  amount: number
  currency?: string
  description?: string
  event_date?: string
}

export interface WithdrawalRequest {
  amount: number
  currency?: string
  description?: string
  event_date?: string
}

export interface ManualEventRequest {
  event_type: 'benefit' | 'loss'
  amount: number
  currency?: string
  description?: string
  trade_id?: number
  event_date?: string
}

export interface FundSettingsDTO {
  risk_pct: number
  base_currency: string
}

export interface FundSettingsRequest {
  risk_pct?: number
  base_currency?: string
}
