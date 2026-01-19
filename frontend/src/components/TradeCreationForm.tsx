import { useState, useEffect, useMemo, useCallback } from 'react'
import { fetchTickers, fetchTickerPrice } from '../api/tickers'
import { createTrade } from '../api/trades'
import { Ticker, TradeCreateRequest } from '../types/trade'
import { TickerSearchInput } from './TickerSearchInput'
import { useTradeValidation } from '../hooks/useTradeValidation'

interface TradeCreationFormProps {
  onTradeCreated: () => void
}

export function TradeCreationForm({ onTradeCreated }: TradeCreationFormProps) {
  const [tickers, setTickers] = useState<Ticker[]>([])
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
  })

  useEffect(() => {
    const loadTickers = async () => {
      try {
        const response = await fetchTickers()
        setTickers(response.tickers)
        if (response.tickers.length > 0) {
          setFormData(prev => ({ ...prev, ticker: response.tickers[0].symbol }))
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load tickers')
      } finally {
        setLoadingTickers(false)
      }
    }
    loadTickers()
  }, [])

  const loadCurrentPrice = useCallback(async (symbol: string) => {
    if (!symbol) {
      setCurrentPrice(null)
      return
    }
    setLoadingPrice(true)
    try {
      const response = await fetchTickerPrice(symbol)
      setCurrentPrice(response.valid ? response.price : null)
    } catch {
      setCurrentPrice(null)
    } finally {
      setLoadingPrice(false)
    }
  }, [])

  useEffect(() => {
    loadCurrentPrice(formData.ticker)
  }, [formData.ticker, loadCurrentPrice])

  const preview = useMemo(() => {
    const entryPrice = parseFloat(formData.entry_price) || 0
    const stopLoss = parseFloat(formData.stop_loss) || 0
    const takeProfit = parseFloat(formData.take_profit) || 0
    const units = parseInt(formData.units) || 0

    const amount = entryPrice * units
    const riskAbs = (stopLoss - entryPrice) * units
    const profitAbs = (takeProfit - entryPrice) * units
    const riskPct = amount !== 0 ? riskAbs / amount : 0
    const profitPct = amount !== 0 ? profitAbs / amount : 0
    const ratio = riskAbs !== 0 ? -profitAbs / riskAbs : 0

    return { amount, riskAbs, profitAbs, riskPct, profitPct, ratio }
  }, [formData.entry_price, formData.stop_loss, formData.take_profit, formData.units])

  const validationValues = useMemo(() => ({
    entry_price: parseFloat(formData.entry_price) || 0,
    stop_loss: parseFloat(formData.stop_loss) || 0,
    take_profit: parseFloat(formData.take_profit) || 0,
    units: parseInt(formData.units) || 0,
  }), [formData.entry_price, formData.stop_loss, formData.take_profit, formData.units])

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
      const request: TradeCreateRequest = {
        ticker: formData.ticker,
        entry_price: parseFloat(formData.entry_price),
        stop_loss: parseFloat(formData.stop_loss),
        take_profit: parseFloat(formData.take_profit),
        units: parseInt(formData.units),
        date_planned: formData.date_planned,
      }
      await createTrade(request)
      // Reset form
      setFormData({
        ticker: tickers.length > 0 ? tickers[0].symbol : '',
        entry_price: '',
        stop_loss: '',
        take_profit: '',
        units: '',
        date_planned: new Date().toISOString().split('T')[0],
      })
      onTradeCreated()
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
