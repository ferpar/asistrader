import { observable, computed } from '@legendapp/state'
import { Trade, ExtendedFilter, EntryAlert, SLTPAlert, TradeCreateRequest, TradeUpdateRequest, TradeDetectionResponse } from '../../types/trade'
import { ITradeRepository } from './ITradeRepository'

export class TradeStore {
  readonly trades$ = observable<Trade[]>([])
  readonly loading$ = observable(false)
  readonly error$ = observable<string | null>(null)
  readonly filter$ = observable<ExtendedFilter>('all')

  readonly entryAlerts$ = observable<EntryAlert[]>([])
  readonly sltpAlerts$ = observable<SLTPAlert[]>([])
  readonly detecting$ = observable(false)
  readonly lastDetectionResult$ = observable<{
    autoOpenedCount: number
    autoClosedCount: number
    conflictCount: number
  } | null>(null)

  readonly filteredTrades$ = computed(() => {
    const trades = this.trades$.get()
    const filter = this.filter$.get()
    switch (filter) {
      case 'all':
        return trades
      case 'winners':
        return trades.filter(t => t.status === 'close' && t.exit_type === 'tp')
      case 'losers':
        return trades.filter(t => t.status === 'close' && t.exit_type === 'sl')
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

  async detectTradeHits(): Promise<TradeDetectionResponse> {
    this.detecting$.set(true)
    try {
      const result = await this.repo.detectTradeHits()
      this.entryAlerts$.set(result.entry_alerts)
      this.sltpAlerts$.set(result.sltp_alerts)
      this.lastDetectionResult$.set({
        autoOpenedCount: result.auto_opened_count,
        autoClosedCount: result.auto_closed_count,
        conflictCount: result.conflict_count,
      })
      if (result.auto_opened_count > 0 || result.auto_closed_count > 0) {
        await this.loadTrades()
      }
      return result
    } finally {
      this.detecting$.set(false)
    }
  }

  setFilter(filter: ExtendedFilter): void {
    this.filter$.set(filter)
  }

  dismissEntryAlert(tradeId: number): void {
    this.entryAlerts$.set(prev => prev.filter(a => a.trade_id !== tradeId))
  }

  dismissSltpAlert(tradeId: number): void {
    this.sltpAlerts$.set(prev => prev.filter(a => a.trade_id !== tradeId))
  }

  dismissAllAlerts(): void {
    this.entryAlerts$.set([])
    this.sltpAlerts$.set([])
    this.lastDetectionResult$.set(null)
  }
}
