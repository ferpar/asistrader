import { describe, it, expect } from 'vitest'
import { Decimal } from '../../shared/Decimal'
import { mapTrade, mapExitLevel, mapPriceData, mapEntryAlert, mapSLTPAlert, mapLayeredAlert, mapDetectionResponse } from '../mappers'
import type { Trade, ExitLevel, PriceData, EntryAlert, SLTPAlert, LayeredAlert, TradeDetectionResponse } from '../../../types/trade'

describe('mapExitLevel', () => {
  it('maps all fields correctly', () => {
    const dto: ExitLevel = {
      id: 1,
      trade_id: 10,
      level_type: 'tp',
      price: 170,
      units_pct: 0.5,
      order_index: 1,
      status: 'hit',
      hit_date: '2025-01-17',
      units_closed: 5,
      move_sl_to_breakeven: true,
    }

    const result = mapExitLevel(dto)

    expect(result.id).toBe(1)
    expect(result.tradeId).toBe(10)
    expect(result.levelType).toBe('tp')
    expect(result.price).toBeInstanceOf(Decimal)
    expect(result.price.toNumber()).toBe(170)
    expect(result.unitsPct).toBeInstanceOf(Decimal)
    expect(result.unitsPct.toNumber()).toBe(0.5)
    expect(result.orderIndex).toBe(1)
    expect(result.status).toBe('hit')
    expect(result.hitDate).toBeInstanceOf(Date)
    expect(result.unitsClosed).toBe(5)
    expect(result.moveSlToBreakeven).toBe(true)
  })

  it('maps null hit_date to null', () => {
    const dto: ExitLevel = {
      id: 2,
      trade_id: 10,
      level_type: 'sl',
      price: 140,
      units_pct: 1.0,
      order_index: 1,
      status: 'pending',
      hit_date: null,
      units_closed: null,
      move_sl_to_breakeven: false,
    }

    const result = mapExitLevel(dto)

    expect(result.hitDate).toBeNull()
    expect(result.unitsClosed).toBeNull()
  })
})

describe('mapTrade', () => {
  const dto: Trade = {
    id: 1,
    number: 1,
    ticker: 'AAPL',
    status: 'open',
    amount: 1500,
    units: 10,
    entry_price: 150,
    stop_loss: 140,
    take_profit: 170,
    date_planned: '2025-01-10',
    date_actual: '2025-01-11',
    exit_date: null,
    exit_type: null,
    exit_price: null,
    paper_trade: false,
    is_layered: false,
    remaining_units: null,
    exit_levels: [],
    strategy_id: 1,
    strategy_name: 'Swing',
    risk_abs: -100,
    profit_abs: 200,
    risk_pct: -0.0667,
    profit_pct: 0.1333,
    ratio: 2.0,
  }

  it('maps trade fields to camelCase with Decimal', () => {
    const result = mapTrade(dto)

    expect(result.id).toBe(1)
    expect(result.number).toBe(1)
    expect(result.ticker).toBe('AAPL')
    expect(result.status).toBe('open')
    expect(result.amount).toBeInstanceOf(Decimal)
    expect(result.amount.toNumber()).toBe(1500)
    expect(result.units).toBe(10)
    expect(result.entryPrice.toNumber()).toBe(150)
    expect(result.stopLoss.toNumber()).toBe(140)
    expect(result.takeProfit.toNumber()).toBe(170)
    expect(result.paperTrade).toBe(false)
    expect(result.isLayered).toBe(false)
    expect(result.strategyId).toBe(1)
    expect(result.strategyName).toBe('Swing')
  })

  it('maps dates as Date objects', () => {
    const result = mapTrade(dto)

    expect(result.datePlanned).toBeInstanceOf(Date)
    expect(result.dateActual).toBeInstanceOf(Date)
    expect(result.exitDate).toBeNull()
  })

  it('maps metrics as Decimal', () => {
    const result = mapTrade(dto)

    expect(result.riskAbs).toBeInstanceOf(Decimal)
    expect(result.riskAbs.toNumber()).toBe(-100)
    expect(result.profitAbs.toNumber()).toBe(200)
    expect(result.riskPct.toNumber()).toBe(-0.0667)
    expect(result.profitPct.toNumber()).toBe(0.1333)
    expect(result.ratio.toNumber()).toBe(2.0)
  })

  it('maps null exitPrice to null', () => {
    const result = mapTrade(dto)
    expect(result.exitPrice).toBeNull()
  })

  it('maps non-null exitPrice to Decimal', () => {
    const result = mapTrade({ ...dto, exit_price: 165 })
    expect(result.exitPrice).toBeInstanceOf(Decimal)
    expect(result.exitPrice!.toNumber()).toBe(165)
  })

  it('maps exit_levels', () => {
    const tradeWithLevels: Trade = {
      ...dto,
      is_layered: true,
      exit_levels: [{
        id: 1,
        trade_id: 1,
        level_type: 'tp',
        price: 170,
        units_pct: 1.0,
        order_index: 1,
        status: 'pending',
        hit_date: null,
        units_closed: null,
        move_sl_to_breakeven: false,
      }],
    }

    const result = mapTrade(tradeWithLevels)
    expect(result.exitLevels).toHaveLength(1)
    expect(result.exitLevels[0].price).toBeInstanceOf(Decimal)
  })
})

describe('mapPriceData', () => {
  it('maps valid price', () => {
    const dto: PriceData = { price: 155, currency: 'USD', valid: true }
    const result = mapPriceData(dto)

    expect(result.price).toBeInstanceOf(Decimal)
    expect(result.price!.toNumber()).toBe(155)
    expect(result.currency).toBe('USD')
    expect(result.valid).toBe(true)
  })

  it('maps null price', () => {
    const dto: PriceData = { price: null, currency: null, valid: false }
    const result = mapPriceData(dto)

    expect(result.price).toBeNull()
    expect(result.currency).toBeNull()
    expect(result.valid).toBe(false)
  })
})

describe('mapEntryAlert', () => {
  it('maps all fields', () => {
    const dto: EntryAlert = {
      trade_id: 1,
      ticker: 'AAPL',
      hit_type: 'entry',
      hit_date: '2025-01-15',
      entry_price: 150,
      paper_trade: true,
      auto_opened: true,
      message: 'auto opened',
    }

    const result = mapEntryAlert(dto)

    expect(result.tradeId).toBe(1)
    expect(result.ticker).toBe('AAPL')
    expect(result.hitType).toBe('entry')
    expect(result.hitDate).toBe('2025-01-15')
    expect(result.entryPrice).toBeInstanceOf(Decimal)
    expect(result.entryPrice.toNumber()).toBe(150)
    expect(result.paperTrade).toBe(true)
    expect(result.autoOpened).toBe(true)
    expect(result.message).toBe('auto opened')
  })
})

describe('mapSLTPAlert', () => {
  it('maps all fields', () => {
    const dto: SLTPAlert = {
      trade_id: 2,
      ticker: 'MSFT',
      hit_type: 'sl',
      hit_date: '2025-01-15',
      hit_price: 140,
      paper_trade: true,
      auto_closed: true,
      message: 'auto closed',
    }

    const result = mapSLTPAlert(dto)

    expect(result.tradeId).toBe(2)
    expect(result.hitPrice).toBeInstanceOf(Decimal)
    expect(result.hitPrice.toNumber()).toBe(140)
    expect(result.autoClosed).toBe(true)
  })
})

describe('mapLayeredAlert', () => {
  it('maps all fields', () => {
    const dto: LayeredAlert = {
      trade_id: 3,
      ticker: 'GOOG',
      level_type: 'tp',
      level_index: 1,
      hit_date: '2025-01-15',
      hit_price: 180,
      units_closed: 5,
      remaining_units: 10,
      paper_trade: false,
      auto_processed: true,
      message: 'TP1 hit',
    }

    const result = mapLayeredAlert(dto)

    expect(result.tradeId).toBe(3)
    expect(result.levelType).toBe('tp')
    expect(result.levelIndex).toBe(1)
    expect(result.hitPrice).toBeInstanceOf(Decimal)
    expect(result.unitsClosed).toBe(5)
    expect(result.remainingUnits).toBe(10)
    expect(result.autoProcessed).toBe(true)
  })
})

describe('mapDetectionResponse', () => {
  it('maps full detection response', () => {
    const dto: TradeDetectionResponse = {
      entry_alerts: [{
        trade_id: 1,
        ticker: 'AAPL',
        hit_type: 'entry',
        hit_date: '2025-01-15',
        entry_price: 150,
        paper_trade: true,
        auto_opened: true,
        message: 'opened',
      }],
      sltp_alerts: [{
        trade_id: 2,
        ticker: 'MSFT',
        hit_type: 'sl',
        hit_date: '2025-01-15',
        hit_price: 140,
        paper_trade: true,
        auto_closed: true,
        message: 'closed',
      }],
      layered_alerts: [],
      auto_opened_count: 1,
      auto_closed_count: 1,
      partial_close_count: 0,
      conflict_count: 2,
    }

    const result = mapDetectionResponse(dto)

    expect(result.entryAlerts).toHaveLength(1)
    expect(result.entryAlerts[0].tradeId).toBe(1)
    expect(result.sltpAlerts).toHaveLength(1)
    expect(result.sltpAlerts[0].tradeId).toBe(2)
    expect(result.layeredAlerts).toHaveLength(0)
    expect(result.result.autoOpenedCount).toBe(1)
    expect(result.result.autoClosedCount).toBe(1)
    expect(result.result.partialCloseCount).toBe(0)
    expect(result.result.conflictCount).toBe(2)
  })
})
