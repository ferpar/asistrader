import { observer } from '@legendapp/state/react'
import { useTradeStore } from '../container/ContainerContext'
import type { EntryAlert, SLTPAlert } from '../domain/trade/types'

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
    if (alert.autoOpened) return 'alert-entry-opened'
    return 'alert-entry'
  }

  const getSltpAlertClass = (alert: SLTPAlert): string => {
    if (alert.autoClosed) return 'alert-auto-closed'
    if (alert.hitType === 'both') return 'alert-conflict'
    if (alert.hitType === 'sl') return 'alert-sl'
    return 'alert-tp'
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
    <div className="sltp-alert-banner">
      <div className="sltp-header">
        <button
          className="btn-detect-sltp"
          onClick={handleDetect}
          disabled={loading}
        >
          {loading ? 'Checking...' : 'Check Trade Alerts'}
        </button>
        {lastResult && (
          <span className="sltp-summary">
            {lastResult.autoOpenedCount > 0 && (
              <span className="summary-auto-opened">
                {lastResult.autoOpenedCount} auto-opened
              </span>
            )}
            {lastResult.autoClosedCount > 0 && (
              <span className="summary-auto-closed">
                {lastResult.autoClosedCount} auto-closed
              </span>
            )}
            {lastResult.conflictCount > 0 && (
              <span className="summary-conflict">
                {lastResult.conflictCount} conflict{lastResult.conflictCount > 1 ? 's' : ''}
              </span>
            )}
          </span>
        )}
        {hasAlerts && (
          <button className="btn-dismiss-all" onClick={() => store.dismissAllAlerts()}>
            Dismiss All
          </button>
        )}
      </div>

      {hasAlerts && (
        <div className="sltp-alerts">
          {entryAlerts.map(alert => (
            <div
              key={`entry-${alert.tradeId}`}
              className={`sltp-alert ${getEntryAlertClass(alert)}`}
            >
              <span className="alert-icon">{getEntryAlertIcon(alert)}</span>
              <span className="alert-message">{alert.message}</span>
              <button
                className="btn-dismiss"
                onClick={() => store.dismissEntryAlert(alert.tradeId)}
              >
                x
              </button>
            </div>
          ))}
          {sltpAlerts.map(alert => (
            <div
              key={`sltp-${alert.tradeId}`}
              className={`sltp-alert ${getSltpAlertClass(alert)}`}
            >
              <span className="alert-icon">{getSltpAlertIcon(alert)}</span>
              <span className="alert-message">{alert.message}</span>
              <button
                className="btn-dismiss"
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
