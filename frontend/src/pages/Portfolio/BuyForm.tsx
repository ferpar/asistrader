import { useState, type FormEvent } from 'react'
import { observer } from '@legendapp/state/react'
import { useTickerStore } from '../../container/ContainerContext'
import { localTodayIso } from '../../utils/dateOnly'
import type { NewBuy, Portfolio } from '../../domain/portfolio/types'
import styles from './Portfolio.module.css'

interface BuyFormProps {
  portfolio: Portfolio
  onSubmit: (buy: NewBuy) => Promise<void>
}

const EMPTY = { ticker: '', units: '', price: '', fees: '', fxRate: '' }

/**
 * Record a Buy. Any symbol can be typed: an unknown one is created and its
 * history loaded by the backend. Leave the FX rate empty to use the stored
 * rate for the date.
 */
export const BuyForm = observer(function BuyForm({ portfolio, onSubmit }: BuyFormProps) {
  const tickerStore = useTickerStore()
  const tickers = tickerStore.tickers$.get()
  const [date, setDate] = useState(localTodayIso())
  const [fields, setFields] = useState(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const set = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields((f) => ({ ...f, [key]: e.target.value }))

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const units = Number(fields.units)
    const price = Number(fields.price)
    const fees = fields.fees === '' ? 0 : Number(fields.fees)
    const fxRate = fields.fxRate === '' ? undefined : Number(fields.fxRate)
    if (!fields.ticker.trim() || !(units > 0) || !(price > 0) || !(fees >= 0)) {
      setError('Ticker, positive units and price are required; fees cannot be negative.')
      return
    }
    if (fxRate !== undefined && !(fxRate > 0)) {
      setError('The FX rate must be positive.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const ticker = fields.ticker.trim().toUpperCase()
      await onSubmit({ date, ticker, units, price, fees, fxRate })
      setFields(EMPTY)
      // The backend created an unknown ticker: let the rest of the app see it.
      if (!tickers.some((t) => t.symbol === ticker)) tickerStore.loadTickers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record Buy')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className={styles.buyForm} onSubmit={handleSubmit}>
      <label>
        Date
        <input type="date" value={date} max={localTodayIso()} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label>
        Ticker
        <input list="portfolio-buy-tickers" value={fields.ticker} onChange={set('ticker')} placeholder="SAN.MC" />
        <datalist id="portfolio-buy-tickers">
          {tickers.map((t) => (
            <option key={t.symbol} value={t.symbol}>{t.name ?? ''}</option>
          ))}
        </datalist>
      </label>
      <label>
        Units
        <input type="number" step="any" min="0" value={fields.units} onChange={set('units')} />
      </label>
      <label>
        Price
        <input type="number" step="any" min="0" value={fields.price} onChange={set('price')} />
      </label>
      <label>
        Fees
        <input type="number" step="any" min="0" value={fields.fees} onChange={set('fees')} placeholder="0" />
      </label>
      <label title={`Units of ${portfolio.currency} per unit of the instrument's currency`}>
        FX rate → {portfolio.currency}
        <input type="number" step="any" min="0" value={fields.fxRate} onChange={set('fxRate')} placeholder="stored" />
      </label>
      <button type="submit" className={styles.primary} disabled={saving}>
        {saving ? 'Saving…' : 'Add Buy'}
      </button>
      {error && <p className={styles.error}>{error}</p>}
    </form>
  )
})
