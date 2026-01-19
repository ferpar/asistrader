import { Trade } from '../types/trade'

interface TradeStatisticsProps {
  trades: Trade[]
}

interface Statistics {
  totalTrades: number
  closedTrades: number
  wins: number
  losses: number
  winRate: number
  totalPnL: number
  avgWin: number
  avgLoss: number
  profitFactor: number
}

function calculateStatistics(trades: Trade[]): Statistics {
  const closedTrades = trades.filter(t => t.status === 'close')
  const winners = closedTrades.filter(t => t.exit_type === 'tp')
  const losers = closedTrades.filter(t => t.exit_type === 'sl')

  const calculatePnL = (trade: Trade) =>
    trade.exit_price ? (trade.exit_price - trade.entry_price) * trade.units : 0

  const winPnL = winners.reduce((sum, t) => sum + calculatePnL(t), 0)
  const lossPnL = Math.abs(losers.reduce((sum, t) => sum + calculatePnL(t), 0))

  return {
    totalTrades: trades.length,
    closedTrades: closedTrades.length,
    wins: winners.length,
    losses: losers.length,
    winRate: closedTrades.length > 0 ? (winners.length / closedTrades.length) * 100 : 0,
    totalPnL: winPnL - lossPnL,
    avgWin: winners.length > 0 ? winPnL / winners.length : 0,
    avgLoss: losers.length > 0 ? lossPnL / losers.length : 0,
    profitFactor: lossPnL > 0 ? winPnL / lossPnL : winPnL > 0 ? Infinity : 0,
  }
}

function formatCurrency(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatProfitFactor(value: number): string {
  if (value === Infinity) return '\u221E'
  return value.toFixed(2)
}

export function TradeStatistics({ trades }: TradeStatisticsProps) {
  const stats = calculateStatistics(trades)

  const getPnLClass = (value: number): string => {
    if (value > 0) return 'stat-value positive'
    if (value < 0) return 'stat-value negative'
    return 'stat-value neutral'
  }

  return (
    <div className="trade-statistics">
      <div className="stat-item">
        <span className="stat-label">Total</span>
        <span className="stat-value">{stats.totalTrades}</span>
      </div>
      <div className="stat-item">
        <span className="stat-label">Closed</span>
        <span className="stat-value">{stats.closedTrades}</span>
      </div>
      <div className="stat-item">
        <span className="stat-label">Wins</span>
        <span className="stat-value positive">{stats.wins}</span>
      </div>
      <div className="stat-item">
        <span className="stat-label">Losses</span>
        <span className="stat-value negative">{stats.losses}</span>
      </div>
      <div className="stat-item">
        <span className="stat-label">Win Rate</span>
        <span className={getPnLClass(stats.winRate - 50)}>
          {stats.winRate.toFixed(1)}%
        </span>
      </div>
      <div className="stat-item">
        <span className="stat-label">Total P&L</span>
        <span className={getPnLClass(stats.totalPnL)}>
          {formatCurrency(stats.totalPnL)}
        </span>
      </div>
      <div className="stat-item">
        <span className="stat-label">Avg Win</span>
        <span className="stat-value positive">{formatCurrency(stats.avgWin)}</span>
      </div>
      <div className="stat-item">
        <span className="stat-label">Avg Loss</span>
        <span className="stat-value negative">{formatCurrency(stats.avgLoss)}</span>
      </div>
      <div className="stat-item">
        <span className="stat-label">Profit Factor</span>
        <span className={getPnLClass(stats.profitFactor - 1)}>
          {formatProfitFactor(stats.profitFactor)}
        </span>
      </div>
    </div>
  )
}
