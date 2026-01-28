import { ExitLevel } from '../types/trade'

interface ExitLevelSummaryProps {
  levels: ExitLevel[]
  entryPrice: number
  units: number
}

export function ExitLevelSummary({ levels, entryPrice: _entryPrice, units }: ExitLevelSummaryProps) {
  // entryPrice is available for future use (e.g., calculating profit per level)
  void _entryPrice
  const tpLevels = levels.filter(l => l.level_type === 'tp').sort((a, b) => a.order_index - b.order_index)
  const slLevels = levels.filter(l => l.level_type === 'sl').sort((a, b) => a.order_index - b.order_index)

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value)
  }

  const formatPercent = (value: number) => {
    return `${Math.round(value * 100)}%`
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-'
    return dateString
  }

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'hit':
        return 'level-status-hit'
      case 'cancelled':
        return 'level-status-cancelled'
      default:
        return 'level-status-pending'
    }
  }

  const renderLevelTable = (levelList: ExitLevel[], title: string) => {
    if (levelList.length === 0) return null

    const totalPct = levelList.reduce((sum, l) => sum + l.units_pct, 0)
    const isComplete = Math.abs(totalPct - 1.0) < 0.001

    return (
      <div className="exit-level-section">
        <div className="exit-level-header">
          <span className="exit-level-title">{title}</span>
          <span className={`exit-level-total ${isComplete ? 'complete' : 'incomplete'}`}>
            Total: {formatPercent(totalPct)} {isComplete ? '\u2713' : ''}
          </span>
        </div>
        <table className="exit-level-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Price</th>
              <th>%</th>
              <th>Units</th>
              <th>Status</th>
              <th>Hit Date</th>
              {title.includes('Take Profit') && <th>BE</th>}
            </tr>
          </thead>
          <tbody>
            {levelList.map((level) => {
              const levelUnits = Math.round(units * level.units_pct)
              return (
                <tr key={level.id} className={getStatusClass(level.status)}>
                  <td>{level.order_index}</td>
                  <td>{formatCurrency(level.price)}</td>
                  <td>{formatPercent(level.units_pct)}</td>
                  <td>{levelUnits} units</td>
                  <td className={`level-status ${getStatusClass(level.status)}`}>
                    {level.status.charAt(0).toUpperCase() + level.status.slice(1)}
                  </td>
                  <td>{formatDate(level.hit_date)}</td>
                  {title.includes('Take Profit') && (
                    <td>{level.move_sl_to_breakeven ? 'BE' : '-'}</td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  if (levels.length === 0) {
    return null
  }

  return (
    <div className="exit-level-summary">
      {renderLevelTable(tpLevels, 'Take Profit Levels')}
      {renderLevelTable(slLevels, 'Stop Loss Levels')}
    </div>
  )
}
