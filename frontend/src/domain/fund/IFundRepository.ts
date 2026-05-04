import type { FundEvent } from './types'
import type {
  DepositRequest,
  FundSettingsDTO,
  FundSettingsRequest,
  ManualEventRequest,
  WithdrawalRequest,
} from '../../types/fund'

export interface IFundRepository {
  fetchEvents(includeVoided: boolean): Promise<FundEvent[]>
  createDeposit(request: DepositRequest): Promise<FundEvent>
  createWithdrawal(request: WithdrawalRequest): Promise<FundEvent>
  createManualEvent(request: ManualEventRequest): Promise<FundEvent>
  voidEvent(eventId: number): Promise<FundEvent>
  fetchSettings(): Promise<FundSettingsDTO>
  updateSettings(request: FundSettingsRequest): Promise<FundSettingsDTO>
}
