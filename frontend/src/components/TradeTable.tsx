import { Trade } from '../types/trade'

interface TradeTableProps {
  trades: Trade[]
  loading?: boolean
  error?: string | null
}

export function TradeTable({ trades, loading, error }: TradeTableProps) {
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

  return (
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
          <th>Risk</th>
          <th>Risk %</th>
          <th>Profit</th>
          <th>Profit %</th>
          <th>Ratio</th>
          <th>Strategy</th>
          <th>Planned</th>
          <th>Actual</th>
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
          </tr>
        ))}
      </tbody>
    </table>
  )
}
