import { useId, useState, type FormEvent } from 'react'
import { observer } from '@legendapp/state/react'
import { useTickerStore } from '../../container/ContainerContext'
import { localTodayIso } from '../../utils/dateOnly'
import type { Decimal } from '../../domain/shared/Decimal'
import type {
  Portfolio,
  PortfolioTransaction,
  TransactionInput,
} from '../../domain/portfolio/types'
import styles from './Portfolio.module.css'

type Kind = TransactionInput['kind']

interface TransactionFormProps {
  portfolio: Portfolio
  /** Tickers currently held, suggested when recording a Sell. */
  heldTickers: string[]
  /** The Transaction being edited; omitted when recording a new one. */
  initial?: PortfolioTransaction
  onSubmit: (input: TransactionInput) => Promise<void>
  onCancel?: () => void
}

const EMPTY = { ticker: '', units: '', price: '', fees: '', fxRate: '' }

const str = (value: Decimal | null) => (value === null ? '' : String(value.toNumber()))

function fieldsOf(tx: PortfolioTransaction | undefined): typeof EMPTY {
  if (!tx) return EMPTY
  return {
    ticker: tx.ticker,
    units: str(tx.units),
    price: str(tx.price),
    fees: str(tx.fees),
    fxRate: str(tx.fxRate),
  }
}

/**
 * Record or edit a Buy or Sell. A Buy may name any symbol (an unknown one is
 * created and its history loaded by the backend); a Sell consumes the oldest
 * Lots first and is rejected if it exceeds the units held. Leave the FX rate
 * empty to use the stored rate for the date.
 */
export const TransactionForm = observer(function TransactionForm({
  portfolio,
  heldTickers,
  initial,
  onSubmit,
  onCancel,
}: TransactionFormProps) {
  const tickerStore = useTickerStore()
  const tickers = tickerStore.tickers$.get()
  const listId = useId()
  const [kind, setKind] = useState<Kind>(initial?.kind === 'sell' ? 'sell' : 'buy')
  const [date, setDate] = useState(initial ? initial.date.toLocaleDateString('en-CA') : localTodayIso())
  const [fields, setFields] = useState(() => fieldsOf(initial))
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
      await onSubmit({ kind, date, ticker, units, price, fees, fxRate })
      if (!initial) setFields(EMPTY)
      // The backend created an unknown ticker: let the rest of the app see it.
      if (!tickers.some((t) => t.symbol === ticker)) tickerStore.loadTickers()
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to save ${kind}`)
    } finally {
      setSaving(false)
    }
  }

  const suggestions =
    kind === 'sell'
      ? heldTickers.map((symbol) => ({ symbol, name: tickers.find((t) => t.symbol === symbol)?.name }))
      : tickers

  return (
    <form className={styles.buyForm} onSubmit={handleSubmit}>
      <label>
        Kind
        <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          <option value="buy">Buy</option>
          <option value="sell">Sell</option>
        </select>
      </label>
      <label>
        Date
        <input type="date" value={date} max={localTodayIso()} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label>
        Ticker
        <input list={listId} value={fields.ticker} onChange={set('ticker')} placeholder="SAN.MC" />
        <datalist id={listId}>
          {suggestions.map((t) => (
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
        {saving ? 'Saving…' : initial ? 'Save' : kind === 'sell' ? 'Add Sell' : 'Add Buy'}
      </button>
      {onCancel && (
        <button type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </form>
  )
})
