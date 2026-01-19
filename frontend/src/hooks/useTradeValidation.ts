import { useMemo } from 'react'
import { ValidationResult, ValidationError, TradeDirection } from '../types/trade'

interface TradeFormValues {
  entry_price: number
  stop_loss: number
  take_profit: number
  units: number
}

export function useTradeValidation(values: TradeFormValues): ValidationResult {
  return useMemo(() => {
    const errors: ValidationError[] = []
    const { entry_price, stop_loss, take_profit, units } = values

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

    return {
      isValid: errors.length === 0,
      errors,
      direction: errors.length === 0 ? direction : null
    }
  }, [values.entry_price, values.stop_loss, values.take_profit, values.units])
}
