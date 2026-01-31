import { Decimal } from '../shared/Decimal'
import type {
  TradeDTO,
  ExitLevelDTO,
  PriceDataDTO,
  EntryAlertDTO,
  SLTPAlertDTO,
  LayeredAlertDTO,
  TradeDetectionResponseDTO,
} from '../../types/trade'
import type {
  TradeWithMetrics,
  ExitLevel,
  PriceData,
  EntryAlert,
  SLTPAlert,
  LayeredAlert,
  DetectionResult,
} from './types'

export function mapExitLevel(dto: ExitLevelDTO): ExitLevel {
  return {
    id: dto.id,
    tradeId: dto.trade_id,
    levelType: dto.level_type,
    price: Decimal.from(dto.price),
    unitsPct: Decimal.from(dto.units_pct),
    orderIndex: dto.order_index,
    status: dto.status,
    hitDate: dto.hit_date ? new Date(dto.hit_date) : null,
    unitsClosed: dto.units_closed,
    moveSlToBreakeven: dto.move_sl_to_breakeven,
  }
}

export function mapTrade(dto: TradeDTO): TradeWithMetrics {
  return {
    id: dto.id,
    number: dto.number,
    ticker: dto.ticker,
    status: dto.status,
    amount: Decimal.from(dto.amount),
    units: dto.units,
    remainingUnits: dto.remaining_units,
    entryPrice: Decimal.from(dto.entry_price),
    stopLoss: Decimal.from(dto.stop_loss),
    takeProfit: Decimal.from(dto.take_profit),
    datePlanned: new Date(dto.date_planned),
    dateActual: dto.date_actual ? new Date(dto.date_actual) : null,
    exitDate: dto.exit_date ? new Date(dto.exit_date) : null,
    exitType: dto.exit_type,
    exitPrice: dto.exit_price !== null ? Decimal.from(dto.exit_price) : null,
    paperTrade: dto.paper_trade,
    isLayered: dto.is_layered,
    exitLevels: dto.exit_levels.map(mapExitLevel),
    strategyId: dto.strategy_id,
    strategyName: dto.strategy_name,
    riskAbs: Decimal.from(dto.risk_abs),
    profitAbs: Decimal.from(dto.profit_abs),
    riskPct: Decimal.from(dto.risk_pct),
    profitPct: Decimal.from(dto.profit_pct),
    ratio: Decimal.from(dto.ratio),
  }
}

export function mapPriceData(dto: PriceDataDTO): PriceData {
  return {
    price: dto.price !== null ? Decimal.from(dto.price) : null,
    currency: dto.currency,
    valid: dto.valid,
  }
}

export function mapEntryAlert(dto: EntryAlertDTO): EntryAlert {
  return {
    tradeId: dto.trade_id,
    ticker: dto.ticker,
    hitType: dto.hit_type,
    hitDate: dto.hit_date,
    entryPrice: Decimal.from(dto.entry_price),
    paperTrade: dto.paper_trade,
    autoOpened: dto.auto_opened,
    message: dto.message,
  }
}

export function mapSLTPAlert(dto: SLTPAlertDTO): SLTPAlert {
  return {
    tradeId: dto.trade_id,
    ticker: dto.ticker,
    hitType: dto.hit_type,
    hitDate: dto.hit_date,
    hitPrice: Decimal.from(dto.hit_price),
    paperTrade: dto.paper_trade,
    autoClosed: dto.auto_closed,
    message: dto.message,
  }
}

export function mapLayeredAlert(dto: LayeredAlertDTO): LayeredAlert {
  return {
    tradeId: dto.trade_id,
    ticker: dto.ticker,
    levelType: dto.level_type,
    levelIndex: dto.level_index,
    hitDate: dto.hit_date,
    hitPrice: Decimal.from(dto.hit_price),
    unitsClosed: dto.units_closed,
    remainingUnits: dto.remaining_units,
    paperTrade: dto.paper_trade,
    autoProcessed: dto.auto_processed,
    message: dto.message,
  }
}

export function mapDetectionResponse(dto: TradeDetectionResponseDTO): {
  entryAlerts: EntryAlert[]
  sltpAlerts: SLTPAlert[]
  layeredAlerts: LayeredAlert[]
  result: DetectionResult
} {
  return {
    entryAlerts: dto.entry_alerts.map(mapEntryAlert),
    sltpAlerts: dto.sltp_alerts.map(mapSLTPAlert),
    layeredAlerts: dto.layered_alerts.map(mapLayeredAlert),
    result: {
      autoOpenedCount: dto.auto_opened_count,
      autoClosedCount: dto.auto_closed_count,
      partialCloseCount: dto.partial_close_count,
      conflictCount: dto.conflict_count,
    },
  }
}
