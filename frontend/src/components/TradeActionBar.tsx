import { useState } from 'react'
import { observer } from '@legendapp/state/react'
import { TradeCreationForm } from './TradeCreationForm'
import { AlertsModal } from './AlertsModal'
import { TradeEditModal, EditMode } from './TradeEditModal'
import type { AnyAlert, TradeWithMetrics } from '../domain/trade/types'
import { useMarketDataSync } from '../hooks/useMarketDataSync'
import { useTradeAlerts } from '../hooks/useTradeAlerts'
import styles from './TradeActionBar.module.css'

export const TradeActionBar = observer(function TradeActionBar() {
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showAlertsModal, setShowAlertsModal] = useState(false)
  const [alertAction, setAlertAction] = useState<{ alert: AnyAlert; trade: TradeWithMetrics; mode: EditMode } | null>(null)
  const sync = useMarketDataSync()
  const alerts = useTradeAlerts()

  const handleCheckAlerts = async () => {
    await alerts.handleDetect()
    setShowAlertsModal(true)
  }

  return (
    <>
      <div className={styles.actionBar}>
        <button className={styles.btnNewTrade} onClick={() => setShowCreateModal(true)}>
          + New Trade
        </button>

        <div className={styles.syncGroup}>
          <input
            type="date"
            className={styles.dateInput}
            value={sync.startDate}
            onChange={(e) => sync.setStartDate(e.target.value)}
            disabled={sync.loading}
          />
          <button className={styles.btnSync} onClick={sync.handleSync} disabled={sync.loading}>
            {sync.loading ? 'Syncing...' : 'Sync'}
          </button>
          <label className={styles.forceRefreshLabel} title="Wipe stored OHLCV and re-fetch from yfinance. Use after a data correction (e.g., dividend adjustments).">
            <input
              type="checkbox"
              checked={sync.forceRefresh}
              onChange={(e) => sync.setForceRefresh(e.target.checked)}
              disabled={sync.loading}
            />
            <span>Force refresh</span>
          </label>
        </div>

        <div className={styles.alertGroup}>
          <button className={styles.btnDetect} onClick={handleCheckAlerts} disabled={alerts.detecting}>
            {alerts.detecting ? 'Checking...' : 'Check Alerts'}
          </button>
          {(alerts.hasAlerts || alerts.hasDismissed) && (
            <button className={styles.btnDismissAll} onClick={() => setShowAlertsModal(true)}>
              View alerts ({alerts.activeCount})
            </button>
          )}
          {alerts.lastResult && (
            <span className={styles.alertSummary}>
              {alerts.lastResult.autoOpenedCount > 0 && (
                <span className={styles.summaryItem}>{alerts.lastResult.autoOpenedCount} opened</span>
              )}
              {alerts.lastResult.autoClosedCount > 0 && (
                <span className={styles.summaryItem}>{alerts.lastResult.autoClosedCount} closed</span>
              )}
              {alerts.lastResult.conflictCount > 0 && (
                <span className={styles.summaryConflict}>{alerts.lastResult.conflictCount} conflict{alerts.lastResult.conflictCount > 1 ? 's' : ''}</span>
              )}
            </span>
          )}
        </div>
      </div>

      {sync.result && (
        <div className={`${styles.syncResult} ${styles.syncSuccess}`}>
          Synced {sync.result.totalRows} rows ({Object.keys(sync.result.results).length} tickers, {sync.result.skipped.length} skipped)
        </div>
      )}
      {sync.error && (
        <div className={`${styles.syncResult} ${styles.syncError}`}>{sync.error}</div>
      )}

      {showCreateModal && <TradeCreationForm onClose={() => setShowCreateModal(false)} />}
      {showAlertsModal && (
        <AlertsModal
          onClose={() => setShowAlertsModal(false)}
          onTakeAction={(alert, trade, mode) => {
            setShowAlertsModal(false)
            setAlertAction({ alert, trade, mode })
          }}
        />
      )}
      {alertAction && (
        <TradeEditModal
          trade={alertAction.trade}
          mode={alertAction.mode}
          onSaved={() => alerts.markActed(alertAction.alert)}
          onClose={() => {
            setAlertAction(null)
            setShowAlertsModal(true)
          }}
        />
      )}
    </>
  )
})
