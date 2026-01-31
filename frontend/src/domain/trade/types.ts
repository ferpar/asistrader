import { Decimal } from '../shared/Decimal'
import { TradeStatus, ExitType, ExitLevelType, ExitLevelStatus, SLTPHitType, EntryHitType } from '../../types/trade'

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
  paperTrade: boolean
  isLayered: boolean
  exitLevels: ExitLevel[]
  strategyId: number | null
  strategyName: string | null
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

export interface EntryAlert {
  tradeId: number
  ticker: string
  hitType: EntryHitType
  hitDate: string
  entryPrice: Decimal
  paperTrade: boolean
  autoOpened: boolean
  message: string
}

export interface SLTPAlert {
  tradeId: number
  ticker: string
  hitType: SLTPHitType
  hitDate: string
  hitPrice: Decimal
  paperTrade: boolean
  autoClosed: boolean
  message: string
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
  paperTrade: boolean
  autoProcessed: boolean
  message: string
}

export interface DetectionResult {
  autoOpenedCount: number
  autoClosedCount: number
  partialCloseCount: number
  conflictCount: number
}
