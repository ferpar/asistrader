import { observer } from '@legendapp/state/react'
import { useFundStore, useFxStore } from '../../container/ContainerContext'
import type { FundEvent } from '../../domain/fund/types'
import type { FxStore } from '../../domain/fx/FxStore'
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

function formatCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value)
}

function sign(eventType: FundEvent['eventType']): '+' | '-' {
  return eventType === 'deposit' || eventType === 'benefit' ? '+' : '-'
}

function nativeAmount(event: FundEvent): string {
  return `${sign(event.eventType)}${formatCurrency(event.amount.toNumber(), event.currency)}`
}

function baseAmount(
  event: FundEvent,
  baseCurrency: string,
  fxStore: FxStore,
): string | null {
  if (event.currency === baseCurrency) return null
  try {
    const converted = fxStore.convert(
      event.amount,
      event.currency,
      baseCurrency,
      event.eventDate,
    )
    return `≈ ${sign(event.eventType)}${formatCurrency(converted.toNumber(), baseCurrency)}`
  } catch {
    return null
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
  const fxStore = useFxStore()
  const events = store.events$.get()
  const loading = store.loading$.get()
  const baseCurrency = store.baseCurrency$.get()
  // Subscribe to FX hydration so converted amounts re-render once history arrives.
  fxStore.loaded$.get()

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
                <div>{nativeAmount(event)}</div>
                {(() => {
                  const base = baseAmount(event, baseCurrency, fxStore)
                  return base ? <div className={styles.amountBase}>{base}</div> : null
                })()}
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
