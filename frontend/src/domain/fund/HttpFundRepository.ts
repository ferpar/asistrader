import type { IFundRepository } from './IFundRepository'
import type { FundEvent } from './types'
import type {
  DepositRequest,
  WithdrawalRequest,
  ManualEventRequest,
  FundEventListResponseDTO,
  FundEventResponseDTO,
  RiskSettingsDTO,
} from '../../types/fund'
import { mapFundEvent } from './mappers'
import { buildHeaders } from '../shared/httpHelpers'

export class HttpFundRepository implements IFundRepository {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => string | null,
  ) {}

  async fetchEvents(includeVoided: boolean): Promise<FundEvent[]> {
    const params = new URLSearchParams()
    if (includeVoided) params.set('include_voided', 'true')
    const response = await fetch(
      `${this.baseUrl}/api/fund/events?${params}`,
      { headers: buildHeaders(this.getToken) },
    )
    if (!response.ok) throw new Error(`Failed to fetch events: ${response.statusText}`)
    const data: FundEventListResponseDTO = await response.json()
    return data.events.map(mapFundEvent)
  }

  async createDeposit(request: DepositRequest): Promise<FundEvent> {
    const response = await fetch(`${this.baseUrl}/api/fund/deposit`, {
      method: 'POST',
      headers: buildHeaders(this.getToken, true),
      body: JSON.stringify(request),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => null)
      throw new Error(error?.detail || 'Failed to create deposit')
    }
    const data: FundEventResponseDTO = await response.json()
    return mapFundEvent(data.event)
  }

  async createWithdrawal(request: WithdrawalRequest): Promise<FundEvent> {
    const response = await fetch(`${this.baseUrl}/api/fund/withdrawal`, {
      method: 'POST',
      headers: buildHeaders(this.getToken, true),
      body: JSON.stringify(request),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => null)
      throw new Error(error?.detail || 'Failed to create withdrawal')
    }
    const data: FundEventResponseDTO = await response.json()
    return mapFundEvent(data.event)
  }

  async createManualEvent(request: ManualEventRequest): Promise<FundEvent> {
    const response = await fetch(`${this.baseUrl}/api/fund/manual-event`, {
      method: 'POST',
      headers: buildHeaders(this.getToken, true),
      body: JSON.stringify(request),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => null)
      throw new Error(error?.detail || 'Failed to create event')
    }
    const data: FundEventResponseDTO = await response.json()
    return mapFundEvent(data.event)
  }

  async voidEvent(eventId: number): Promise<FundEvent> {
    const response = await fetch(`${this.baseUrl}/api/fund/events/${eventId}/void`, {
      method: 'PATCH',
      headers: buildHeaders(this.getToken),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => null)
      throw new Error(error?.detail || 'Failed to void event')
    }
    const data: FundEventResponseDTO = await response.json()
    return mapFundEvent(data.event)
  }

  async fetchRiskPct(): Promise<number> {
    const response = await fetch(`${this.baseUrl}/api/fund/settings`, {
      headers: buildHeaders(this.getToken),
    })
    if (!response.ok) throw new Error('Failed to fetch risk settings')
    const data: RiskSettingsDTO = await response.json()
    return data.risk_pct
  }

  async updateRiskPct(riskPct: number): Promise<number> {
    const response = await fetch(`${this.baseUrl}/api/fund/settings`, {
      method: 'PATCH',
      headers: buildHeaders(this.getToken, true),
      body: JSON.stringify({ risk_pct: riskPct }),
    })
    if (!response.ok) throw new Error('Failed to update risk settings')
    const data: RiskSettingsDTO = await response.json()
    return data.risk_pct
  }
}
