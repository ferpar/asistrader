import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import FocusLock from 'react-focus-lock'
import { getOverlayContainer } from '../../overlay/overlayLayers'
import styles from './BasketDialog.module.css'

interface BasketDialogProps {
  title: string
  onClose: () => void
  children: ReactNode
}

/** Modal shell for the Basket dialogs: overlay click and Escape close it. */
export function BasketDialog({ title, onClose, children }: BasketDialogProps) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <FocusLock
        returnFocus
        className={styles.dialog}
        lockProps={{
          role: 'dialog',
          'aria-modal': true,
          'aria-label': title,
          onClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
        }}
      >
        <div className={styles.header}>
          <h3>{title}</h3>
          <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className={styles.body}>{children}</div>
      </FocusLock>
    </div>,
    getOverlayContainer('modal'),
  )
}
