import React, { useState, useEffect } from 'react'
import { observer } from '@legendapp/state/react'
import type { TradeWithMetrics, LiveMetrics } from '../domain/trade/types'
import { TradeEditModal, EditMode } from './TradeEditModal'
import { ExitLevelSummary } from './ExitLevelSummary'
import { useLiveMetricsStore, useTradeStore } from '../container/ContainerContext'
import { formatPlanAge, formatOpenAge, formatPlanToOpen, formatOpenToClose } from '../utils/trade'
import styles from './TradeTable.module.css'

interface TradeTableProps {
  trades: TradeWithMetrics[]
  loading?: boolean
  error?: string | null
}

export const TradeTable = observer(function TradeTable({ trades, loading, error }: TradeTableProps) {
  const [editingTrade, setEditingTrade] = useState<TradeWithMetrics | null>(null)
  const [editMode, setEditMode] = useState<EditMode>('edit')
  const [expandedTradeId, setExpandedTradeId] = useState<number | null>(null)
  const metricsStore = useLiveMetricsStore()
  const tradeStore = useTradeStore()

  useEffect(() => {
    metricsStore.refreshPrices()
  }, [trades, metricsStore])

  const liveMetrics = metricsStore.metrics$.get()

  const handleOpenModal = (trade: TradeWithMetrics, mode: EditMode) => {
    setEditingTrade(trade)
    setEditMode(mode)
  }

  const handleCloseModal = () => {
    setEditingTrade(null)
  }

  if (loading) {
    return <div data-testid="loading">Loading trades...</div>
  }

  if (error) {
    return <div data-testid="error" className={styles.error}>{error}</div>
  }

  if (trades.length === 0) {
    return <div data-testid="empty">No trades found</div>
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value)
  }

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
      case 'open':
        return styles.statusOpen
      case 'close':
        return styles.statusClose
      default:
        return styles.statusPlan
    }
  }

  const getDistanceClass = (distance: number | null, isTP: boolean): string => {
    if (distance === null) return ''
    const absDistance = Math.abs(distance)
    if (absDistance < 0.03) {
      return isTP ? styles.distanceNear : styles.distanceDanger
    }
    if (absDistance < 0.10) {
      return styles.distanceWarning
    }
    return ''
  }

  const getPEDistanceClass = (distance: number | null): string => {
    if (distance === null) return ''
    if (distance >= 0.05) return styles.distanceNear      // +5% or more = good
    if (distance <= -0.05) return styles.distanceDanger   // -5% or more = bad
    return ''
  }

  const formatLiveMetric = (
    trade: TradeWithMetrics,
    metric: LiveMetrics | undefined,
    type: 'price' | 'slDist' | 'tpDist' | 'peDist' | 'pnl'
  ): string => {
    // PE distance only shown for plan trades
    if (type === 'peDist') {
      if (trade.status !== 'plan') return '-'
    } else if (type === 'price') {
      // Current price shown for open and plan trades
      if (trade.status !== 'open' && trade.status !== 'plan') return '-'
    } else {
      // SL/TP distance, PnL only shown for open trades
      if (trade.status !== 'open') return '-'
    }
    if (!metric) return '-'

    switch (type) {
      case 'price':
        return metric.currentPrice !== null ? formatCurrency(metric.currentPrice.toNumber()) : '-'
      case 'slDist':
        return metric.distanceToSL !== null ? formatPercent(metric.distanceToSL.toNumber()) : '-'
      case 'tpDist':
        return metric.distanceToTP !== null ? formatPercent(metric.distanceToTP.toNumber()) : '-'
      case 'peDist':
        return metric.distanceToPE !== null ? formatPercent(metric.distanceToPE.toNumber()) : '-'
      case 'pnl':
        if (metric.unrealizedPnL === null || metric.unrealizedPnLPct === null) return '-'
        const pnlStr = formatCurrency(metric.unrealizedPnL.toNumber())
        const pctStr = formatPercent(metric.unrealizedPnLPct.toNumber())
        return `${pnlStr} (${pctStr})`
      default:
        return '-'
    }
  }

  return (
    <>
    <div className={styles.tradeTableContainer}>
    <table data-testid="trade-table" className={styles.tradeTable}>
      <thead>
        <tr>
          <th>#</th>
          <th>Ticker</th>
          <th>Status</th>
          <th>Amount</th>
          <th>Units</th>
          <th>Entry</th>
          <th>Stop Loss</th>
          <th>Take Profit</th>
          <th>Current</th>
          <th>SL Dist</th>
          <th>TP Dist</th>
          <th>PE Dist</th>
          <th>Unr. PnL</th>
          <th>Risk</th>
          <th>Risk %</th>
          <th>Profit</th>
          <th>Profit %</th>
          <th>Ratio</th>
          <th>Strategy</th>
          <th>Paper</th>
          <th>Mode</th>
          <th>Remaining</th>
          <th>Planned</th>
          <th>Actual</th>
          <th>Plan Age</th>
          <th>Open Age</th>
          <th>Plan→Open</th>
          <th>Open→Close</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {trades.map((trade) => {
          const slDistNum = liveMetrics[trade.id]?.distanceToSL?.toNumber() ?? null
          const tpDistNum = liveMetrics[trade.id]?.distanceToTP?.toNumber() ?? null
          const peDistNum = liveMetrics[trade.id]?.distanceToPE?.toNumber() ?? null
          const pnlNum = liveMetrics[trade.id]?.unrealizedPnL?.toNumber() ?? null

          return (
          <React.Fragment key={trade.id}>
          <tr data-testid={`trade-row-${trade.id}`}>
            <td>{trade.number ?? trade.id}</td>
            <td>{trade.ticker}</td>
            <td className={getStatusClass(trade.status)}>{trade.status}</td>
            <td>{formatCurrency(trade.amount.toNumber())}</td>
            <td>{trade.units}</td>
            <td>{formatCurrency(trade.entryPrice.toNumber())}</td>
            <td>{formatCurrency(trade.stopLoss.toNumber())}</td>
            <td>{formatCurrency(trade.takeProfit.toNumber())}</td>
            <td>{formatLiveMetric(trade, liveMetrics[trade.id], 'price')}</td>
            <td className={getDistanceClass(slDistNum, false)}>
              {formatLiveMetric(trade, liveMetrics[trade.id], 'slDist')}
            </td>
            <td className={getDistanceClass(tpDistNum, true)}>
              {formatLiveMetric(trade, liveMetrics[trade.id], 'tpDist')}
            </td>
            <td className={getPEDistanceClass(peDistNum)}>
              {formatLiveMetric(trade, liveMetrics[trade.id], 'peDist')}
            </td>
            <td className={
              pnlNum !== null
                ? (pnlNum > 0 ? 'positive' : 'negative')
                : ''
            }>
              {formatLiveMetric(trade, liveMetrics[trade.id], 'pnl')}
            </td>
            <td className={trade.riskAbs.isNegative() ? 'negative' : 'positive'}>
              {formatCurrency(trade.riskAbs.toNumber())}
            </td>
            <td className={trade.riskPct.isNegative() ? 'negative' : 'positive'}>
              {formatPercent(trade.riskPct.toNumber())}
            </td>
            <td className={trade.profitAbs.isPositive() ? 'positive' : 'negative'}>
              {formatCurrency(trade.profitAbs.toNumber())}
            </td>
            <td className={trade.profitPct.isPositive() ? 'positive' : 'negative'}>
              {formatPercent(trade.profitPct.toNumber())}
            </td>
            <td>{formatRatio(trade.ratio.toNumber())}</td>
            <td>{trade.strategyName ?? '-'}</td>
            <td>{trade.paperTrade ? 'Yes' : '-'}</td>
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
            <td>{formatDate(trade.datePlanned)}</td>
            <td>{formatDate(trade.dateActual)}</td>
            <td>{formatPlanAge(trade)}</td>
            <td>{formatOpenAge(trade)}</td>
            <td>{formatPlanToOpen(trade)}</td>
            <td>{formatOpenToClose(trade)}</td>
            <td className={styles.tradeActions}>
              {trade.status === 'plan' && (
                <>
                  <button
                    className={`${styles.btnAction} ${styles.btnOpen}`}
                    onClick={() => handleOpenModal(trade, 'open')}
                  >
                    Open
                  </button>
                  <button
                    className={`${styles.btnAction} ${styles.btnEdit}`}
                    onClick={() => handleOpenModal(trade, 'edit')}
                  >
                    Edit
                  </button>
                </>
              )}
              {trade.status === 'open' && (
                <>
                  <button
                    className={`${styles.btnAction} ${styles.btnClose}`}
                    onClick={() => handleOpenModal(trade, 'close')}
                  >
                    Close
                  </button>
                  <button
                    className={`${styles.btnAction} ${styles.btnEdit}`}
                    onClick={() => handleOpenModal(trade, 'edit')}
                  >
                    Edit
                  </button>
                </>
              )}
              {trade.status === 'close' && (
                <button
                  className={`${styles.btnAction} ${styles.btnEdit}`}
                  onClick={() => handleOpenModal(trade, 'edit')}
                >
                  Edit
                </button>
              )}
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

    {editingTrade && (
      <TradeEditModal
        trade={editingTrade}
        mode={editMode}
        onClose={handleCloseModal}
      />
    )}
  </>
  )
})
