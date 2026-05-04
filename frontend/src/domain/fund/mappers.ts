import { Decimal } from '../shared/Decimal'
import { parseDateOnly } from '../../utils/dateOnly'
import type { FundEventDTO } from '../../types/fund'
import type { FundEvent } from './types'

export function mapFundEvent(dto: FundEventDTO): FundEvent {
  return {
    id: dto.id,
    userId: dto.user_id,
    eventType: dto.event_type,
    amount: Decimal.from(dto.amount),
    currency: dto.currency,
    description: dto.description,
    tradeId: dto.trade_id,
    autoDetect: dto.auto_detect,
    voided: dto.voided,
    // event_date is a date-only string; created_at is a full ISO timestamp.
    eventDate: parseDateOnly(dto.event_date),
    createdAt: new Date(dto.created_at),
  }
}
