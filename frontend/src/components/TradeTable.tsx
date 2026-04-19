import React, { useState, useEffect } from 'react'
import { observer } from '@legendapp/state/react'
import type { TradeWithMetrics, LiveMetrics } from '../domain/trade/types'
import { ExitLevelSummary } from './ExitLevelSummary'
import { TradeActions } from './TradeActions'
import { useLiveMetricsStore, useTradeStore } from '../container/ContainerContext'
import { formatPlanAge, formatOpenAge, formatPlanToOpen, formatOpenToClose } from '../utils/trade'
import { getPositionNum } from '../utils/tradeLive'
import { formatPrice } from '../utils/priceFormat'
import styles from './TradeTable.module.css'

interface TradeTableProps {
  trades: TradeWithMetrics[]
  loading?: boolean
  error?: string | null
}

type SortKey = 'tickerName' | null
type SortDir = 'asc' | 'desc'

export const TradeTable = observer(function TradeTable({ trades, loading, error }: TradeTableProps) {
  const [expandedTradeId, setExpandedTradeId] = useState<number | null>(null)
  const [selectedTradeId, setSelectedTradeId] = useState<number | null>(null)
  const [docked, setDocked] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const handleSort = (key: Exclude<SortKey, null>) => {
    if (sortKey !== key) {
      setSortKey(key)
      setSortDir('asc')
    } else if (sortDir === 'asc') {
      setSortDir('desc')
    } else {
      setSortKey(null)
      setSortDir('asc')
    }
  }
  const metricsStore = useLiveMetricsStore()
  const tradeStore = useTradeStore()

  useEffect(() => {
    metricsStore.refreshPrices()
  }, [trades, metricsStore])

  const liveMetrics = metricsStore.metrics$.get()

  if (loading) {
    return <div data-testid="loading">Loading trades...</div>
  }

  if (error) {
    return <div data-testid="error" className={styles.error}>{error}</div>
  }

  if (trades.length === 0) {
    return <div data-testid="empty">No trades found</div>
  }

  const formatCurrency = (value: number, trade: TradeWithMetrics) =>
    formatPrice(value, trade.tickerCurrency, trade.tickerPriceHint)

  const formatDate = (date: Date | null) => {
    if (!date) return '-'
    return date.toLocaleDateString()
  }

  const formatPercent = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'percent',
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(value)
  }

  const formatRatio = (value: number) => {
    return value.toFixed(2)
  }

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'ordered':
        return styles.statusOrdered
      case 'open':
        return styles.statusOpen
      case 'close':
        return styles.statusClose
      case 'canceled':
        return styles.statusCanceled
      default:
        return styles.statusPlan
    }
  }

  const getPEDistanceClass = (distance: number | null): string => {
    if (distance === null) return ''
    if (distance > 0) return styles.distanceNear
    if (distance < 0) return styles.distanceDanger
    return ''
  }

  const formatLiveMetric = (
    trade: TradeWithMetrics,
    metric: LiveMetrics | undefined,
    type: 'price' | 'peDist' | 'pnl'
  ): string => {
    // PE distance only shown for plan and ordered trades
    if (type === 'peDist') {
      if (trade.status !== 'plan' && trade.status !== 'ordered') return '-'
    } else if (type === 'price') {
      // Current price shown for open, plan, and ordered trades
      if (trade.status !== 'open' && trade.status !== 'plan' && trade.status !== 'ordered') return '-'
    } else {
      // PnL only shown for open trades
      if (trade.status !== 'open') return '-'
    }
    if (!metric) return '-'

    switch (type) {
      case 'price':
        return metric.currentPrice !== null ? formatCurrency(metric.currentPrice.toNumber(), trade) : '-'
      case 'peDist':
        return metric.distanceToPE !== null ? formatPercent(metric.distanceToPE.toNumber()) : '-'
      case 'pnl':
        if (metric.unrealizedPnL === null || metric.unrealizedPnLPct === null) return '-'
        const pnlStr = formatCurrency(metric.unrealizedPnL.toNumber(), trade)
        const pctStr = formatPercent(metric.unrealizedPnLPct.toNumber())
        return `${pnlStr} (${pctStr})`
      default:
        return '-'
    }
  }

  return (
    <>
    <div className={styles.tableControls}>
      <label className={styles.dockToggle}>
        <input type="checkbox" checked={docked} onChange={(e) => setDocked(e.target.checked)} />
        Dock columns
      </label>
    </div>
    <div className={styles.tradeTableContainer}>
    <table data-testid="trade-table" className={styles.tradeTable}>
      <thead>
        <tr>
          <th className={docked ? `${styles.stickyCol} ${styles.stickyCol1}` : ''}>#</th>
          <th className={docked ? `${styles.stickyCol} ${styles.stickyCol2}` : ''}>Ticker</th>
          <th
            className={`${docked ? `${styles.stickyCol} ${styles.stickyCol3}` : ''} ${styles.tickerName} ${styles.sortable}`}
            onClick={() => handleSort('tickerName')}
          >
            Name <span className={styles.sortIndicator}>{sortKey === 'tickerName' ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
          </th>
          <th className={docked ? `${styles.stickyCol} ${styles.stickyCol4}` : ''}>Status</th>
          <th className={styles.separator}>Units</th>
          <th>Entry</th>
          <th>Amount</th>
          <th className={styles.separator}>Stop Loss</th>
          <th>Take Profit</th>
          <th className={styles.separator}>Risk</th>
          <th>Risk %</th>
          <th>Profit</th>
          <th>Profit %</th>
          <th>Ratio</th>
          <th className={styles.separator}>Current</th>
          <th>Unr. PnL</th>
          <th>Position</th>
          <th>PE Dist</th>
          <th className={styles.separator}>Planned</th>
          <th>Actual</th>
          <th>Plan Age</th>
          <th>Open Age</th>
          <th>Plan→Open</th>
          <th>Open→Close</th>
          <th className={styles.separator}>Strategy</th>
          <th>Auto</th>
          <th>Mode</th>
          <th>Remaining</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {(sortKey
          ? [...trades].sort((a, b) => {
              const av = (a.tickerName ?? '').toLowerCase()
              const bv = (b.tickerName ?? '').toLowerCase()
              const cmp = av.localeCompare(bv)
              return sortDir === 'asc' ? cmp : -cmp
            })
          : trades
        ).map((trade) => {
          const positionNum = getPositionNum(liveMetrics[trade.id])
          const peDistNum = liveMetrics[trade.id]?.distanceToPE?.toNumber() ?? null
          const pnlNum = liveMetrics[trade.id]?.unrealizedPnL?.toNumber() ?? null

          return (
          <React.Fragment key={trade.id}>
          <tr
            data-testid={`trade-row-${trade.id}`}
            className={selectedTradeId === trade.id ? styles.rowSelected : ''}
            onClick={() => setSelectedTradeId(selectedTradeId === trade.id ? null : trade.id)}
          >
            <td className={docked ? `${styles.stickyCol} ${styles.stickyCol1}` : ''}>{trade.number ?? trade.id}</td>
            <td className={docked ? `${styles.stickyCol} ${styles.stickyCol2}` : ''}>{trade.ticker}</td>
            <td className={`${docked ? `${styles.stickyCol} ${styles.stickyCol3}` : ''} ${styles.tickerName}`} title={trade.tickerName || ''}>{trade.tickerName || '-'}</td>
            <td className={`${docked ? `${styles.stickyCol} ${styles.stickyCol4}` : ''} ${getStatusClass(trade.status)}`}>{trade.status}</td>
            <td className={styles.separator}>{trade.units}</td>
            <td>{formatCurrency(trade.entryPrice.toNumber(), trade)}</td>
            <td>{formatCurrency(trade.amount.toNumber(), trade)}</td>
            <td className={styles.separator}>{formatCurrency(trade.stopLoss.toNumber(), trade)}</td>
            <td>{formatCurrency(trade.takeProfit.toNumber(), trade)}</td>
            <td className={`${styles.separator} ${trade.riskAbs.isNegative() ? 'negative' : 'positive'}`}>
              {formatCurrency(trade.riskAbs.toNumber(), trade)}
            </td>
            <td className={trade.riskPct.isNegative() ? 'negative' : 'positive'}>
              {formatPercent(trade.riskPct.toNumber())}
            </td>
            <td className={trade.profitAbs.isPositive() ? 'positive' : 'negative'}>
              {formatCurrency(trade.profitAbs.toNumber(), trade)}
            </td>
            <td className={trade.profitPct.isPositive() ? 'positive' : 'negative'}>
              {formatPercent(trade.profitPct.toNumber())}
            </td>
            <td>{formatRatio(trade.ratio.toNumber())}</td>
            <td className={styles.separator}>{formatLiveMetric(trade, liveMetrics[trade.id], 'price')}</td>
            <td className={
              pnlNum !== null
                ? (pnlNum > 0 ? 'positive' : 'negative')
                : ''
            }>
              {formatLiveMetric(trade, liveMetrics[trade.id], 'pnl')}
            </td>
            <td className={
              positionNum !== null
                ? (positionNum >= 0 ? styles.distanceNear : styles.distanceDanger)
                : ''
            }>
              {trade.status !== 'open' ? '-' : (positionNum !== null ? formatPercent(positionNum) : '-')}
            </td>
            <td className={getPEDistanceClass(peDistNum)}>
              {formatLiveMetric(trade, liveMetrics[trade.id], 'peDist')}
            </td>
            <td className={styles.separator}>{formatDate(trade.datePlanned)}</td>
            <td>{formatDate(trade.dateActual)}</td>
            <td>{formatPlanAge(trade)}</td>
            <td>{formatOpenAge(trade)}</td>
            <td>{formatPlanToOpen(trade)}</td>
            <td>{formatOpenToClose(trade)}</td>
            <td className={styles.separator}>{trade.strategyName ?? '-'}</td>
            <td>{trade.autoDetect ? 'Yes' : '-'}</td>
            <td
              className={`${trade.isLayered ? styles.modeLayered : styles.modeSimple}${trade.isLayered ? ' clickable' : ''}`}
              onClick={trade.isLayered ? () => setExpandedTradeId(expandedTradeId === trade.id ? null : trade.id) : undefined}
              style={trade.isLayered ? { cursor: 'pointer' } : undefined}
            >
              {trade.isLayered
                ? <>{expandedTradeId === trade.id ? '\u25BC' : '\u25B6'} Layered</>
                : 'Simple'}
            </td>
            <td>
              {trade.isLayered && trade.remainingUnits !== null
                ? `${trade.remainingUnits}/${trade.units}`
                : '-'}
            </td>
            <td className={styles.tradeActions}>
              <TradeActions
                trade={trade}
                currentPrice={liveMetrics[trade.id]?.currentPrice?.toNumber() ?? null}
              />
            </td>
          </tr>
          {trade.isLayered && expandedTradeId === trade.id && (
            <tr className={styles.exitLevelExpansionRow}>
              <td colSpan={29}>
                <ExitLevelSummary
                  levels={trade.exitLevels}
                  entryPrice={trade.entryPrice.toNumber()}
                  units={trade.units}
                  tradeStatus={trade.status}
                  currency={trade.tickerCurrency}
                  priceHint={trade.tickerPriceHint}
                  onLevelHit={(levelId, hitDate, hitPrice) =>
                    tradeStore.markExitLevelHit(trade.id, levelId, { hit_date: hitDate, hit_price: hitPrice })
                  }
                  onLevelRevert={(levelId) =>
                    tradeStore.revertExitLevelHit(trade.id, levelId)
                  }
                />
              </td>
            </tr>
          )}
          </React.Fragment>
          )
        })}
      </tbody>
    </table>
    </div>
  </>
  )
})
