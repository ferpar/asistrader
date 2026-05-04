import { Decimal } from '../shared/Decimal'
import type { FundEventType } from '../../types/fund'

export type { FundEventType }

export interface FundEvent {
  id: number
  userId: number
  eventType: FundEventType
  amount: Decimal
  currency: string
  description: string | null
  tradeId: number | null
  autoDetect: boolean
  voided: boolean
  eventDate: Date
  createdAt: Date
}

export interface BalanceSummary {
  equity: Decimal
  committed: Decimal
  available: Decimal
  maxPerTrade: Decimal
  riskPct: Decimal
  baseCurrency: string
}
