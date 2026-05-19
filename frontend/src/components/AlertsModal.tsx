import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { observer } from '@legendapp/state/react'
import { useTradeAlerts, alertKey } from '../hooks/useTradeAlerts'
import type { AnyAlert, EntryAlert, SLTPAlert, LayeredAlert } from '../domain/trade/types'
import styles from './AlertsModal.module.css'

interface AlertsModalProps {
  onClose: () => void
}

type SectionId = 'pe' | 'sl' | 'tp' | 'conflict' | 'layered'

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'pe', label: 'PE — Entry hits' },
  { id: 'sl', label: 'SL — Stop-loss hits' },
  { id: 'tp', label: 'TP — Take-profit hits' },
  { id: 'conflict', label: 'Conflicts — SL & TP same day' },
  { id: 'layered', label: 'Layered — Partial closes' },
]

export const AlertsModal = observer(function AlertsModal({ onClose }: AlertsModalProps) {
  const alerts = useTradeAlerts()
  const [showDiscarded, setShowDiscarded] = useState(false)
  const [expanded, setExpanded] = useState<Set<SectionId>>(new Set())

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  const toggle = (id: SectionId) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const groups = showDiscarded ? alerts.categories.dismissed : alerts.categories.active
  const total = showDiscarded ? alerts.dismissedCount : alerts.activeCount

  const rowClass = (a: AnyAlert): string => {
    if (a.alertKind === 'entry') return alerts.getEntryAlertClass(a as EntryAlert)
    if (a.alertKind === 'layered') return alerts.getLayeredAlertClass(a as LayeredAlert)
    return alerts.getSltpAlertClass(a as SLTPAlert)
  }

  const rowIcon = (a: AnyAlert): string => {
    if (a.alertKind === 'entry') return alerts.getEntryAlertIcon(a as EntryAlert)
    if (a.alertKind === 'layered') return alerts.getLayeredAlertIcon(a as LayeredAlert)
    return alerts.getSltpAlertIcon(a as SLTPAlert)
  }

  const modalContent = (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3>{showDiscarded ? 'Discarded alerts' : 'Alerts'} ({total})</h3>
          <button className={styles.modalClose} onClick={onClose}>&times;</button>
        </div>

        <div className={styles.toolbar}>
          <span className={styles.toolbarLabel}>Sort</span>
          <button
            className={`${styles.sortBtn} ${alerts.sortMode === 'date' ? styles.sortBtnActive : ''}`}
            onClick={() => alerts.setSortMode('date')}
          >
            Date
          </button>
          <button
            className={`${styles.sortBtn} ${alerts.sortMode === 'ticker' ? styles.sortBtnActive : ''}`}
            onClick={() => alerts.setSortMode('ticker')}
          >
            Ticker
          </button>

          <span className={styles.toolbarSpacer} />

          {!showDiscarded && alerts.hasAlerts && (
            <button className={styles.toolbarAction} onClick={alerts.dismissAll}>
              Dismiss all
            </button>
          )}
          {(showDiscarded || alerts.hasDismissed) && (
            <button className={styles.toolbarAction} onClick={() => setShowDiscarded(v => !v)}>
              {showDiscarded
                ? 'Back to active'
                : `Show discarded (${alerts.dismissedCount})`}
            </button>
          )}
        </div>

        <div className={styles.modalBody}>
          {total === 0 ? (
            <div className={styles.emptyState}>
              {showDiscarded
                ? 'No discarded alerts.'
                : 'No alerts. Run “Check Alerts” to detect new hits.'}
            </div>
          ) : (
            SECTIONS.map(section => {
              const list: AnyAlert[] = groups[section.id]
              const isOpen = expanded.has(section.id)
              return (
                <div key={section.id} className={styles.section}>
                  <button
                    className={styles.sectionHeader}
                    onClick={() => toggle(section.id)}
                    disabled={list.length === 0}
                  >
                    <span className={styles.chevron}>
                      {list.length === 0 ? '' : isOpen ? '▾' : '▸'}
                    </span>
                    <span className={styles.sectionLabel}>{section.label}</span>
                    <span className={styles.sectionCount}>{list.length}</span>
                  </button>
                  {isOpen && list.length > 0 && (
                    <div className={styles.rows}>
                      {list.map(alert => (
                        <div
                          key={alertKey(alert)}
                          className={`${styles.row} ${styles[rowClass(alert)]}`}
                        >
                          <span className={styles.icon}>{rowIcon(alert)}</span>
                          <span className={styles.ticker}>{alert.ticker}</span>
                          <span className={styles.date}>{alert.hitDate}</span>
                          <span className={styles.message}>{alert.message}</span>
                          {showDiscarded ? (
                            <button
                              className={styles.btnRestore}
                              onClick={() => alerts.restore(alert)}
                            >
                              Restore
                            </button>
                          ) : (
                            <button
                              className={styles.btnDismiss}
                              title="Dismiss"
                              onClick={() => alerts.dismiss(alert)}
                            >
                              &times;
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
})
