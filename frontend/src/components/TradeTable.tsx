import { useState } from 'react'
import { Trade, LiveMetrics } from '../types/trade'
import { TradeEditModal, EditMode } from './TradeEditModal'
import { useLiveMetrics } from '../hooks/useLiveMetrics'

interface TradeTableProps {
  trades: Trade[]
  loading?: boolean
  error?: string | null
  onTradeUpdated?: () => void
}

export function TradeTable({ trades, loading, error, onTradeUpdated }: TradeTableProps) {
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null)
  const [editMode, setEditMode] = useState<EditMode>('edit')
  const { metrics: liveMetrics } = useLiveMetrics(trades)

  const handleOpenModal = (trade: Trade, mode: EditMode) => {
    setEditingTrade(trade)
    setEditMode(mode)
  }

  const handleCloseModal = () => {
    setEditingTrade(null)
  }

  const handleTradeUpdated = () => {
    if (onTradeUpdated) {
      onTradeUpdated()
    }
  }
  if (loading) {
    return <div data-testid="loading">Loading trades...</div>
  }

  if (error) {
    return <div data-testid="error" className="error">{error}</div>
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

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleDateString()
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
        return 'status-open'
      case 'close':
        return 'status-close'
      default:
        return 'status-plan'
    }
  }

  const getDistanceClass = (distance: number | null, isTP: boolean): string => {
    if (distance === null) return ''
    const absDistance = Math.abs(distance)
    if (absDistance < 0.03) {
      return isTP ? 'distance-near' : 'distance-danger'
    }
    if (absDistance < 0.10) {
      return 'distance-warning'
    }
    return ''
  }

  const formatLiveMetric = (
    trade: Trade,
    metric: LiveMetrics | undefined,
    type: 'price' | 'slDist' | 'tpDist' | 'pnl'
  ): string => {
    if (trade.status !== 'open') return '-'
    if (!metric) return '-'

    switch (type) {
      case 'price':
        return metric.currentPrice !== null ? formatCurrency(metric.currentPrice) : '-'
      case 'slDist':
        return metric.distanceToSL !== null ? formatPercent(metric.distanceToSL) : '-'
      case 'tpDist':
        return metric.distanceToTP !== null ? formatPercent(metric.distanceToTP) : '-'
      case 'pnl':
        if (metric.unrealizedPnL === null || metric.unrealizedPnLPct === null) return '-'
        const pnlStr = formatCurrency(metric.unrealizedPnL)
        const pctStr = formatPercent(metric.unrealizedPnLPct)
        return `${pnlStr} (${pctStr})`
      default:
        return '-'
    }
  }

  return (
    <>
    <table data-testid="trade-table" className="trade-table">
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
          <th>Unr. PnL</th>
          <th>Risk</th>
          <th>Risk %</th>
          <th>Profit</th>
          <th>Profit %</th>
          <th>Ratio</th>
          <th>Strategy</th>
          <th>Planned</th>
          <th>Actual</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {trades.map((trade) => (
          <tr key={trade.id} data-testid={`trade-row-${trade.id}`}>
            <td>{trade.number ?? trade.id}</td>
            <td>{trade.ticker}</td>
            <td className={getStatusClass(trade.status)}>{trade.status}</td>
            <td>{formatCurrency(trade.amount)}</td>
            <td>{trade.units}</td>
            <td>{formatCurrency(trade.entry_price)}</td>
            <td>{formatCurrency(trade.stop_loss)}</td>
            <td>{formatCurrency(trade.take_profit)}</td>
            <td>{formatLiveMetric(trade, liveMetrics[trade.id], 'price')}</td>
            <td className={getDistanceClass(liveMetrics[trade.id]?.distanceToSL ?? null, false)}>
              {formatLiveMetric(trade, liveMetrics[trade.id], 'slDist')}
            </td>
            <td className={getDistanceClass(liveMetrics[trade.id]?.distanceToTP ?? null, true)}>
              {formatLiveMetric(trade, liveMetrics[trade.id], 'tpDist')}
            </td>
            <td className={
              liveMetrics[trade.id]?.unrealizedPnL !== null && liveMetrics[trade.id]?.unrealizedPnL !== undefined
                ? (liveMetrics[trade.id]!.unrealizedPnL! > 0 ? 'positive' : 'negative')
                : ''
            }>
              {formatLiveMetric(trade, liveMetrics[trade.id], 'pnl')}
            </td>
            <td className={trade.risk_abs < 0 ? 'negative' : 'positive'}>
              {formatCurrency(trade.risk_abs)}
            </td>
            <td className={trade.risk_pct < 0 ? 'negative' : 'positive'}>
              {formatPercent(trade.risk_pct)}
            </td>
            <td className={trade.profit_abs > 0 ? 'positive' : 'negative'}>
              {formatCurrency(trade.profit_abs)}
            </td>
            <td className={trade.profit_pct > 0 ? 'positive' : 'negative'}>
              {formatPercent(trade.profit_pct)}
            </td>
            <td>{formatRatio(trade.ratio)}</td>
            <td>{trade.strategy_name ?? '-'}</td>
            <td>{formatDate(trade.date_planned)}</td>
            <td>{formatDate(trade.date_actual)}</td>
            <td className="trade-actions">
              {trade.status === 'plan' && (
                <>
                  <button
                    className="btn-action btn-open"
                    onClick={() => handleOpenModal(trade, 'open')}
                  >
                    Open
                  </button>
                  <button
                    className="btn-action btn-edit"
                    onClick={() => handleOpenModal(trade, 'edit')}
                  >
                    Edit
                  </button>
                </>
              )}
              {trade.status === 'open' && (
                <>
                  <button
                    className="btn-action btn-close"
                    onClick={() => handleOpenModal(trade, 'close')}
                  >
                    Close
                  </button>
                  <button
                    className="btn-action btn-edit"
                    onClick={() => handleOpenModal(trade, 'edit')}
                  >
                    Edit
                  </button>
                </>
              )}
              {trade.status === 'close' && (
                <button
                  className="btn-action btn-edit"
                  onClick={() => handleOpenModal(trade, 'edit')}
                >
                  Edit
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>

    {editingTrade && (
      <TradeEditModal
        trade={editingTrade}
        mode={editMode}
        onClose={handleCloseModal}
        onTradeUpdated={handleTradeUpdated}
      />
    )}
  </>
  )
}
