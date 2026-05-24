import { observable, computed } from '@legendapp/state'
import { ExtendedFilter, TradeCreateRequest, TradeUpdateRequest, MarkLevelHitRequest } from '../../types/trade'
import { ITradeRepository, DetectionResponse } from './ITradeRepository'
import type { TradeWithMetrics, EntryAlert, SLTPAlert, LayeredAlert, AnyAlert, DetectionResult, AlertSignature } from './types'

export class TradeStore {
  readonly trades$ = observable<TradeWithMetrics[]>([])
  readonly loading$ = observable(false)
  readonly error$ = observable<string | null>(null)
  readonly filter$ = observable<ExtendedFilter>('all')

  readonly entryAlerts$ = observable<EntryAlert[]>([])
  readonly sltpAlerts$ = observable<SLTPAlert[]>([])
  readonly layeredAlerts$ = observable<LayeredAlert[]>([])
  readonly detecting$ = observable(false)
  readonly lastDetectionResult$ = observable<DetectionResult | null>(null)
  // Alert keys the user has manually acted on since the last detection run.
  // Cleared whenever detectTradeHits() refreshes the alert lists.
  readonly actedAlertKeys$ = observable<Record<string, true>>({})

  readonly filteredTrades$ = computed(() => {
    const trades = this.trades$.get()
    const filter = this.filter$.get()
    switch (filter) {
      case 'all':
        return trades
      case 'winners':
        return trades.filter(t => t.status === 'close' && t.exitType === 'tp')
      case 'losers':
        return trades.filter(t => t.status === 'close' && t.exitType === 'sl')
      case 'winning':
      case 'losing':
        return trades.filter(t => t.status === 'open')
      default:
        return trades.filter(t => t.status === filter)
    }
  })

  readonly activeTrades$ = computed(() => {
    return this.trades$.get().filter(t => t.status === 'open' || t.status === 'plan' || t.status === 'ordered')
  })

  constructor(private readonly repo: ITradeRepository) {}

  async loadTrades(): Promise<void> {
    this.loading$.set(true)
    this.error$.set(null)
    try {
      const trades = await this.repo.fetchTrades()
      this.trades$.set(trades)
    } catch (err) {
      this.error$.set(err instanceof Error ? err.message : 'Failed to load trades')
    } finally {
      this.loading$.set(false)
    }
  }

  async createTrade(request: TradeCreateRequest): Promise<void> {
    await this.repo.createTrade(request)
    await this.loadTrades()
  }

  async updateTrade(id: number, request: TradeUpdateRequest): Promise<void> {
    await this.repo.updateTrade(id, request)
    await this.loadTrades()
  }

  async reopenTrade(id: number): Promise<void> {
    await this.repo.reopenTrade(id)
    await this.loadTrades()
  }

  async revertOpenToOrdered(id: number): Promise<void> {
    await this.repo.revertOpenToOrdered(id)
    await this.loadTrades()
  }

  async detectTradeHits(): Promise<DetectionResponse> {
    this.detecting$.set(true)
    try {
      const detection = await this.repo.detectTradeHits()
      this.entryAlerts$.set(detection.entryAlerts)
      this.sltpAlerts$.set(detection.sltpAlerts)
      this.layeredAlerts$.set(detection.layeredAlerts)
      this.lastDetectionResult$.set(detection.result)
      this.actedAlertKeys$.set({})
      const { autoOpenedCount, autoClosedCount, partialCloseCount } = detection.result
      if (autoOpenedCount > 0 || autoClosedCount > 0 || partialCloseCount > 0) {
        await this.loadTrades()
      }
      return detection
    } finally {
      this.detecting$.set(false)
    }
  }

  markAlertActed(key: string): void {
    this.actedAlertKeys$[key].set(true)
  }

  setFilter(filter: ExtendedFilter): void {
    this.filter$.set(filter)
  }

  private alertSignature(alert: AnyAlert): AlertSignature {
    return {
      tradeId: alert.tradeId,
      hitDate: alert.hitDate,
      alertKind: alert.alertKind,
      levelKey: alert.levelKey,
    }
  }

  private setAlertDismissed(sig: AlertSignature, dismissed: boolean): void {
    const matches = (a: AnyAlert): boolean =>
      a.tradeId === sig.tradeId &&
      a.hitDate === sig.hitDate &&
      a.alertKind === sig.alertKind &&
      a.levelKey === sig.levelKey
    this.entryAlerts$.set(prev => prev.map(a => (matches(a) ? { ...a, dismissed } : a)))
    this.sltpAlerts$.set(prev => prev.map(a => (matches(a) ? { ...a, dismissed } : a)))
    this.layeredAlerts$.set(prev => prev.map(a => (matches(a) ? { ...a, dismissed } : a)))
  }

  /** Persist a dismissal so the alert stays hidden on future check-alerts runs. */
  async dismissAlert(alert: AnyAlert): Promise<void> {
    const sig = this.alertSignature(alert)
    await this.repo.dismissAlert(sig)
    this.setAlertDismissed(sig, true)
  }

  /** Restore a dismissed alert so it reappears on the next check-alerts run. */
  async restoreAlert(alert: AnyAlert): Promise<void> {
    const sig = this.alertSignature(alert)
    await this.repo.restoreAlert(sig)
    this.setAlertDismissed(sig, false)
  }

  /** Dismiss every alert that is currently still active. */
  async dismissAllAlerts(): Promise<void> {
    const active: AnyAlert[] = [
      ...this.entryAlerts$.get(),
      ...this.sltpAlerts$.get(),
      ...this.layeredAlerts$.get(),
    ].filter(a => !a.dismissed)
    await Promise.all(active.map(a => this.dismissAlert(a)))
  }

  async markExitLevelHit(tradeId: number, levelId: number, request: MarkLevelHitRequest): Promise<void> {
    await this.repo.markExitLevelHit(tradeId, levelId, request)
    await this.loadTrades()
  }

  async revertExitLevelHit(tradeId: number, levelId: number): Promise<void> {
    await this.repo.revertExitLevelHit(tradeId, levelId)
    await this.loadTrades()
  }
}
