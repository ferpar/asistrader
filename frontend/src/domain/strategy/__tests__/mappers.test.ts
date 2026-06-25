import { describe, it, expect } from 'vitest'
import { mapDraftResult, mapEngine, mapStrategy } from '../mappers'
import type { StrategyDTO, StrategyDraftResponseDTO, StrategyEngineDTO } from '../../../types/strategy'

describe('mapStrategy', () => {
  it('maps snake_case to camelCase incl. automated/params', () => {
    const dto: StrategyDTO = {
      id: 3,
      name: 'HED',
      pe_method: 'speed_offset',
      sl_method: 'plr',
      tp_method: 'historical_expected_days',
      description: null,
      automated: true,
      params: { plr_default: 1.5 },
    }
    const s = mapStrategy(dto)
    expect(s).toMatchObject({
      id: 3,
      name: 'HED',
      peMethod: 'speed_offset',
      automated: true,
      params: { plr_default: 1.5 },
    })
  })

  it('defaults automated/params when absent', () => {
    const dto = {
      id: 1, name: 'Manual', pe_method: null, sl_method: null, tp_method: null, description: null,
    } as unknown as StrategyDTO
    const s = mapStrategy(dto)
    expect(s.automated).toBe(false)
    expect(s.params).toBeNull()
  })
})

describe('mapEngine', () => {
  it('maps an engine and normalises optional field props to null', () => {
    const dto: StrategyEngineDTO = {
      id: 'historical_expected_days',
      label: 'Historical Expected Days',
      description: 'desc',
      fields: [
        { key: 'plr_default', label: 'PLR', type: 'number', default: 1.5, step: 0.1 },
        { key: 'order_type_default', label: 'Order type', type: 'select', default: 'limit', options: ['limit', 'stop'] },
      ],
    }
    const e = mapEngine(dto)
    expect(e.id).toBe('historical_expected_days')
    expect(e.fields[0]).toMatchObject({ key: 'plr_default', type: 'number', default: 1.5, step: 0.1, min: null, options: null })
    expect(e.fields[1].options).toEqual(['limit', 'stop'])
  })
})

describe('mapDraftResult', () => {
  it('maps the draft response and its presets', () => {
    const dto: StrategyDraftResponseDTO = {
      confident: true,
      reason: null,
      breakeven_win_rate: 0.4,
      fill_rate: 0.75,
      ticker: 'AAA',
      last_bar_date: '2026-06-16',
      speed: 0.012,
      engine_label: 'Historical Expected Days',
      engine_description: 'desc',
      presets: [
        {
          kind: 'regular',
          d2: 15,
          win_rate: 0.62,
          expectancy: 0.02,
          expectancy_per_day: 0.0013,
          efficiency: 0.001,
          win_rate_ci: [0.5, 0.72],
          efficiency_ci: [0.0005, 0.0015],
          n_trials: 140,
          entry: 100,
          stop_loss: 96,
          take_profit: 106,
        },
      ],
    }
    const r = mapDraftResult(dto)
    expect(r.confident).toBe(true)
    expect(r.breakevenWinRate).toBe(0.4)
    // Absent reference-price fields default to a non-live null anchor.
    expect(r.referencePrice).toBeNull()
    expect(r.referencePriceLive).toBe(false)
    expect(r.engineLabel).toBe('Historical Expected Days')
    expect(r.engineDescription).toBe('desc')
    expect(r.presets).toHaveLength(1)
    expect(r.presets[0]).toMatchObject({
      kind: 'regular',
      d2: 15,
      winRate: 0.62,
      expectancyPerDay: 0.0013,
      winRateCi: [0.5, 0.72],
      stopLoss: 96,
      takeProfit: 106,
    })
  })
})
