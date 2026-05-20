import { Decimal } from '../shared/Decimal'
import { TradeStatus, ExitType, ExitLevelType, ExitLevelStatus, SLTPHitType, EntryHitType, CancelReason, OrderType, TimeInEffect, HitKind } from '../../types/trade'

export type { HitKind }

export interface ExitLevel {
  id: number
  tradeId: number
  levelType: ExitLevelType
  price: Decimal
  unitsPct: Decimal
  orderIndex: number
  status: ExitLevelStatus
  hitDate: Date | null
  unitsClosed: number | null
  moveSlToBreakeven: boolean
}

export interface Trade {
  id: number
  number: number | null
  ticker: string
  tickerName: string | null
  tickerCurrency: string | null
  tickerPriceHint: number | null
  status: TradeStatus
  amount: Decimal
  units: number
  remainingUnits: number | null
  entryPrice: Decimal
  stopLoss: Decimal
  takeProfit: Decimal
  datePlanned: Date
  dateActual: Date | null
  exitDate: Date | null
  exitType: ExitType | null
  exitPrice: Decimal | null
  orderType: OrderType | null
  timeInEffect: TimeInEffect | null
  gtdDate: Date | null
  autoDetect: boolean
  isLayered: boolean
  exitLevels: ExitLevel[]
  strategyId: number | null
  strategyName: string | null
  cancelReason: CancelReason | null
}

export interface TradeMetrics {
  riskAbs: Decimal
  profitAbs: Decimal
  riskPct: Decimal
  profitPct: Decimal
  ratio: Decimal
}

export type TradeWithMetrics = Trade & TradeMetrics

export interface PriceData {
  price: Decimal | null
  currency: string | null
  valid: boolean
}

export interface LiveMetrics {
  currentPrice: Decimal | null
  distanceToSL: Decimal | null
  distanceToTP: Decimal | null
  distanceToPE: Decimal | null
  unrealizedPnL: Decimal | null
  unrealizedPnLPct: Decimal | null
}

/** The fields that identify an alert for the dismissal blacklist. */
export interface AlertSignature {
  tradeId: number
  hitDate: string
  alertKind: string
  levelKey: string
}

export interface EntryAlert {
  tradeId: number
  ticker: string
  hitType: EntryHitType
  hitDate: string
  entryPrice: Decimal
  autoDetect: boolean
  autoOpened: boolean
  currency: string | null
  priceHint: number | null
  alertKind: string
  levelKey: string
  dismissed: boolean
  hitKind: HitKind
  barOpen: Decimal | null
  prevClose: Decimal | null
}

export interface SLTPAlert {
  tradeId: number
  ticker: string
  hitType: SLTPHitType
  hitDate: string
  hitPrice: Decimal
  autoDetect: boolean
  autoClosed: boolean
  currency: string | null
  priceHint: number | null
  alertKind: string
  levelKey: string
  dismissed: boolean
  hitKind: HitKind
  barOpen: Decimal | null
  prevClose: Decimal | null
  alsoWouldHaveHit: string[]
}

export interface LayeredAlert {
  tradeId: number
  ticker: string
  levelType: ExitLevelType
  levelIndex: number
  hitDate: string
  hitPrice: Decimal
  unitsClosed: number
  remainingUnits: number
  autoDetect: boolean
  autoProcessed: boolean
  currency: string | null
  priceHint: number | null
  alertKind: string
  levelKey: string
  dismissed: boolean
  hitKind: HitKind
  barOpen: Decimal | null
  prevClose: Decimal | null
  alsoWouldHaveHit: string[]
}

export interface DetectionResult {
  autoOpenedCount: number
  autoClosedCount: number
  partialCloseCount: number
  conflictCount: number
}

/** Any of the three alert kinds — all share the dismissal-signature fields. */
export type AnyAlert = EntryAlert | SLTPAlert | LayeredAlert

// --- Detection trace (mirrors backend ScanTrace / BarEval / LevelCheck) ---

export interface LevelCheck {
  key: string         // "sl" | "tp" | "entry" | "sl:1" | "tp:2" | ...
  kind: 'sl' | 'tp' | 'entry'
  side: 'long' | 'short'
  price: Decimal
  threshold: Decimal
  pierced: boolean
  gap: boolean
}

export interface BarEval {
  date: string        // ISO date
  open: Decimal | null
  high: Decimal | null
  low: Decimal | null
  close: Decimal | null
  prevClose: Decimal | null
  checks: LevelCheck[]
  decision: 'skip' | 'no_data' | 'hit' | 'both_hit'
  chosenKeys: string[]
  reason: string
}

export interface ScanTrace {
  kind: 'sltp' | 'entry' | 'layered' | 'none'
  tradeId: number | null
  side: 'long' | 'short'
  margin: Decimal
  scanFrom: string | null
  scanTo: string | null
  barsScanned: number
  bars: BarEval[]
  verdict: string
  extras: Record<string, unknown>
}

export interface DetectionTraceOverrides {
  sl?: number
  tp?: number
  entry?: number
  opened?: string    // YYYY-MM-DD
  planned?: string   // YYYY-MM-DD
  margin?: number
}

export interface DetectionTraceResult {
  trace: ScanTrace
  detectorKind: 'sltp' | 'entry' | 'layered' | 'none'
  whatIf: Record<string, unknown>
}
