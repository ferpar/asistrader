import { observable } from '@legendapp/state'
import { Decimal } from '../shared/Decimal'
import type { IFundRepository } from './IFundRepository'
import type { FundEvent, BalanceSummary } from './types'
import type { DepositRequest, WithdrawalRequest, ManualEventRequest } from '../../types/fund'
import type { FxStore } from '../fx/FxStore'
import { computeBalance } from './computeBalance'

const DEFAULT_BASE_CURRENCY = 'USD'

/**
 * Build a cheap key over the inputs that matter for balance computation.
 * Two recomputes with the same key produce the same output, so we can
 * skip work. We don't include event identities because mutations always
 * go through `loadEvents`, which replaces the array reference.
 */
function balanceKey(
  eventCount: number,
  riskPct: Decimal,
  baseCurrency: string,
  fxLoaded: boolean,
): string {
  return `${eventCount}|${riskPct.toString()}|${baseCurrency}|${fxLoaded ? 1 : 0}`
}

export class FundStore {
  readonly events$ = observable<FundEvent[]>([])
  readonly loading$ = observable(false)
  readonly error$ = observable<string | null>(null)
  readonly includeVoided$ = observable(false)
  readonly riskPct$ = observable<Decimal>(Decimal.from(0.02))
  readonly baseCurrency$ = observable<string>(DEFAULT_BASE_CURRENCY)
  readonly fxLoaded$ = observable(false)

  /** Latest balance result. `null` until the first compute lands. */
  readonly balance$ = observable<BalanceSummary | null>(null)
  /** True from the moment a recompute is scheduled until it lands. */
  readonly balanceComputing$ = observable(false)

  private lastBalanceKey = ''

  constructor(
    private readonly repo: IFundRepository,
    private readonly fxStore: FxStore,
  ) {
    // Inputs that should trigger a balance recompute.
    this.fxStore.loaded$.onChange(({ value }) => {
      this.fxLoaded$.set(Boolean(value))
      this.scheduleBalanceRecompute()
    })
    this.events$.onChange(() => this.scheduleBalanceRecompute())
    this.riskPct$.onChange(() => this.scheduleBalanceRecompute())
    this.baseCurrency$.onChange(() => this.scheduleBalanceRecompute())
  }

  /**
   * Yield to the event loop, then run computeBalance. The skeleton flashes
   * on every recompute (per the agreed UX). Memoization skips no-op recomputes.
   */
  private scheduleBalanceRecompute(): void {
    const key = balanceKey(
      this.events$.get().length,
      this.riskPct$.get(),
      this.baseCurrency$.get(),
      this.fxLoaded$.get(),
    )
    if (key === this.lastBalanceKey) return
    this.lastBalanceKey = key
    this.balanceComputing$.set(true)
    queueMicrotask(() => {
      const result = computeBalance(
        this.events$.get(),
        this.riskPct$.get(),
        this.baseCurrency$.get(),
        this.fxStore,
      )
      this.balance$.set(result)
      this.balanceComputing$.set(false)
    })
  }

  async loadEvents(): Promise<void> {
    this.loading$.set(true)
    this.error$.set(null)
    try {
      const includeVoided = this.includeVoided$.get()
      const events = await this.repo.fetchEvents(includeVoided)
      this.events$.set(events)
      // Ensure FX history covers every currency we just loaded.
      const currencies = Array.from(new Set(events.map((e) => e.currency)))
      currencies.push(this.baseCurrency$.get())
      await this.fxStore.loadHistory(Array.from(new Set(currencies)))
    } catch (err) {
      this.error$.set(err instanceof Error ? err.message : 'Failed to load events')
    } finally {
      this.loading$.set(false)
    }
  }

  async loadSettings(): Promise<void> {
    try {
      const settings = await this.repo.fetchSettings()
      this.riskPct$.set(Decimal.from(settings.risk_pct))
      this.baseCurrency$.set(settings.base_currency || DEFAULT_BASE_CURRENCY)
    } catch {
      // Use defaults
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
    const settings = await this.repo.updateSettings({ risk_pct: riskPct })
    this.riskPct$.set(Decimal.from(settings.risk_pct))
  }

  async updateBaseCurrency(baseCurrency: string): Promise<void> {
    const settings = await this.repo.updateSettings({ base_currency: baseCurrency })
    this.baseCurrency$.set(settings.base_currency)
    // Refresh FX history so the new base is covered.
    const currencies = Array.from(
      new Set(this.events$.get().map((e) => e.currency).concat(settings.base_currency)),
    )
    await this.fxStore.loadHistory(currencies)
  }

  setIncludeVoided(value: boolean): void {
    this.includeVoided$.set(value)
    this.loadEvents()
  }
}
