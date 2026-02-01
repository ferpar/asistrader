import { useState, useEffect, useMemo, useCallback } from 'react'
import { TradeCreateRequest, ExitLevelCreateRequest } from '../types/trade'
import type { Strategy } from '../domain/strategy/types'
import type { Ticker } from '../domain/ticker/types'
import { TickerSearchInput } from './TickerSearchInput'
import { useTradeValidation } from '../hooks/useTradeValidation'
import { useTradeStore, useStrategyRepo, useTickerStore } from '../container/ContainerContext'

interface ExitLevelInput {
  price: string
  units_pct: string
  move_sl_to_breakeven: boolean
}

export function TradeCreationForm() {
  const store = useTradeStore()
  const strategyRepo = useStrategyRepo()
  const tickerStore = useTickerStore()
  const [tickers, setTickers] = useState<Ticker[]>([])
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [loadingTickers, setLoadingTickers] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(true)
  const [currentPrice, setCurrentPrice] = useState<number | null>(null)
  const [loadingPrice, setLoadingPrice] = useState(false)

  const [formData, setFormData] = useState({
    ticker: '',
    entry_price: '',
    stop_loss: '',
    take_profit: '',
    units: '',
    date_planned: new Date().toISOString().split('T')[0],
    strategy_id: '',
    paper_trade: false,
  })

  const [layeredMode, setLayeredMode] = useState(false)
  const [tpLevels, setTpLevels] = useState<ExitLevelInput[]>([
    { price: '', units_pct: '50', move_sl_to_breakeven: true },
    { price: '', units_pct: '30', move_sl_to_breakeven: false },
    { price: '', units_pct: '20', move_sl_to_breakeven: false },
  ])
  const [slLevels, setSlLevels] = useState<ExitLevelInput[]>([
    { price: '', units_pct: '100', move_sl_to_breakeven: false },
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
        if (loadedTickers.length > 0) {
          setFormData(prev => ({ ...prev, ticker: loadedTickers[0].symbol }))
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

    let stopLoss: number
    let takeProfit: number

    if (layeredMode) {
      // Derive from exit levels using weighted averages
      // SL: weighted average of SL levels
      const validSlLevels = slLevels.filter(l => l.price && l.units_pct)
      if (validSlLevels.length > 0) {
        const totalPct = validSlLevels.reduce((sum, l) => sum + (parseFloat(l.units_pct) || 0), 0)
        stopLoss = validSlLevels.reduce((sum, l) => {
          const price = parseFloat(l.price) || 0
          const pct = parseFloat(l.units_pct) || 0
          return sum + (price * pct)
        }, 0) / (totalPct || 1)
      } else {
        stopLoss = 0
      }

      // TP: weighted average of TP levels
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
      stopLoss = parseFloat(formData.stop_loss) || 0
      takeProfit = parseFloat(formData.take_profit) || 0
    }

    const amount = entryPrice * units
    const riskAbs = (stopLoss - entryPrice) * units
    const profitAbs = (takeProfit - entryPrice) * units
    const riskPct = amount !== 0 ? riskAbs / amount : 0
    const profitPct = amount !== 0 ? profitAbs / amount : 0
    const ratio = riskAbs !== 0 ? -profitAbs / riskAbs : 0

    return { amount, riskAbs, profitAbs, riskPct, profitPct, ratio }
  }, [formData.entry_price, formData.stop_loss, formData.take_profit, formData.units, layeredMode, tpLevels, slLevels])

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

    for (const level of slLevels) {
      if (level.price) {
        levels.push({
          level_type: 'sl',
          price: parseFloat(level.price) || 0,
          units_pct: (parseFloat(level.units_pct) || 0) / 100,
          move_sl_to_breakeven: false,
        })
      }
    }

    return levels.length > 0 ? levels : undefined
  }, [layeredMode, tpLevels, slLevels])

  const validationValues = useMemo(() => {
    let stopLoss: number
    let takeProfit: number

    if (layeredMode && exitLevelsForValidation && exitLevelsForValidation.length > 0) {
      // Derive from exit levels using weighted averages
      const slLevelsArr = exitLevelsForValidation.filter(l => l.level_type === 'sl')
      if (slLevelsArr.length > 0) {
        const totalPct = slLevelsArr.reduce((sum, l) => sum + l.units_pct, 0)
        stopLoss = slLevelsArr.reduce((sum, l) => sum + (l.price * l.units_pct), 0) / (totalPct || 1)
      } else {
        stopLoss = 0
      }

      const tpLevelsArr = exitLevelsForValidation.filter(l => l.level_type === 'tp')
      if (tpLevelsArr.length > 0) {
        const totalPct = tpLevelsArr.reduce((sum, l) => sum + l.units_pct, 0)
        takeProfit = tpLevelsArr.reduce((sum, l) => sum + (l.price * l.units_pct), 0) / (totalPct || 1)
      } else {
        takeProfit = 0
      }
    } else {
      stopLoss = parseFloat(formData.stop_loss) || 0
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

  const validation = useTradeValidation(validationValues)

  const getFieldError = (field: string) =>
    validation.errors.find(e => e.field === field)?.message ?? null

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
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
      // Always create exit_levels - even for simple mode
      let exitLevelsToSend: ExitLevelCreateRequest[]

      if (layeredMode && exitLevelsForValidation && exitLevelsForValidation.length > 0) {
        exitLevelsToSend = exitLevelsForValidation
      } else {
        // Simple mode: create 1 SL + 1 TP exit level
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
        paper_trade: formData.paper_trade,
        exit_levels: exitLevelsToSend,
      }
      await store.createTrade(request)
      // Reset form
      setFormData({
        ticker: tickers.length > 0 ? tickers[0].symbol : '',
        entry_price: '',
        stop_loss: '',
        take_profit: '',
        units: '',
        date_planned: new Date().toISOString().split('T')[0],
        strategy_id: '',
        paper_trade: false,
      })
      setLayeredMode(false)
      setTpLevels([
        { price: '', units_pct: '50', move_sl_to_breakeven: true },
        { price: '', units_pct: '30', move_sl_to_breakeven: false },
        { price: '', units_pct: '20', move_sl_to_breakeven: false },
      ])
      setSlLevels([
        { price: '', units_pct: '100', move_sl_to_breakeven: false },
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create trade')
    } finally {
      setSubmitting(false)
    }
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value)
  }

  const formatPercent = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'percent',
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(value)
  }

  if (loadingTickers) {
    return <div className="trade-form">Loading tickers...</div>
  }

  return (
    <div className={`trade-form ${collapsed ? 'collapsed' : ''}`}>
      <div className="trade-form-header" onClick={() => setCollapsed(!collapsed)}>
        <h3>New Trade</h3>
        <button type="button" className="collapse-toggle">
          {collapsed ? '+' : '-'}
        </button>
      </div>

      {!collapsed && (
        <form onSubmit={handleSubmit}>
          {error && <div className="form-error">{error}</div>}

          <div className="form-row">
        <div className="form-group">
          <label htmlFor="ticker">Ticker</label>
          <TickerSearchInput
            existingTickers={tickers}
            selectedTicker={formData.ticker}
            onTickerSelect={(symbol) => setFormData(prev => ({ ...prev, ticker: symbol }))}
            onTickerCreated={(newTicker) => {
              setTickers(prev => [...prev, newTicker].sort((a, b) => a.symbol.localeCompare(b.symbol)))
            }}
          />
        </div>

        <div className="form-group">
          <label htmlFor="date_planned">Planned Date</label>
          <input
            type="date"
            id="date_planned"
            name="date_planned"
            value={formData.date_planned}
            onChange={handleChange}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="strategy_id">Strategy</label>
          <select
            id="strategy_id"
            name="strategy_id"
            value={formData.strategy_id}
            onChange={handleChange}
          >
            <option value="">None</option>
            {strategies.map((strategy) => (
              <option key={strategy.id} value={strategy.id}>
                {strategy.name}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group form-group-checkbox">
          <label htmlFor="paper_trade">
            <input
              type="checkbox"
              id="paper_trade"
              checked={formData.paper_trade}
              onChange={(e) => setFormData(prev => ({ ...prev, paper_trade: e.target.checked }))}
            />
            Paper Trade
          </label>
          <span className="form-hint">Auto-close on SL/TP hit</span>
        </div>

        <div className="form-group form-group-checkbox">
          <label htmlFor="layered_mode">
            <input
              type="checkbox"
              id="layered_mode"
              checked={layeredMode}
              onChange={(e) => setLayeredMode(e.target.checked)}
            />
            Layered Exits
          </label>
          <span className="form-hint">Multiple TP/SL levels</span>
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label htmlFor="entry_price">
            Entry Price
            {loadingPrice && <span className="current-price-hint loading">Loading...</span>}
            {!loadingPrice && currentPrice !== null && (
              <span className="current-price-hint">
                Current: {formatCurrency(currentPrice)}
              </span>
            )}
          </label>
          <input
            type="number"
            id="entry_price"
            name="entry_price"
            className={getFieldError('entry_price') ? 'input-error' : ''}
            value={formData.entry_price}
            onChange={handleChange}
            step="0.01"
            min="0"
            required
          />
          {getFieldError('entry_price') && <span className="field-error">{getFieldError('entry_price')}</span>}
        </div>

        {!layeredMode && (
          <>
            <div className="form-group">
              <label htmlFor="stop_loss">Stop Loss</label>
              <input
                type="number"
                id="stop_loss"
                name="stop_loss"
                className={getFieldError('stop_loss') ? 'input-error' : ''}
                value={formData.stop_loss}
                onChange={handleChange}
                step="0.01"
                min="0"
                required
              />
              {getFieldError('stop_loss') && <span className="field-error">{getFieldError('stop_loss')}</span>}
            </div>

            <div className="form-group">
              <label htmlFor="take_profit">Take Profit</label>
              <input
                type="number"
                id="take_profit"
                name="take_profit"
                className={getFieldError('take_profit') ? 'input-error' : ''}
                value={formData.take_profit}
                onChange={handleChange}
                step="0.01"
                min="0"
                required
              />
              {getFieldError('take_profit') && <span className="field-error">{getFieldError('take_profit')}</span>}
            </div>
          </>
        )}

        <div className="form-group">
          <label htmlFor="units">Units</label>
          <input
            type="number"
            id="units"
            name="units"
            className={getFieldError('units') ? 'input-error' : ''}
            value={formData.units}
            onChange={handleChange}
            min="1"
            required
          />
          {getFieldError('units') && <span className="field-error">{getFieldError('units')}</span>}
        </div>
      </div>

      {layeredMode && (
        <div className="layered-levels-section">
          <div className="layered-levels-group">
            <div className="layered-levels-header">
              <span>Take Profit Levels</span>
              <span className={`levels-total ${
                tpLevels.reduce((sum, l) => sum + (parseFloat(l.units_pct) || 0), 0) === 100 ? 'complete' : 'incomplete'
              }`}>
                Total: {tpLevels.reduce((sum, l) => sum + (parseFloat(l.units_pct) || 0), 0)}%
                {tpLevels.reduce((sum, l) => sum + (parseFloat(l.units_pct) || 0), 0) === 100 && ' \u2713'}
              </span>
            </div>
            {tpLevels.map((level, index) => (
              <div key={`tp-${index}`} className="level-input-row">
                <span className="level-label">TP{index + 1}</span>
                <input
                  type="number"
                  placeholder="Price"
                  value={level.price}
                  onChange={(e) => {
                    const newLevels = [...tpLevels]
                    newLevels[index] = { ...newLevels[index], price: e.target.value }
                    setTpLevels(newLevels)
                  }}
                  step="0.01"
                  min="0"
                />
                <input
                  type="number"
                  placeholder="%"
                  value={level.units_pct}
                  onChange={(e) => {
                    const newLevels = [...tpLevels]
                    newLevels[index] = { ...newLevels[index], units_pct: e.target.value }
                    setTpLevels(newLevels)
                  }}
                  min="0"
                  max="100"
                  className="pct-input"
                />
                <label className="be-checkbox">
                  <input
                    type="checkbox"
                    checked={level.move_sl_to_breakeven}
                    onChange={(e) => {
                      const newLevels = [...tpLevels]
                      newLevels[index] = { ...newLevels[index], move_sl_to_breakeven: e.target.checked }
                      setTpLevels(newLevels)
                    }}
                  />
                  <span className="be-label">BE</span>
                </label>
                {tpLevels.length > 1 && (
                  <button
                    type="button"
                    className="btn-remove-level"
                    onClick={() => setTpLevels(tpLevels.filter((_, i) => i !== index))}
                  >
                    &times;
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              className="btn-add-level"
              onClick={() => setTpLevels([...tpLevels, { price: '', units_pct: '', move_sl_to_breakeven: false }])}
            >
              + Add TP Level
            </button>
          </div>

          <div className="layered-levels-group">
            <div className="layered-levels-header">
              <span>Stop Loss Levels</span>
              <span className={`levels-total ${
                slLevels.reduce((sum, l) => sum + (parseFloat(l.units_pct) || 0), 0) === 100 ? 'complete' : 'incomplete'
              }`}>
                Total: {slLevels.reduce((sum, l) => sum + (parseFloat(l.units_pct) || 0), 0)}%
                {slLevels.reduce((sum, l) => sum + (parseFloat(l.units_pct) || 0), 0) === 100 && ' \u2713'}
              </span>
            </div>
            {slLevels.map((level, index) => (
              <div key={`sl-${index}`} className="level-input-row">
                <span className="level-label">SL{index + 1}</span>
                <input
                  type="number"
                  placeholder="Price"
                  value={level.price}
                  onChange={(e) => {
                    const newLevels = [...slLevels]
                    newLevels[index] = { ...newLevels[index], price: e.target.value }
                    setSlLevels(newLevels)
                  }}
                  step="0.01"
                  min="0"
                />
                <input
                  type="number"
                  placeholder="%"
                  value={level.units_pct}
                  onChange={(e) => {
                    const newLevels = [...slLevels]
                    newLevels[index] = { ...newLevels[index], units_pct: e.target.value }
                    setSlLevels(newLevels)
                  }}
                  min="0"
                  max="100"
                  className="pct-input"
                />
                {slLevels.length > 1 && (
                  <button
                    type="button"
                    className="btn-remove-level"
                    onClick={() => setSlLevels(slLevels.filter((_, i) => i !== index))}
                  >
                    &times;
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              className="btn-add-level"
              onClick={() => setSlLevels([...slLevels, { price: '', units_pct: '', move_sl_to_breakeven: false }])}
            >
              + Add SL Level
            </button>
          </div>

          {getFieldError('exit_levels') && (
            <div className="field-error">{getFieldError('exit_levels')}</div>
          )}
        </div>
      )}

      <div className="form-preview">
        <div className="preview-item">
          <span>Amount:</span>
          <span>{formatCurrency(preview.amount)}</span>
        </div>
        <div className="preview-item">
          <span>Risk:</span>
          <span className={preview.riskAbs < 0 ? 'negative' : 'positive'}>
            {formatCurrency(preview.riskAbs)} ({formatPercent(preview.riskPct)})
          </span>
        </div>
        <div className="preview-item">
          <span>Profit:</span>
          <span className={preview.profitAbs > 0 ? 'positive' : 'negative'}>
            {formatCurrency(preview.profitAbs)} ({formatPercent(preview.profitPct)})
          </span>
        </div>
        <div className="preview-item">
          <span>Ratio:</span>
          <span>{preview.ratio.toFixed(2)}</span>
        </div>
        <div className="preview-item">
          <span>Direction:</span>
          <span className={validation.direction === 'long' ? 'positive' : validation.direction === 'short' ? 'negative' : ''}>
            {validation.direction?.toUpperCase() ?? '-'}
          </span>
        </div>
      </div>

          <button type="submit" disabled={submitting}>
            {submitting ? 'Creating...' : 'Create Trade'}
          </button>
        </form>
      )}
    </div>
  )
}
