import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { observer } from '@legendapp/state/react'
import FocusLock from 'react-focus-lock'
import { getOverlayContainer } from '../overlay/overlayLayers'
import { useTradeCreation } from '../hooks/useTradeCreation'
import { GuidedTradeForm } from './GuidedTradeForm'
import { AdvancedTradeForm } from './AdvancedTradeForm'
import styles from './TradeCreationForm.module.css'

interface TradeCreationModalProps {
  onClose: () => void
  initialTicker?: string
}

type Mode = 'guided' | 'advanced'

/**
 * Trade creation modal. Owns a single useTradeCreation instance and the modal
 * chrome, and swaps between the guided wizard and the advanced form without
 * losing entered data (both render from the same hook).
 */
export const TradeCreationModal = observer(function TradeCreationModal({ onClose, initialTicker }: TradeCreationModalProps) {
  const form = useTradeCreation(initialTicker)
  const [mode, setMode] = useState<Mode>('guided')

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  // Shared submit path: confirm each non-blocking warning, then create.
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    for (const warning of form.submitWarnings) {
      if (!window.confirm(warning)) return
    }
    const success = await form.handleSubmit(e)
    if (success) onClose()
  }

  const modalContent = (
    <div className={styles.modalOverlay} onClick={onClose}>
      <FocusLock
        returnFocus
        className={styles.modal}
        lockProps={{ role: 'dialog', 'aria-modal': true, 'aria-label': 'New Trade', onClick: (e: { stopPropagation: () => void }) => e.stopPropagation() }}
      >
        <div className={styles.modalHeader}>
          <h3>New Trade</h3>
          <div className={styles.modeToggle} role="tablist" aria-label="Form mode">
            <button
              type="button" role="tab" aria-selected={mode === 'guided'}
              className={`${styles.modeBtn} ${mode === 'guided' ? styles.modeBtnActive : ''}`}
              onClick={() => setMode('guided')}
            >
              Guided
            </button>
            <button
              type="button" role="tab" aria-selected={mode === 'advanced'}
              className={`${styles.modeBtn} ${mode === 'advanced' ? styles.modeBtnActive : ''}`}
              onClick={() => setMode('advanced')}
            >
              Advanced
            </button>
          </div>
          <button className={styles.modalClose} onClick={onClose}>&times;</button>
        </div>

        {form.loadingTickers ? (
          <div className={styles.modalBody}>Loading tickers...</div>
        ) : mode === 'guided' ? (
          <GuidedTradeForm form={form} onSubmit={onSubmit} onCancel={onClose} />
        ) : (
          <AdvancedTradeForm form={form} onSubmit={onSubmit} onCancel={onClose} />
        )}
      </FocusLock>
    </div>
  )

  return createPortal(modalContent, getOverlayContainer('modal'))
})
