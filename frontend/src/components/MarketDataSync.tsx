import { useMarketDataSync } from '../hooks/useMarketDataSync'
import styles from './MarketDataSync.module.css'

export function MarketDataSync() {
  const sync = useMarketDataSync()

  return (
    <section className={styles.marketDataSync}>
      <h2>Market Data Sync</h2>
      <div className={styles.syncControls}>
        <input
          type="date"
          value={sync.startDate}
          onChange={(e) => sync.setStartDate(e.target.value)}
          disabled={sync.loading}
        />
        <button onClick={sync.handleSync} disabled={sync.loading}>
          {sync.loading ? 'Syncing...' : 'Sync Market Data'}
        </button>
        <label
          className={styles.forceRefreshLabel}
          title="Wipe stored OHLCV and re-fetch from yfinance. Use after a data correction (e.g., dividend adjustments)."
        >
          <input
            type="checkbox"
            checked={sync.forceRefresh}
            onChange={(e) => sync.setForceRefresh(e.target.checked)}
            disabled={sync.loading}
          />
          <span>Force refresh</span>
        </label>
      </div>
      {sync.result && (
        <div className={`${styles.syncResult} ${styles.success}`}>
          ✓ Synced {sync.result.totalRows} rows ({Object.keys(sync.result.results).length} tickers, {sync.result.skipped.length} skipped)
        </div>
      )}
      {sync.error && (
        <div className={`${styles.syncResult} ${styles.error}`}>{sync.error}</div>
      )}
    </section>
  )
}
