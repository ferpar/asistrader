import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTradeValidation } from '../src/hooks/useTradeValidation'

describe('useTradeValidation basic validation', () => {
  it('validates valid long trade', () => {
    const { result } = renderHook(() =>
      useTradeValidation({
        entry_price: 100,
        stop_loss: 95,
        take_profit: 110,
        units: 100,
      })
    )
    expect(result.current.isValid).toBe(true)
    expect(result.current.direction).toBe('long')
  })

  it('validates valid short trade', () => {
    const { result } = renderHook(() =>
      useTradeValidation({
        entry_price: 100,
        stop_loss: 105,
        take_profit: 90,
        units: 100,
      })
    )
    expect(result.current.isValid).toBe(true)
    expect(result.current.direction).toBe('short')
  })

  it('rejects zero entry price', () => {
    const { result } = renderHook(() =>
      useTradeValidation({
        entry_price: 0,
        stop_loss: 95,
        take_profit: 110,
        units: 100,
      })
    )
    expect(result.current.isValid).toBe(false)
    expect(result.current.errors).toContainEqual(
      expect.objectContaining({ field: 'entry_price' })
    )
  })
})

describe('useTradeValidation with exit levels', () => {
  it('validates TP levels sum to 100%', () => {
    const { result } = renderHook(() =>
      useTradeValidation({
        entry_price: 100,
        stop_loss: 95,
        take_profit: 110,
        units: 100,
        exit_levels: [
          { level_type: 'tp', price: 110, units_pct: 0.5, move_sl_to_breakeven: false },
          { level_type: 'tp', price: 120, units_pct: 0.5, move_sl_to_breakeven: false },
        ],
      })
    )
    expect(result.current.isValid).toBe(true)
  })

  it('rejects TP levels not summing to 100%', () => {
    const { result } = renderHook(() =>
      useTradeValidation({
        entry_price: 100,
        stop_loss: 95,
        take_profit: 110,
        units: 100,
        exit_levels: [
          { level_type: 'tp', price: 110, units_pct: 0.5, move_sl_to_breakeven: false },
          { level_type: 'tp', price: 120, units_pct: 0.3, move_sl_to_breakeven: false },
          // Missing 20%
        ],
      })
    )
    expect(result.current.isValid).toBe(false)
    expect(result.current.errors).toContainEqual(
      expect.objectContaining({ field: 'exit_levels' })
    )
  })

  it('validates TP prices for long trade', () => {
    const { result } = renderHook(() =>
      useTradeValidation({
        entry_price: 100,
        stop_loss: 95, // Long trade
        take_profit: 110,
        units: 100,
        exit_levels: [
          { level_type: 'tp', price: 90, units_pct: 1.0, move_sl_to_breakeven: false }, // Invalid: below entry
        ],
      })
    )
    expect(result.current.isValid).toBe(false)
  })

  it('validates TP prices for short trade', () => {
    const { result } = renderHook(() =>
      useTradeValidation({
        entry_price: 100,
        stop_loss: 105, // Short trade
        take_profit: 90,
        units: 100,
        exit_levels: [
          { level_type: 'tp', price: 110, units_pct: 1.0, move_sl_to_breakeven: false }, // Invalid: above entry
        ],
      })
    )
    expect(result.current.isValid).toBe(false)
  })

  it('validates SL levels sum to 100%', () => {
    const { result } = renderHook(() =>
      useTradeValidation({
        entry_price: 100,
        stop_loss: 95,
        take_profit: 110,
        units: 100,
        exit_levels: [
          { level_type: 'tp', price: 110, units_pct: 1.0, move_sl_to_breakeven: false },
          { level_type: 'sl', price: 95, units_pct: 0.6, move_sl_to_breakeven: false },
          { level_type: 'sl', price: 90, units_pct: 0.4, move_sl_to_breakeven: false },
        ],
      })
    )
    expect(result.current.isValid).toBe(true)
  })

  it('rejects SL levels not summing to 100%', () => {
    const { result } = renderHook(() =>
      useTradeValidation({
        entry_price: 100,
        stop_loss: 95,
        take_profit: 110,
        units: 100,
        exit_levels: [
          { level_type: 'tp', price: 110, units_pct: 1.0, move_sl_to_breakeven: false },
          { level_type: 'sl', price: 95, units_pct: 0.6, move_sl_to_breakeven: false },
          // Missing 40%
        ],
      })
    )
    expect(result.current.isValid).toBe(false)
    expect(result.current.errors).toContainEqual(
      expect.objectContaining({ field: 'exit_levels' })
    )
  })

  it('allows valid layered trade with multiple TP levels', () => {
    const { result } = renderHook(() =>
      useTradeValidation({
        entry_price: 100,
        stop_loss: 95,
        take_profit: 130, // Main TP
        units: 100,
        exit_levels: [
          { level_type: 'tp', price: 110, units_pct: 0.5, move_sl_to_breakeven: true },
          { level_type: 'tp', price: 120, units_pct: 0.3, move_sl_to_breakeven: false },
          { level_type: 'tp', price: 130, units_pct: 0.2, move_sl_to_breakeven: false },
          { level_type: 'sl', price: 95, units_pct: 1.0, move_sl_to_breakeven: false },
        ],
      })
    )
    expect(result.current.isValid).toBe(true)
    expect(result.current.direction).toBe('long')
  })
})
