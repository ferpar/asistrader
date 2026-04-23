import { useState } from 'react'
import { observer } from '@legendapp/state/react'
import type { TradeWithMetrics } from '../domain/trade/types'
import { TradeEditModal, EditMode } from './TradeEditModal'
import { useTradeStore, useFundStore } from '../container/ContainerContext'
import styles from './TradeActions.module.css'

interface TradeActionsProps {
  trade: TradeWithMetrics
  currentPrice?: number | null
}

export const TradeActions = observer(function TradeActions({ trade, currentPrice }: TradeActionsProps) {
  const tradeStore = useTradeStore()
  const fundStore = useFundStore()
  const [editingMode, setEditingMode] = useState<EditMode | null>(null)

  const openModal = (mode: EditMode) => setEditingMode(mode)
  const closeModal = () => {
    setEditingMode(null)
    fundStore.loadEvents()
  }

  const checkFundsAndOrder = async () => {
    const balance = fundStore.balance$.get()
    const amount = trade.amount.toNumber()
    if (amount > balance.maxPerTrade.toNumber()) {
      alert(`Trade amount $${amount.toFixed(2)} exceeds max per trade $${balance.maxPerTrade.toFixed(2)}`)
      return
    }
    if (amount > balance.available.toNumber()) {
      alert(`Trade amount $${amount.toFixed(2)} exceeds available funds $${balance.available.toFixed(2)}`)
      return
    }
    await tradeStore.updateTrade(trade.id, { status: 'ordered' })
    await fundStore.loadEvents()
  }

  const checkFundsAndOpen = () => {
    const balance = fundStore.balance$.get()
    const amount = trade.amount.toNumber()
    if (amount > balance.maxPerTrade.toNumber()) {
      alert(`Trade amount $${amount.toFixed(2)} exceeds max per trade $${balance.maxPerTrade.toFixed(2)}`)
      return
    }
    if (amount > balance.available.toNumber()) {
      alert(`Trade amount $${amount.toFixed(2)} exceeds available funds $${balance.available.toFixed(2)}`)
      return
    }
    openModal('open')
  }

  const handleReopen = async () => {
    const confirmed = window.confirm(
      `Reopen trade #${trade.number ?? trade.id} (${trade.ticker})? This will undo the close — exit fields are cleared and the close's benefit/loss fund event is voided.`
    )
    if (!confirmed) return
    try {
      await tradeStore.reopenTrade(trade.id)
      await fundStore.loadEvents()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reopen trade')
    }
  }

  const handleRevertToOrdered = async () => {
    const confirmed = window.confirm(
      `Revert trade #${trade.number ?? trade.id} (${trade.ticker}) back to ordered? This will undo the open — date_actual is cleared, and any HIT exit levels are reset to pending. The reserve stays in place.`
    )
    if (!confirmed) return
    try {
      await tradeStore.revertOpenToOrdered(trade.id)
      await fundStore.loadEvents()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to revert trade')
    }
  }

  return (
    <>
      <div className={styles.tradeActions} onClick={(e) => e.stopPropagation()}>
        {trade.status === 'plan' && (
          <>
            <button className={`${styles.btnAction} ${styles.btnOrder}`} onClick={checkFundsAndOrder}>Order</button>
            <button className={`${styles.btnAction} ${styles.btnOpen}`} onClick={checkFundsAndOpen}>Open</button>
            <button className={`${styles.btnAction} ${styles.btnCancel}`} onClick={() => openModal('cancel')}>Cancel</button>
            <button className={`${styles.btnAction} ${styles.btnEdit}`} onClick={() => openModal('edit')}>Edit</button>
          </>
        )}
        {trade.status === 'ordered' && (
          <>
            <button className={`${styles.btnAction} ${styles.btnOpen}`} onClick={() => openModal('open')}>Open</button>
            <button
              className={`${styles.btnAction} ${styles.btnRetract}`}
              onClick={async () => { await tradeStore.updateTrade(trade.id, { status: 'plan' }); await fundStore.loadEvents() }}
            >
              Retract
            </button>
            <button className={`${styles.btnAction} ${styles.btnCancel}`} onClick={() => openModal('cancel')}>Cancel</button>
            <button className={`${styles.btnAction} ${styles.btnEdit}`} onClick={() => openModal('edit')}>Edit</button>
          </>
        )}
        {trade.status === 'open' && (
          <>
            <button className={`${styles.btnAction} ${styles.btnClose}`} onClick={() => openModal('close')}>Close</button>
            <button className={`${styles.btnAction} ${styles.btnRetract}`} onClick={handleRevertToOrdered}>Revert</button>
            <button className={`${styles.btnAction} ${styles.btnEdit}`} onClick={() => openModal('edit')}>Edit</button>
          </>
        )}
        {trade.status === 'close' && (
          <>
            <button className={`${styles.btnAction} ${styles.btnOpen}`} onClick={handleReopen}>Reopen</button>
            <button className={`${styles.btnAction} ${styles.btnEdit}`} onClick={() => openModal('edit')}>Edit</button>
          </>
        )}
      </div>

      {editingMode && (
        <TradeEditModal
          trade={trade}
          mode={editingMode}
          currentPrice={currentPrice ?? null}
          onClose={closeModal}
        />
      )}
    </>
  )
})
