import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { observer } from '@legendapp/state/react'
import { getOverlayContainer } from '../overlay/overlayLayers'
import { useTradeAlerts, alertKey } from '../hooks/useTradeAlerts'
import { useTradeStore } from '../container/ContainerContext'
import type { AnyAlert, EntryAlert, SLTPAlert, LayeredAlert, TradeWithMetrics } from '../domain/trade/types'
import { buildAlertMessage } from '../utils/alertMessage'
import { DetectionTraceModal } from './DetectionTraceModal'
import type { EditMode } from './TradeEditModal'
import styles from './AlertsModal.module.css'

interface AlertsModalProps {
  onClose: () => void
  onTakeAction: (alert: AnyAlert, trade: TradeWithMetrics, mode: EditMode) => void
}

function kindBadgeLabel(kind: string): string {
  switch (kind) {
    case 'gap': return 'GAP'
    case 'gap_on_entry': return 'GAP·OPEN'
    case 'unverifiable': return 'UNVERIFIABLE'
    default: return kind
  }
}

function kindBadgeTitle(kind: string): string {
  switch (kind) {
    case 'gap': return 'Gap fill: price gapped past the level between sessions; fill is the bar open.'
    case 'gap_on_entry': return 'Gap on entry day: the open was already past the level when the position opened.'
    case 'unverifiable': return 'Intraday touch on the entry day — we cannot tell if the touch happened before or after the trade was opened.'
    default: return ''
  }
}

type SectionId = 'pe' | 'sl' | 'tp' | 'conflict' | 'layered'

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'pe', label: 'PE — Entry hits' },
  { id: 'sl', label: 'SL — Stop-loss hits' },
  { id: 'tp', label: 'TP — Take-profit hits' },
  { id: 'conflict', label: 'Conflicts — SL & TP same day' },
  { id: 'layered', label: 'Layered — Partial closes' },
]

/**
 * Maps an alert to the trade action it represents, when the user can take that
 * action themselves (i.e. auto-processing did not already happen). Returns null
 * when no action is applicable — e.g. the alert was auto-processed, or it's a
 * layered partial close (which TradeEditModal doesn't model as a single mode).
 */
function alertAction(alert: AnyAlert): { label: string; mode: EditMode } | null {
  if (alert.alertKind === 'entry') {
    const a = alert as EntryAlert
    return a.autoOpened ? null : { label: 'Open', mode: 'open' }
  }
  if (alert.alertKind === 'sltp') {
    const a = alert as SLTPAlert
    return a.autoClosed ? null : { label: 'Close', mode: 'close' }
  }
  return null
}

export const AlertsModal = observer(function AlertsModal({ onClose, onTakeAction }: AlertsModalProps) {
  const alerts = useTradeAlerts()
  const tradeStore = useTradeStore()
  const trades = tradeStore.trades$.get()
  const [showDiscarded, setShowDiscarded] = useState(false)
  const [expanded, setExpanded] = useState<Set<SectionId>>(new Set())
  const [traceTarget, setTraceTarget] = useState<{ tradeId: number; ticker: string } | null>(null)

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
                      {list.map(alert => {
                        const acted = alerts.isActed(alert)
                        const action = showDiscarded || acted ? null : alertAction(alert)
                        const trade = action ? trades.find(t => t.id === alert.tradeId) : undefined
                        return (
                        <div
                          key={alertKey(alert)}
                          className={`${styles.row} ${styles[rowClass(alert)]} ${acted ? styles.rowActed : ''}`}
                        >
                          <span className={styles.icon}>{rowIcon(alert)}</span>
                          <span className={styles.ticker}>{alert.ticker}</span>
                          <span className={styles.date}>{alert.hitDate}</span>
                          {alert.hitKind !== 'intraday' && (
                            <span
                              className={`${styles.kindBadge} ${styles[`kind_${alert.hitKind}`] ?? ''}`}
                              title={kindBadgeTitle(alert.hitKind)}
                            >
                              {kindBadgeLabel(alert.hitKind)}
                            </span>
                          )}
                          <span className={styles.message}>{buildAlertMessage(alert)}</span>
                          {acted && (
                            <span className={styles.actedBadge} title="You took action on this alert. It will clear on the next detection run.">
                              ✓ Acted
                            </span>
                          )}
                          {action && trade && (
                            <button
                              className={`${styles.btnAction} ${action.mode === 'open' ? styles.btnActionOpen : styles.btnActionClose}`}
                              title={`${action.label} trade #${trade.number ?? trade.id}`}
                              onClick={() => onTakeAction(alert, trade, action.mode)}
                            >
                              {action.label}
                            </button>
                          )}
                          <button
                            className={styles.btnWhy}
                            title="Show detection trace"
                            onClick={() => setTraceTarget({ tradeId: alert.tradeId, ticker: alert.ticker })}
                          >
                            Why?
                          </button>
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
                        )
                      })}
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

  return (
    <>
      {createPortal(modalContent, getOverlayContainer('modal'))}
      {traceTarget !== null && (
        <DetectionTraceModal
          tradeId={traceTarget.tradeId}
          ticker={traceTarget.ticker}
          onClose={() => setTraceTarget(null)}
        />
      )}
    </>
  )
})
