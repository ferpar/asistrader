import { useState } from 'react'
import { observer } from '@legendapp/state/react'
import { useFundStore } from '../../container/ContainerContext'
import { SUPPORTED_CURRENCIES } from '../../domain/fx/currencies'
import formStyles from '../../styles/forms.module.css'
import styles from './DepositWithdrawForm.module.css'

export const DepositWithdrawForm = observer(function DepositWithdrawForm() {
  const store = useFundStore()
  const baseCurrency = store.baseCurrency$.get()
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<string>(baseCurrency)
  const [description, setDescription] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-sync the currency selector with the user's base if they switch it
  // while no input is in flight.
  if (!amount && currency !== baseCurrency && !submitting) {
    setCurrency(baseCurrency)
  }

  const handleSubmit = async (action: 'deposit' | 'withdrawal') => {
    const numAmount = parseFloat(amount)
    if (!numAmount || numAmount <= 0) {
      setError('Please enter a valid amount')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const request = {
        amount: numAmount,
        currency,
        description: description || undefined,
        event_date: eventDate || undefined,
      }
      if (action === 'deposit') {
        await store.deposit(request)
      } else {
        await store.withdraw(request)
      }
      setAmount('')
      setDescription('')
      setEventDate('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operation failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={styles.form}>
      {error && <div className={formStyles.formError}>{error}</div>}
      <div className={styles.row}>
        <div className={formStyles.formGroup}>
          <label htmlFor="fund-amount">Amount</label>
          <input
            type="number"
            id="fund-amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            step="0.01"
            min="0"
            placeholder="0.00"
          />
        </div>
        <div className={formStyles.formGroup}>
          <label htmlFor="fund-currency">Currency</label>
          <select
            id="fund-currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className={formStyles.formGroup}>
          <label htmlFor="fund-description">Description</label>
          <input
            type="text"
            id="fund-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div className={formStyles.formGroup}>
          <label htmlFor="fund-date">Date</label>
          <input
            type="date"
            id="fund-date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
          />
        </div>
        <div className={styles.actions}>
          <button
            className={styles.btnDeposit}
            onClick={() => handleSubmit('deposit')}
            disabled={submitting}
          >
            Deposit
          </button>
          <button
            className={styles.btnWithdraw}
            onClick={() => handleSubmit('withdrawal')}
            disabled={submitting}
          >
            Withdraw
          </button>
        </div>
      </div>
    </div>
  )
})
