import { useState } from 'react'
import { detectTradeHits } from '../api/trades'
import { EntryAlert, SLTPAlert } from '../types/trade'

interface TradeAlertBannerProps {
  onTradesUpdated: () => void
}

export function TradeAlertBanner({ onTradesUpdated }: TradeAlertBannerProps) {
  const [entryAlerts, setEntryAlerts] = useState<EntryAlert[]>([])
  const [sltpAlerts, setSltpAlerts] = useState<SLTPAlert[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<{
    autoOpenedCount: number
    autoClosedCount: number
    conflictCount: number
  } | null>(null)

  const handleDetect = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await detectTradeHits()
      setEntryAlerts(result.entry_alerts)
      setSltpAlerts(result.sltp_alerts)
      setLastResult({
        autoOpenedCount: result.auto_opened_count,
        autoClosedCount: result.auto_closed_count,
        conflictCount: result.conflict_count,
      })
      if (result.auto_opened_count > 0 || result.auto_closed_count > 0) {
        onTradesUpdated()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to detect trade hits')
    } finally {
      setLoading(false)
    }
  }

  const handleDismissEntry = (tradeId: number) => {
    setEntryAlerts(prev => prev.filter(a => a.trade_id !== tradeId))
  }

  const handleDismissSltp = (tradeId: number) => {
    setSltpAlerts(prev => prev.filter(a => a.trade_id !== tradeId))
  }

  const handleDismissAll = () => {
    setEntryAlerts([])
    setSltpAlerts([])
    setLastResult(null)
  }

  const getEntryAlertClass = (alert: EntryAlert): string => {
    if (alert.auto_opened) return 'alert-entry-opened'
    return 'alert-entry'
  }

  const getSltpAlertClass = (alert: SLTPAlert): string => {
    if (alert.auto_closed) return 'alert-auto-closed'
    if (alert.hit_type === 'both') return 'alert-conflict'
    if (alert.hit_type === 'sl') return 'alert-sl'
    return 'alert-tp'
  }

  const getEntryAlertIcon = (alert: EntryAlert): string => {
    if (alert.auto_opened) return 'check'
    return 'arrow-right'
  }

  const getSltpAlertIcon = (alert: SLTPAlert): string => {
    if (alert.auto_closed) return 'check'
    if (alert.hit_type === 'both') return 'warning'
    if (alert.hit_type === 'sl') return 'X'
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
          <button className="btn-dismiss-all" onClick={handleDismissAll}>
            Dismiss All
          </button>
        )}
      </div>

      {error && <div className="sltp-error">{error}</div>}

      {hasAlerts && (
        <div className="sltp-alerts">
          {entryAlerts.map(alert => (
            <div
              key={`entry-${alert.trade_id}`}
              className={`sltp-alert ${getEntryAlertClass(alert)}`}
            >
              <span className="alert-icon">{getEntryAlertIcon(alert)}</span>
              <span className="alert-message">{alert.message}</span>
              <button
                className="btn-dismiss"
                onClick={() => handleDismissEntry(alert.trade_id)}
              >
                x
              </button>
            </div>
          ))}
          {sltpAlerts.map(alert => (
            <div
              key={`sltp-${alert.trade_id}`}
              className={`sltp-alert ${getSltpAlertClass(alert)}`}
            >
              <span className="alert-icon">{getSltpAlertIcon(alert)}</span>
              <span className="alert-message">{alert.message}</span>
              <button
                className="btn-dismiss"
                onClick={() => handleDismissSltp(alert.trade_id)}
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
