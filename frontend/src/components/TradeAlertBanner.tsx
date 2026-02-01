import { observer } from '@legendapp/state/react'
import { useTradeStore } from '../container/ContainerContext'
import type { EntryAlert, SLTPAlert } from '../domain/trade/types'
import styles from './TradeAlertBanner.module.css'

export const TradeAlertBanner = observer(function TradeAlertBanner() {
  const store = useTradeStore()

  const entryAlerts = store.entryAlerts$.get()
  const sltpAlerts = store.sltpAlerts$.get()
  const loading = store.detecting$.get()
  const lastResult = store.lastDetectionResult$.get()

  const handleDetect = async () => {
    await store.detectTradeHits()
  }

  const getEntryAlertClass = (alert: EntryAlert): string => {
    if (alert.autoOpened) return styles.alertEntryOpened
    return styles.alertEntry
  }

  const getSltpAlertClass = (alert: SLTPAlert): string => {
    if (alert.autoClosed) return styles.alertAutoClosed
    if (alert.hitType === 'both') return styles.alertConflict
    if (alert.hitType === 'sl') return styles.alertSl
    return styles.alertTp
  }

  const getEntryAlertIcon = (alert: EntryAlert): string => {
    if (alert.autoOpened) return 'check'
    return 'arrow-right'
  }

  const getSltpAlertIcon = (alert: SLTPAlert): string => {
    if (alert.autoClosed) return 'check'
    if (alert.hitType === 'both') return 'warning'
    if (alert.hitType === 'sl') return 'X'
    return 'check'
  }

  const hasAlerts = entryAlerts.length > 0 || sltpAlerts.length > 0

  return (
    <div className={styles.sltpAlertBanner}>
      <div className={styles.sltpHeader}>
        <button
          className={styles.btnDetectSltp}
          onClick={handleDetect}
          disabled={loading}
        >
          {loading ? 'Checking...' : 'Check Trade Alerts'}
        </button>
        {lastResult && (
          <span className={styles.sltpSummary}>
            {lastResult.autoOpenedCount > 0 && (
              <span className={styles.summaryAutoOpened}>
                {lastResult.autoOpenedCount} auto-opened
              </span>
            )}
            {lastResult.autoClosedCount > 0 && (
              <span className={styles.summaryAutoClosed}>
                {lastResult.autoClosedCount} auto-closed
              </span>
            )}
            {lastResult.conflictCount > 0 && (
              <span className={styles.summaryConflict}>
                {lastResult.conflictCount} conflict{lastResult.conflictCount > 1 ? 's' : ''}
              </span>
            )}
          </span>
        )}
        {hasAlerts && (
          <button className={styles.btnDismissAll} onClick={() => store.dismissAllAlerts()}>
            Dismiss All
          </button>
        )}
      </div>

      {hasAlerts && (
        <div className={styles.sltpAlerts}>
          {entryAlerts.map(alert => (
            <div
              key={`entry-${alert.tradeId}`}
              className={`${styles.sltpAlert} ${getEntryAlertClass(alert)}`}
            >
              <span className={styles.alertIcon}>{getEntryAlertIcon(alert)}</span>
              <span className={styles.alertMessage}>{alert.message}</span>
              <button
                className={styles.btnDismiss}
                onClick={() => store.dismissEntryAlert(alert.tradeId)}
              >
                x
              </button>
            </div>
          ))}
          {sltpAlerts.map(alert => (
            <div
              key={`sltp-${alert.tradeId}`}
              className={`${styles.sltpAlert} ${getSltpAlertClass(alert)}`}
            >
              <span className={styles.alertIcon}>{getSltpAlertIcon(alert)}</span>
              <span className={styles.alertMessage}>{alert.message}</span>
              <button
                className={styles.btnDismiss}
                onClick={() => store.dismissSltpAlert(alert.tradeId)}
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})
