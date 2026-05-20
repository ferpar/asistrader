import { TradeCreateRequest, TradeUpdateRequest, MarkLevelHitRequest } from '../../types/trade'
import type { TradeWithMetrics, PriceData, EntryAlert, SLTPAlert, LayeredAlert, DetectionResult, AlertSignature, DetectionTraceOverrides, DetectionTraceResult } from './types'

export interface DetectionResponse {
  entryAlerts: EntryAlert[]
  sltpAlerts: SLTPAlert[]
  layeredAlerts: LayeredAlert[]
  result: DetectionResult
}

export interface ITradeRepository {
  fetchTrades(): Promise<TradeWithMetrics[]>
  createTrade(request: TradeCreateRequest): Promise<TradeWithMetrics>
  updateTrade(id: number, request: TradeUpdateRequest): Promise<TradeWithMetrics>
  reopenTrade(id: number): Promise<TradeWithMetrics>
  revertOpenToOrdered(id: number): Promise<TradeWithMetrics>
  detectTradeHits(): Promise<DetectionResponse>
  fetchDetectionTrace(tradeId: number, overrides?: DetectionTraceOverrides): Promise<DetectionTraceResult>
  markExitLevelHit(tradeId: number, levelId: number, request: MarkLevelHitRequest): Promise<TradeWithMetrics>
  revertExitLevelHit(tradeId: number, levelId: number): Promise<TradeWithMetrics>
  dismissAlert(signature: AlertSignature): Promise<void>
  restoreAlert(signature: AlertSignature): Promise<void>
}

export interface IPriceProvider {
  fetchBatchPrices(symbols: string[]): Promise<Record<string, PriceData>>
}
