import { Decimal } from '../shared/Decimal'
import { parseDateOnly } from '../../utils/dateOnly'
import type {
  TradeDTO,
  ExitLevelDTO,
  PriceDataDTO,
  EntryAlertDTO,
  SLTPAlertDTO,
  LayeredAlertDTO,
  TradeDetectionResponseDTO,
  LevelCheckDTO,
  BarEvalDTO,
  ScanTraceDTO,
  DetectionTraceResponseDTO,
} from '../../types/trade'
import type {
  TradeWithMetrics,
  ExitLevel,
  PriceData,
  EntryAlert,
  SLTPAlert,
  LayeredAlert,
  DetectionResult,
  LevelCheck,
  BarEval,
  ScanTrace,
  DetectionTraceResult,
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
    hitDate: dto.hit_date ? parseDateOnly(dto.hit_date) : null,
    unitsClosed: dto.units_closed,
    moveSlToBreakeven: dto.move_sl_to_breakeven,
  }
}

export function mapTrade(dto: TradeDTO): TradeWithMetrics {
  return {
    id: dto.id,
    number: dto.number,
    ticker: dto.ticker,
    tickerName: dto.ticker_name,
    tickerCurrency: dto.ticker_currency,
    tickerPriceHint: dto.ticker_price_hint,
    status: dto.status,
    amount: Decimal.from(dto.amount),
    units: dto.units,
    remainingUnits: dto.remaining_units,
    entryPrice: Decimal.from(dto.entry_price),
    stopLoss: Decimal.from(dto.stop_loss),
    takeProfit: Decimal.from(dto.take_profit),
    datePlanned: parseDateOnly(dto.date_planned),
    dateActual: dto.date_actual ? parseDateOnly(dto.date_actual) : null,
    exitDate: dto.exit_date ? parseDateOnly(dto.exit_date) : null,
    exitType: dto.exit_type,
    exitPrice: dto.exit_price !== null ? Decimal.from(dto.exit_price) : null,
    orderType: dto.order_type,
    timeInEffect: dto.time_in_effect,
    gtdDate: dto.gtd_date ? parseDateOnly(dto.gtd_date) : null,
    autoDetect: dto.auto_detect,
    isLayered: dto.is_layered,
    exitLevels: dto.exit_levels.map(mapExitLevel),
    strategyId: dto.strategy_id,
    strategyName: dto.strategy_name,
    cancelReason: dto.cancel_reason,
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
    autoDetect: dto.auto_detect,
    autoOpened: dto.auto_opened,
    currency: dto.currency,
    priceHint: dto.price_hint,
    alertKind: dto.alert_kind,
    levelKey: dto.level_key,
    dismissed: dto.dismissed,
    hitKind: dto.hit_kind,
    barOpen: dto.bar_open !== null ? Decimal.from(dto.bar_open) : null,
    prevClose: dto.prev_close !== null ? Decimal.from(dto.prev_close) : null,
  }
}

export function mapSLTPAlert(dto: SLTPAlertDTO): SLTPAlert {
  return {
    tradeId: dto.trade_id,
    ticker: dto.ticker,
    hitType: dto.hit_type,
    hitDate: dto.hit_date,
    hitPrice: Decimal.from(dto.hit_price),
    autoDetect: dto.auto_detect,
    autoClosed: dto.auto_closed,
    currency: dto.currency,
    priceHint: dto.price_hint,
    alertKind: dto.alert_kind,
    levelKey: dto.level_key,
    dismissed: dto.dismissed,
    hitKind: dto.hit_kind,
    barOpen: dto.bar_open !== null ? Decimal.from(dto.bar_open) : null,
    prevClose: dto.prev_close !== null ? Decimal.from(dto.prev_close) : null,
    alsoWouldHaveHit: dto.also_would_have_hit ?? [],
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
    autoDetect: dto.auto_detect,
    autoProcessed: dto.auto_processed,
    currency: dto.currency,
    priceHint: dto.price_hint,
    alertKind: dto.alert_kind,
    levelKey: dto.level_key,
    dismissed: dto.dismissed,
    hitKind: dto.hit_kind,
    barOpen: dto.bar_open !== null ? Decimal.from(dto.bar_open) : null,
    prevClose: dto.prev_close !== null ? Decimal.from(dto.prev_close) : null,
    alsoWouldHaveHit: dto.also_would_have_hit ?? [],
  }
}

function mapLevelCheck(dto: LevelCheckDTO): LevelCheck {
  return {
    key: dto.key,
    kind: dto.kind,
    side: dto.side,
    price: Decimal.from(dto.price),
    threshold: Decimal.from(dto.threshold),
    pierced: dto.pierced,
    gap: dto.gap,
  }
}

function mapBarEval(dto: BarEvalDTO): BarEval {
  return {
    date: dto.date,
    open: dto.open !== null ? Decimal.from(dto.open) : null,
    high: dto.high !== null ? Decimal.from(dto.high) : null,
    low: dto.low !== null ? Decimal.from(dto.low) : null,
    close: dto.close !== null ? Decimal.from(dto.close) : null,
    prevClose: dto.prev_close !== null ? Decimal.from(dto.prev_close) : null,
    checks: dto.checks.map(mapLevelCheck),
    decision: dto.decision,
    chosenKeys: dto.chosen_keys,
    reason: dto.reason,
  }
}

function mapScanTrace(dto: ScanTraceDTO): ScanTrace {
  return {
    kind: dto.kind,
    tradeId: dto.trade_id,
    side: dto.side,
    margin: Decimal.from(dto.margin),
    scanFrom: dto.scan_from,
    scanTo: dto.scan_to,
    barsScanned: dto.bars_scanned,
    bars: dto.bars.map(mapBarEval),
    verdict: dto.verdict,
    extras: dto.extras,
  }
}

export function mapDetectionTraceResponse(
  dto: DetectionTraceResponseDTO,
): DetectionTraceResult {
  return {
    trace: mapScanTrace(dto.trace),
    detectorKind: dto.detector_kind,
    whatIf: dto.what_if,
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
