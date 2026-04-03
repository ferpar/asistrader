import React, { useState, useEffect } from 'react'
import { observer } from '@legendapp/state/react'
import type { TradeWithMetrics, LiveMetrics } from '../domain/trade/types'
import { TradeEditModal, EditMode } from './TradeEditModal'
import { ExitLevelSummary } from './ExitLevelSummary'
import { useLiveMetricsStore, useTradeStore, useFundStore } from '../container/ContainerContext'
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
  const fundStore = useFundStore()

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
    fundStore.loadEvents()
  }

  const checkFundsAndOrder = async (trade: TradeWithMetrics) => {
    const balance = fundStore.balance$.get()
    const amount = trade.amount.toNumber()
    if (amount > balance.maxPerTrade.toNumber()) {
      alert(`Trade amount $${amount.toFixed(2)} exceeds max per trade $${balance.maxPerTrade.toFixed(2)}`)
      return
    }
    if (amount > balance.available.toNumber()) {
      alert(`Trade amount $${amount.toFixed(2)} exceeds available funds $${balance.available.toFixed(2)}`)
      return
    }
    await tradeStore.updateTrade(trade.id, { status: 'ordered' })
    await fundStore.loadEvents()
  }

  const checkFundsAndOpen = async (trade: TradeWithMetrics) => {
    if (!trade.paperTrade) {
      const balance = fundStore.balance$.get()
      const amount = trade.amount.toNumber()
      if (amount > balance.maxPerTrade.toNumber()) {
        alert(`Trade amount $${amount.toFixed(2)} exceeds max per trade $${balance.maxPerTrade.toFixed(2)}`)
        return
      }
      if (amount > balance.available.toNumber()) {
        alert(`Trade amount $${amount.toFixed(2)} exceeds available funds $${balance.available.toFixed(2)}`)
        return
      }
    }
    handleOpenModal(trade, 'open')
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
    if (distance >= 0.05) return styles.distanceNear      // +5% or more = good
    if (distance <= -0.05) return styles.distanceDanger   // -5% or more = bad
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
        return metric.currentPrice !== null ? formatCurrency(metric.currentPrice.toNumber()) : '-'
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
          <th>Position</th>
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
          const tpDistNum = liveMetrics[trade.id]?.distanceToTP?.toNumber() ?? null
          const slDistNum = liveMetrics[trade.id]?.distanceToSL?.toNumber() ?? null
          // Consolidated position: positive = toward TP, negative = toward SL
          const positionNum = tpDistNum !== null && slDistNum !== null
            ? (tpDistNum >= 0 ? tpDistNum : -slDistNum)
            : null
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
                  {!trade.paperTrade && (
                    <button
                      className={`${styles.btnAction} ${styles.btnOrder}`}
                      onClick={() => checkFundsAndOrder(trade)}
                    >
                      Order
                    </button>
                  )}
                  <button
                    className={`${styles.btnAction} ${styles.btnOpen}`}
                    onClick={() => checkFundsAndOpen(trade)}
                  >
                    Open
                  </button>
                  <button
                    className={`${styles.btnAction} ${styles.btnCancel}`}
                    onClick={() => handleOpenModal(trade, 'cancel')}
                  >
                    Cancel
                  </button>
                  <button
                    className={`${styles.btnAction} ${styles.btnEdit}`}
                    onClick={() => handleOpenModal(trade, 'edit')}
                  >
                    Edit
                  </button>
                </>
              )}
              {trade.status === 'ordered' && (
                <>
                  <button
                    className={`${styles.btnAction} ${styles.btnOpen}`}
                    onClick={() => handleOpenModal(trade, 'open')}
                  >
                    Open
                  </button>
                  <button
                    className={`${styles.btnAction} ${styles.btnRetract}`}
                    onClick={async () => { await tradeStore.updateTrade(trade.id, { status: 'plan' }); await fundStore.loadEvents() }}
                  >
                    Retract
                  </button>
                  <button
                    className={`${styles.btnAction} ${styles.btnCancel}`}
                    onClick={() => handleOpenModal(trade, 'cancel')}
                  >
                    Cancel
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
              <td colSpan={28}>
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
