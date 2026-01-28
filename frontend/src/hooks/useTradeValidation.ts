import { useMemo } from 'react'
import { ValidationResult, ValidationError, TradeDirection, ExitLevelCreateRequest } from '../types/trade'

interface TradeFormValues {
  entry_price: number
  stop_loss: number
  take_profit: number
  units: number
  exit_levels?: ExitLevelCreateRequest[]
}

export function useTradeValidation(values: TradeFormValues): ValidationResult {
  return useMemo(() => {
    const errors: ValidationError[] = []
    const { entry_price, stop_loss, take_profit, units, exit_levels } = values

    // Positive number validation
    if (entry_price <= 0) errors.push({ field: 'entry_price', message: 'Must be positive' })
    if (stop_loss <= 0) errors.push({ field: 'stop_loss', message: 'Must be positive' })
    if (take_profit <= 0) errors.push({ field: 'take_profit', message: 'Must be positive' })
    if (units <= 0) errors.push({ field: 'units', message: 'Must be positive' })

    // All prices must be different
    if (entry_price > 0 && entry_price === stop_loss)
      errors.push({ field: 'stop_loss', message: 'Cannot equal entry price' })
    if (entry_price > 0 && entry_price === take_profit)
      errors.push({ field: 'take_profit', message: 'Cannot equal entry price' })
    if (stop_loss > 0 && stop_loss === take_profit)
      errors.push({ field: 'take_profit', message: 'Cannot equal stop loss' })

    // Detect direction and validate price relationship
    let direction: TradeDirection | null = null
    if (entry_price > 0 && stop_loss > 0 && stop_loss !== entry_price) {
      direction = stop_loss < entry_price ? 'long' : 'short'

      if (direction === 'long' && take_profit > 0 && take_profit <= entry_price) {
        errors.push({ field: 'take_profit', message: 'Must be above entry for long trades' })
      }
      if (direction === 'short' && take_profit > 0 && take_profit >= entry_price) {
        errors.push({ field: 'take_profit', message: 'Must be below entry for short trades' })
      }
    }

    // Validate exit levels if provided
    if (exit_levels && exit_levels.length > 0) {
      const tpLevels = exit_levels.filter(l => l.level_type === 'tp')
      const slLevels = exit_levels.filter(l => l.level_type === 'sl')

      // Validate TP levels sum to 100%
      if (tpLevels.length > 0) {
        const tpSum = tpLevels.reduce((sum, l) => sum + l.units_pct, 0)
        if (Math.abs(tpSum - 1.0) > 0.001) {
          errors.push({
            field: 'exit_levels',
            message: `TP levels must sum to 100%, got ${(tpSum * 100).toFixed(0)}%`
          })
        }

        // Validate TP prices based on direction
        if (direction) {
          for (const level of tpLevels) {
            if (direction === 'long' && level.price <= entry_price) {
              errors.push({
                field: 'exit_levels',
                message: `TP at $${level.price} must be above entry for long trades`
              })
            }
            if (direction === 'short' && level.price >= entry_price) {
              errors.push({
                field: 'exit_levels',
                message: `TP at $${level.price} must be below entry for short trades`
              })
            }
          }
        }
      }

      // Validate SL levels sum to 100%
      if (slLevels.length > 0) {
        const slSum = slLevels.reduce((sum, l) => sum + l.units_pct, 0)
        if (Math.abs(slSum - 1.0) > 0.001) {
          errors.push({
            field: 'exit_levels',
            message: `SL levels must sum to 100%, got ${(slSum * 100).toFixed(0)}%`
          })
        }

        // Validate SL prices based on direction
        if (direction) {
          for (const level of slLevels) {
            if (direction === 'long' && level.price >= entry_price) {
              errors.push({
                field: 'exit_levels',
                message: `SL at $${level.price} must be below entry for long trades`
              })
            }
            if (direction === 'short' && level.price <= entry_price) {
              errors.push({
                field: 'exit_levels',
                message: `SL at $${level.price} must be above entry for short trades`
              })
            }
          }
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      direction: errors.length === 0 ? direction : null
    }
  }, [values.entry_price, values.stop_loss, values.take_profit, values.units, values.exit_levels])
}
