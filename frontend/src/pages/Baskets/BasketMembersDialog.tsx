import { useState, type FormEvent } from 'react'
import { observer } from '@legendapp/state/react'
import { useBasketStore, useTickerStore } from '../../container/ContainerContext'
import { BasketDialog } from './BasketDialog'
import styles from './BasketDialog.module.css'

interface BasketMembersDialogProps {
  basketId: number
  onClose: () => void
}

/**
 * Add and remove a Personal Basket's members by symbol. Any Yahoo symbol can
 * be typed: one AsisTrader doesn't know yet is created and its history loaded
 * by the backend, which says why when Yahoo has no data for it.
 */
export const BasketMembersDialog = observer(function BasketMembersDialog({ basketId, onClose }: BasketMembersDialogProps) {
  const basketStore = useBasketStore()
  const tickerStore = useTickerStore()
  const basket = basketStore.baskets$.get().find((b) => b.id === basketId)
  const tickers = tickerStore.tickers$.get()
  const names = new Map(tickers.map((t) => [t.symbol, t.name]))

  const [symbol, setSymbol] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!basket) return null

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault()
    const wanted = symbol.trim().toUpperCase()
    if (!wanted) return
    setBusy(true)
    setError(null)
    try {
      await basketStore.addMember(basket.id, wanted)
      setSymbol('')
      // The backend created an unknown ticker: let the rest of the app see it.
      if (!names.has(wanted)) tickerStore.loadTickers()
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to add ${wanted}`)
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async (member: string) => {
    setError(null)
    try {
      await basketStore.removeMember(basket.id, member)
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to remove ${member}`)
    }
  }

  return (
    <BasketDialog title={`Members of ${basket.name}`} onClose={onClose}>
      <form className={styles.form} onSubmit={handleAdd}>
        <input
          aria-label="Symbol to add"
          list="basket-member-tickers"
          placeholder="Yahoo symbol, e.g. RHM.DE"
          autoFocus
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
        />
        <datalist id="basket-member-tickers">
          {tickers.map((t) => (
            <option key={t.symbol} value={t.symbol}>
              {t.name ?? ''}
            </option>
          ))}
        </datalist>
        <button type="submit" disabled={busy || !symbol.trim()}>
          {busy ? 'Adding…' : 'Add'}
        </button>
      </form>
      {busy && <p className={styles.hint}>A new symbol is checked on Yahoo and its history loaded; this can take a moment.</p>}
      {error && <p className={styles.error}>{error}</p>}
      {basket.members.length === 0 ? (
        <p className={styles.hint}>No members yet.</p>
      ) : (
        <ul className={styles.members}>
          {basket.members.map((member) => (
            <li key={member}>
              <span>
                <span className={styles.symbol}>{member}</span>
                {names.get(member) && <span className={styles.muted}>{names.get(member)}</span>}
              </span>
              <button
                type="button"
                className={styles.remove}
                aria-label={`Remove ${member}`}
                onClick={() => handleRemove(member)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </BasketDialog>
  )
})
