import { useState, useEffect } from 'react'
import { fetchStrategies } from '../api/strategies'
import { updateTrade } from '../api/trades'
import { Strategy, Trade, TradeUpdateRequest, ExitType } from '../types/trade'

export type EditMode = 'edit' | 'open' | 'close'

interface TradeEditModalProps {
  trade: Trade
  mode: EditMode
  onClose: () => void
  onTradeUpdated: () => void
}

export function TradeEditModal({ trade, mode, onClose, onTradeUpdated }: TradeEditModalProps) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [strategies, setStrategies] = useState<Strategy[]>([])

  const [formData, setFormData] = useState({
    entry_price: trade.entry_price.toString(),
    stop_loss: trade.stop_loss.toString(),
    take_profit: trade.take_profit.toString(),
    units: trade.units.toString(),
    date_actual: new Date().toISOString().split('T')[0],
    exit_price: '',
    exit_type: 'sl' as ExitType,
    exit_date: new Date().toISOString().split('T')[0],
    strategy_id: trade.strategy_id?.toString() || '',
  })

  useEffect(() => {
    // Close modal on escape key
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  useEffect(() => {
    // Load strategies when in edit mode
    if (mode === 'edit') {
      fetchStrategies()
        .then((response) => setStrategies(response.strategies))
        .catch(() => {
          // Silently fail - strategies dropdown will just be empty
        })
    }
  }, [mode])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      let request: TradeUpdateRequest = {}

      if (mode === 'edit') {
        request = {
          entry_price: parseFloat(formData.entry_price),
          stop_loss: parseFloat(formData.stop_loss),
          take_profit: parseFloat(formData.take_profit),
          units: parseInt(formData.units),
          strategy_id: formData.strategy_id ? parseInt(formData.strategy_id) : null,
        }
      } else if (mode === 'open') {
        request = {
          status: 'open',
          date_actual: formData.date_actual,
        }
      } else if (mode === 'close') {
        if (!formData.exit_price) {
          setError('Exit price is required')
          setSubmitting(false)
          return
        }
        request = {
          status: 'close',
          exit_price: parseFloat(formData.exit_price),
          exit_type: formData.exit_type,
          exit_date: formData.exit_date,
        }
      }

      await updateTrade(trade.id, request)
      onTradeUpdated()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update trade')
    } finally {
      setSubmitting(false)
    }
  }

  const getTitle = () => {
    switch (mode) {
      case 'open':
        return 'Open Trade'
      case 'close':
        return 'Close Trade'
      default:
        return 'Edit Trade'
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{getTitle()}</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <form onSubmit={handleSubmit}>
          {error && <div className="form-error">{error}</div>}

          <div className="modal-info">
            <span className="modal-ticker">{trade.ticker}</span>
            <span className="modal-status">{trade.status}</span>
          </div>

          {mode === 'edit' && (
            <>
              <div className="form-group">
                <label htmlFor="entry_price">Entry Price</label>
                <input
                  type="number"
                  id="entry_price"
                  name="entry_price"
                  value={formData.entry_price}
                  onChange={handleChange}
                  step="0.01"
                  min="0"
                  required
                  disabled={trade.status === 'close'}
                />
              </div>

              <div className="form-group">
                <label htmlFor="stop_loss">Stop Loss</label>
                <input
                  type="number"
                  id="stop_loss"
                  name="stop_loss"
                  value={formData.stop_loss}
                  onChange={handleChange}
                  step="0.01"
                  min="0"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="take_profit">Take Profit</label>
                <input
                  type="number"
                  id="take_profit"
                  name="take_profit"
                  value={formData.take_profit}
                  onChange={handleChange}
                  step="0.01"
                  min="0"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="units">Units</label>
                <input
                  type="number"
                  id="units"
                  name="units"
                  value={formData.units}
                  onChange={handleChange}
                  min="1"
                  required
                  disabled={trade.status !== 'plan'}
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
            </>
          )}

          {mode === 'open' && (
            <div className="form-group">
              <label htmlFor="date_actual">Open Date</label>
              <input
                type="date"
                id="date_actual"
                name="date_actual"
                value={formData.date_actual}
                onChange={handleChange}
                required
              />
            </div>
          )}

          {mode === 'close' && (
            <>
              <div className="form-group">
                <label htmlFor="exit_price">Exit Price</label>
                <input
                  type="number"
                  id="exit_price"
                  name="exit_price"
                  value={formData.exit_price}
                  onChange={handleChange}
                  step="0.01"
                  min="0"
                  required
                  placeholder="Enter exit price"
                />
              </div>

              <div className="form-group">
                <label htmlFor="exit_type">Exit Type</label>
                <select
                  id="exit_type"
                  name="exit_type"
                  value={formData.exit_type}
                  onChange={handleChange}
                  required
                >
                  <option value="sl">Stop Loss</option>
                  <option value="tp">Take Profit</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="exit_date">Exit Date</label>
                <input
                  type="date"
                  id="exit_date"
                  name="exit_date"
                  value={formData.exit_date}
                  onChange={handleChange}
                  required
                />
              </div>
            </>
          )}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
