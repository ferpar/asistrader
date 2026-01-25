import { useState } from 'react'
import { detectSLTPHits } from '../api/trades'
import { SLTPAlert } from '../types/trade'

interface SLTPAlertBannerProps {
  onTradesClosed: () => void
}

export function SLTPAlertBanner({ onTradesClosed }: SLTPAlertBannerProps) {
  const [alerts, setAlerts] = useState<SLTPAlert[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<{
    autoClosedCount: number
    conflictCount: number
  } | null>(null)

  const handleDetect = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await detectSLTPHits()
      setAlerts(result.alerts)
      setLastResult({
        autoClosedCount: result.auto_closed_count,
        conflictCount: result.conflict_count,
      })
      if (result.auto_closed_count > 0) {
        onTradesClosed()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to detect SL/TP hits')
    } finally {
      setLoading(false)
    }
  }

  const handleDismiss = (tradeId: number) => {
    setAlerts(prev => prev.filter(a => a.trade_id !== tradeId))
  }

  const handleDismissAll = () => {
    setAlerts([])
    setLastResult(null)
  }

  const getAlertClass = (alert: SLTPAlert): string => {
    if (alert.auto_closed) return 'alert-auto-closed'
    if (alert.hit_type === 'both') return 'alert-conflict'
    if (alert.hit_type === 'sl') return 'alert-sl'
    return 'alert-tp'
  }

  const getAlertIcon = (alert: SLTPAlert): string => {
    if (alert.auto_closed) return 'check'
    if (alert.hit_type === 'both') return 'warning'
    if (alert.hit_type === 'sl') return 'X'
    return 'check'
  }

  return (
    <div className="sltp-alert-banner">
      <div className="sltp-header">
        <button
          className="btn-detect-sltp"
          onClick={handleDetect}
          disabled={loading}
        >
          {loading ? 'Checking...' : 'Check SL/TP Hits'}
        </button>
        {lastResult && (
          <span className="sltp-summary">
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
        {alerts.length > 0 && (
          <button className="btn-dismiss-all" onClick={handleDismissAll}>
            Dismiss All
          </button>
        )}
      </div>

      {error && <div className="sltp-error">{error}</div>}

      {alerts.length > 0 && (
        <div className="sltp-alerts">
          {alerts.map(alert => (
            <div
              key={alert.trade_id}
              className={`sltp-alert ${getAlertClass(alert)}`}
            >
              <span className="alert-icon">{getAlertIcon(alert)}</span>
              <span className="alert-message">{alert.message}</span>
              <button
                className="btn-dismiss"
                onClick={() => handleDismiss(alert.trade_id)}
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
