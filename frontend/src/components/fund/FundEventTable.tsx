import { observer } from '@legendapp/state/react'
import { useFundStore } from '../../container/ContainerContext'
import type { FundEvent } from '../../domain/fund/types'
import styles from './FundEventTable.module.css'

const EVENT_TYPE_LABELS: Record<string, string> = {
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  reserve: 'Reserve',
  benefit: 'Benefit',
  loss: 'Loss',
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

function getSignedAmount(event: FundEvent): string {
  const amount = event.amount.toNumber()
  switch (event.eventType) {
    case 'deposit':
    case 'benefit':
      return `+${formatCurrency(amount)}`
    case 'withdrawal':
    case 'reserve':
    case 'loss':
      return `-${formatCurrency(amount)}`
  }
}

function getAmountClass(event: FundEvent): string {
  switch (event.eventType) {
    case 'deposit':
    case 'benefit':
      return styles.positive
    case 'withdrawal':
    case 'reserve':
    case 'loss':
      return styles.negative
  }
}

export const FundEventTable = observer(function FundEventTable() {
  const store = useFundStore()
  const events = store.events$.get()
  const loading = store.loading$.get()

  if (loading) {
    return <div className={styles.loading}>Loading events...</div>
  }

  if (events.length === 0) {
    return <div className={styles.empty}>No fund events yet. Start by making a deposit.</div>
  }

  return (
    <div className={styles.tableContainer}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Amount</th>
            <th>Description</th>
            <th>Trade</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id} className={event.voided ? styles.voided : ''}>
              <td>{formatDate(event.eventDate)}</td>
              <td>
                <span className={styles.typeBadge}>
                  {EVENT_TYPE_LABELS[event.eventType]}
                </span>
                {event.autoDetect && <span className={styles.paperBadge}>Auto</span>}
              </td>
              <td className={`${styles.amount} ${getAmountClass(event)}`}>
                {getSignedAmount(event)}
              </td>
              <td className={styles.description}>{event.description || '-'}</td>
              <td>{event.tradeId ? `#${event.tradeId}` : '-'}</td>
              <td>{event.voided ? <span className={styles.voidedBadge}>Voided</span> : ''}</td>
              <td>
                {!event.voided && (event.eventType === 'deposit' || event.eventType === 'withdrawal') && (
                  <button
                    className={styles.btnVoid}
                    onClick={() => store.voidEvent(event.id)}
                  >
                    Void
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
})
