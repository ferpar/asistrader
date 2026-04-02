import { Decimal } from '../shared/Decimal'
import type { FundEventDTO } from '../../types/fund'
import type { FundEvent } from './types'

export function mapFundEvent(dto: FundEventDTO): FundEvent {
  return {
    id: dto.id,
    userId: dto.user_id,
    eventType: dto.event_type,
    amount: Decimal.from(dto.amount),
    description: dto.description,
    tradeId: dto.trade_id,
    paperTrade: dto.paper_trade,
    voided: dto.voided,
    eventDate: new Date(dto.event_date),
    createdAt: new Date(dto.created_at),
  }
}
