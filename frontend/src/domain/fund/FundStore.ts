import { observable, computed } from '@legendapp/state'
import { Decimal } from '../shared/Decimal'
import type { IFundRepository } from './IFundRepository'
import type { FundEvent, BalanceSummary } from './types'
import type { DepositRequest, WithdrawalRequest, ManualEventRequest } from '../../types/fund'
import { computeBalance } from './computeBalance'

export class FundStore {
  readonly events$ = observable<FundEvent[]>([])
  readonly loading$ = observable(false)
  readonly error$ = observable<string | null>(null)
  readonly includeVoided$ = observable(false)
  readonly riskPct$ = observable<Decimal>(Decimal.from(0.02))

  readonly balance$ = computed<BalanceSummary>(() => {
    const events = this.events$.get()
    const riskPct = this.riskPct$.get()
    return computeBalance(events, riskPct)
  })

  constructor(private readonly repo: IFundRepository) {}

  async loadEvents(): Promise<void> {
    this.loading$.set(true)
    this.error$.set(null)
    try {
      const includeVoided = this.includeVoided$.get()
      const events = await this.repo.fetchEvents(includeVoided)
      this.events$.set(events)
    } catch (err) {
      this.error$.set(err instanceof Error ? err.message : 'Failed to load events')
    } finally {
      this.loading$.set(false)
    }
  }

  async loadRiskPct(): Promise<void> {
    try {
      const pct = await this.repo.fetchRiskPct()
      this.riskPct$.set(Decimal.from(pct))
    } catch {
      // Use default
    }
  }

  async deposit(request: DepositRequest): Promise<void> {
    await this.repo.createDeposit(request)
    await this.loadEvents()
  }

  async withdraw(request: WithdrawalRequest): Promise<void> {
    await this.repo.createWithdrawal(request)
    await this.loadEvents()
  }

  async createManualEvent(request: ManualEventRequest): Promise<void> {
    await this.repo.createManualEvent(request)
    await this.loadEvents()
  }

  async voidEvent(eventId: number): Promise<void> {
    await this.repo.voidEvent(eventId)
    await this.loadEvents()
  }

  async updateRiskPct(riskPct: number): Promise<void> {
    const pct = await this.repo.updateRiskPct(riskPct)
    this.riskPct$.set(Decimal.from(pct))
  }

  setIncludeVoided(value: boolean): void {
    this.includeVoided$.set(value)
    this.loadEvents()
  }
}
