import { Decimal } from '../shared/Decimal'
import type { FundEventType } from '../../types/fund'

export type { FundEventType }

export interface FundEvent {
  id: number
  userId: number
  eventType: FundEventType
  amount: Decimal
  description: string | null
  tradeId: number | null
  paperTrade: boolean
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
}
