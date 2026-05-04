import { useState, useEffect, useMemo, useCallback } from 'react'
import { TradeCreateRequest, ExitLevelCreateRequest, OrderType, TimeInEffect } from '../types/trade'
import type { Strategy } from '../domain/strategy/types'
import type { Ticker } from '../domain/ticker/types'
import { useTradeValidation } from './useTradeValidation'
import { useTradeStore, useStrategyRepo, useTickerStore, useFundStore } from '../container/ContainerContext'
import { localTodayIso } from '../utils/dateOnly'

export interface ExitLevelInput {
  price: string
  units_pct: string
  move_sl_to_breakeven: boolean
}

export function useTradeCreation(initialTicker?: string) {
  const store = useTradeStore()
  const strategyRepo = useStrategyRepo()
  const tickerStore = useTickerStore()
  const fundStore = useFundStore()
  const [tickers, setTickers] = useState<Ticker[]>([])
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [loadingTickers, setLoadingTickers] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentPrice, setCurrentPrice] = useState<number | null>(null)
  const [loadingPrice, setLoadingPrice] = useState(false)

  const [formData, setFormData] = useState({
    ticker: '',
    entry_price: '',
    stop_loss: '',
    take_profit: '',
    units: '',
    date_planned: localTodayIso(),
    strategy_id: '',
    auto_detect: false,
    order_type: '' as OrderType | '',
    time_in_effect: '' as TimeInEffect | '',
    gtd_date: '',
  })

  const [layeredMode, setLayeredMode] = useState(false)
  const [tpLevels, setTpLevels] = useState<ExitLevelInput[]>([
    { price: '', units_pct: '50', move_sl_to_breakeven: true },
    { price: '', units_pct: '30', move_sl_to_breakeven: false },
    { price: '', units_pct: '20', move_sl_to_breakeven: false },
  ])

  useEffect(() => {
    const loadData = async () => {
      try {
        const [loadedTickers, loadedStrategies] = await Promise.all([
          tickerStore.loadTickers().then(() => tickerStore.tickers$.get()),
          strategyRepo.fetchStrategies(),
        ])
        setTickers(loadedTickers)
        setStrategies(loadedStrategies)
        const defaultSymbol = initialTicker ?? (loadedTickers.length > 0 ? loadedTickers[0].symbol : '')
        if (defaultSymbol) {
          setFormData(prev => ({ ...prev, ticker: defaultSymbol }))
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data')
      } finally {
        setLoadingTickers(false)
      }
    }
    loadData()
  }, [])

  const loadCurrentPrice = useCallback(async (symbol: string) => {
    if (!symbol) {
      setCurrentPrice(null)
      return
    }
    setLoadingPrice(true)
    try {
      const response = await tickerStore.fetchTickerPrice(symbol)
      setCurrentPrice(response.valid ? response.price : null)
    } catch {
      setCurrentPrice(null)
    } finally {
      setLoadingPrice(false)
    }
  }, [tickerStore])

  useEffect(() => {
    loadCurrentPrice(formData.ticker)
  }, [formData.ticker, loadCurrentPrice])

  const preview = useMemo(() => {
    const entryPrice = parseFloat(formData.entry_price) || 0
    const units = parseInt(formData.units) || 0
    const stopLoss = parseFloat(formData.stop_loss) || 0

    let takeProfit: number

    if (layeredMode) {
      const validTpLevels = tpLevels.filter(l => l.price && l.units_pct)
      if (validTpLevels.length > 0) {
        const totalPct = validTpLevels.reduce((sum, l) => sum + (parseFloat(l.units_pct) || 0), 0)
        takeProfit = validTpLevels.reduce((sum, l) => {
          const price = parseFloat(l.price) || 0
          const pct = parseFloat(l.units_pct) || 0
          return sum + (price * pct)
        }, 0) / (totalPct || 1)
      } else {
        takeProfit = 0
      }
    } else {
      takeProfit = parseFloat(formData.take_profit) || 0
    }

    const amount = entryPrice * units
    const riskAbs = (stopLoss - entryPrice) * units
    const profitAbs = (takeProfit - entryPrice) * units
    const riskPct = amount !== 0 ? riskAbs / amount : 0
    const profitPct = amount !== 0 ? profitAbs / amount : 0
    const ratio = riskAbs !== 0 ? -profitAbs / riskAbs : 0

    return { amount, riskAbs, profitAbs, riskPct, profitPct, ratio }
  }, [formData.entry_price, formData.stop_loss, formData.take_profit, formData.units, layeredMode, tpLevels])

  const exitLevelsForValidation = useMemo((): ExitLevelCreateRequest[] | undefined => {
    if (!layeredMode) return undefined

    const levels: ExitLevelCreateRequest[] = []

    for (const level of tpLevels) {
      if (level.price) {
        levels.push({
          level_type: 'tp',
          price: parseFloat(level.price) || 0,
          units_pct: (parseFloat(level.units_pct) || 0) / 100,
          move_sl_to_breakeven: level.move_sl_to_breakeven,
        })
      }
    }

    const slPrice = parseFloat(formData.stop_loss)
    if (slPrice) {
      levels.push({
        level_type: 'sl',
        price: slPrice,
        units_pct: 1.0,
        move_sl_to_breakeven: false,
      })
    }

    return levels.length > 0 ? levels : undefined
  }, [layeredMode, tpLevels, formData.stop_loss])

  const validationValues = useMemo(() => {
    const stopLoss = parseFloat(formData.stop_loss) || 0

    let takeProfit: number
    if (layeredMode && exitLevelsForValidation && exitLevelsForValidation.length > 0) {
      const tpLevelsArr = exitLevelsForValidation.filter(l => l.level_type === 'tp')
      if (tpLevelsArr.length > 0) {
        const totalPct = tpLevelsArr.reduce((sum, l) => sum + l.units_pct, 0)
        takeProfit = tpLevelsArr.reduce((sum, l) => sum + (l.price * l.units_pct), 0) / (totalPct || 1)
      } else {
        takeProfit = 0
      }
    } else {
      takeProfit = parseFloat(formData.take_profit) || 0
    }

    return {
      entry_price: parseFloat(formData.entry_price) || 0,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      units: parseInt(formData.units) || 0,
      exit_levels: exitLevelsForValidation,
    }
  }, [formData.entry_price, formData.stop_loss, formData.take_profit, formData.units, exitLevelsForValidation, layeredMode])

  const suggestedUnits = useMemo(() => {
    const entryPrice = parseFloat(formData.entry_price) || 0
    if (entryPrice <= 0) return null
    const balance = fundStore.balance$.get()
    if (balance === null) return null
    const maxPerTrade = balance.maxPerTrade.toNumber()
    if (maxPerTrade <= 0) return null
    const units = Math.floor(maxPerTrade / entryPrice)
    return units > 0 ? units : null
  }, [formData.entry_price, fundStore])

  const applySuggestedUnits = () => {
    if (suggestedUnits !== null) {
      setFormData(prev => ({ ...prev, units: String(suggestedUnits) }))
    }
  }

  const validation = useTradeValidation(validationValues)

  const getFieldError = (field: string) =>
    validation.errors.find(e => e.field === field)?.message ?? null

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
    setError(null)
  }

  const resetForm = () => {
    setFormData({
      ticker: initialTicker ?? (tickers.length > 0 ? tickers[0].symbol : ''),
      entry_price: '',
      stop_loss: '',
      take_profit: '',
      units: '',
      date_planned: localTodayIso(),
      strategy_id: '',
      auto_detect: false,
      order_type: '',
      time_in_effect: '',
      gtd_date: '',
    })
    setLayeredMode(false)
    setTpLevels([
      { price: '', units_pct: '50', move_sl_to_breakeven: true },
      { price: '', units_pct: '30', move_sl_to_breakeven: false },
      { price: '', units_pct: '20', move_sl_to_breakeven: false },
    ])
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validation.isValid) {
      setError('Please fix the validation errors')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      let exitLevelsToSend: ExitLevelCreateRequest[]

      if (layeredMode && exitLevelsForValidation && exitLevelsForValidation.length > 0) {
        exitLevelsToSend = exitLevelsForValidation
      } else {
        const stopLoss = parseFloat(formData.stop_loss)
        const takeProfit = parseFloat(formData.take_profit)
        exitLevelsToSend = [
          { level_type: 'sl', price: stopLoss, units_pct: 1.0, move_sl_to_breakeven: false },
          { level_type: 'tp', price: takeProfit, units_pct: 1.0, move_sl_to_breakeven: false },
        ]
      }

      const request: TradeCreateRequest = {
        ticker: formData.ticker,
        entry_price: parseFloat(formData.entry_price),
        units: parseInt(formData.units),
        date_planned: formData.date_planned,
        strategy_id: formData.strategy_id ? parseInt(formData.strategy_id) : null,
        auto_detect: formData.auto_detect,
        exit_levels: exitLevelsToSend,
        order_type: formData.order_type ? formData.order_type as OrderType : null,
        time_in_effect: formData.time_in_effect ? formData.time_in_effect as TimeInEffect : null,
        gtd_date: formData.time_in_effect === 'gtd' && formData.gtd_date ? formData.gtd_date : null,
      }
      await store.createTrade(request)
      resetForm()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create trade')
      return false
    } finally {
      setSubmitting(false)
    }
  }

  const addTicker = (newTicker: Ticker) => {
    setTickers(prev => [...prev, newTicker].sort((a, b) => a.symbol.localeCompare(b.symbol)))
  }

  const selectTicker = (symbol: string) => {
    setFormData(prev => ({ ...prev, ticker: symbol }))
  }

  const setAutoDetect = (checked: boolean) => {
    setFormData(prev => ({ ...prev, auto_detect: checked }))
  }

  return {
    formData,
    layeredMode,
    setLayeredMode,
    tpLevels,
    setTpLevels,
    tickers,
    strategies,
    loadingTickers,
    submitting,
    error,
    currentPrice,
    loadingPrice,
    preview,
    suggestedUnits,
    applySuggestedUnits,
    validation,
    getFieldError,
    handleChange,
    handleSubmit,
    resetForm,
    addTicker,
    selectTicker,
    setAutoDetect,
  }
}
