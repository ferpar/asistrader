import { observable, computed } from '@legendapp/state'
import { ExtendedFilter, TradeCreateRequest, TradeUpdateRequest, MarkLevelHitRequest } from '../../types/trade'
import { ITradeRepository, DetectionResponse } from './ITradeRepository'
import type { TradeWithMetrics, EntryAlert, SLTPAlert, DetectionResult } from './types'

export class TradeStore {
  readonly trades$ = observable<TradeWithMetrics[]>([])
  readonly loading$ = observable(false)
  readonly error$ = observable<string | null>(null)
  readonly filter$ = observable<ExtendedFilter>('all')

  readonly entryAlerts$ = observable<EntryAlert[]>([])
  readonly sltpAlerts$ = observable<SLTPAlert[]>([])
  readonly detecting$ = observable(false)
  readonly lastDetectionResult$ = observable<DetectionResult | null>(null)

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
      default:
        return trades.filter(t => t.status === filter)
    }
  })

  readonly activeTrades$ = computed(() => {
    return this.trades$.get().filter(t => t.status === 'open' || t.status === 'plan')
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

  async detectTradeHits(): Promise<DetectionResponse> {
    this.detecting$.set(true)
    try {
      const detection = await this.repo.detectTradeHits()
      this.entryAlerts$.set(detection.entryAlerts)
      this.sltpAlerts$.set(detection.sltpAlerts)
      this.lastDetectionResult$.set(detection.result)
      if (detection.result.autoOpenedCount > 0 || detection.result.autoClosedCount > 0) {
        await this.loadTrades()
      }
      return detection
    } finally {
      this.detecting$.set(false)
    }
  }

  setFilter(filter: ExtendedFilter): void {
    this.filter$.set(filter)
  }

  dismissEntryAlert(tradeId: number): void {
    this.entryAlerts$.set(prev => prev.filter(a => a.tradeId !== tradeId))
  }

  dismissSltpAlert(tradeId: number): void {
    this.sltpAlerts$.set(prev => prev.filter(a => a.tradeId !== tradeId))
  }

  dismissAllAlerts(): void {
    this.entryAlerts$.set([])
    this.sltpAlerts$.set([])
    this.lastDetectionResult$.set(null)
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
