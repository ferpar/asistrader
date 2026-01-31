import React, { useState } from 'react'
import type { ExitLevel } from '../domain/trade/types'
import type { TradeStatus } from '../types/trade'

interface ExitLevelSummaryProps {
  levels: ExitLevel[]
  entryPrice: number
  units: number
  tradeStatus?: TradeStatus
  onLevelHit?: (levelId: number, hitDate: string, hitPrice?: number) => Promise<void>
  onLevelRevert?: (levelId: number) => Promise<void>
}

export function ExitLevelSummary({ levels, entryPrice: _entryPrice, units, tradeStatus, onLevelHit, onLevelRevert }: ExitLevelSummaryProps) {
  // entryPrice is available for future use (e.g., calculating profit per level)
  void _entryPrice
  const [confirmingLevelId, setConfirmingLevelId] = useState<number | null>(null)
  const [hitDate, setHitDate] = useState(new Date().toISOString().split('T')[0])
  const [hitPrice, setHitPrice] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)

  const tpLevels = levels.filter(l => l.levelType === 'tp').sort((a, b) => a.orderIndex - b.orderIndex)
  const slLevels = levels.filter(l => l.levelType === 'sl').sort((a, b) => a.orderIndex - b.orderIndex)

  const showActions = tradeStatus === 'open' && (onLevelHit || onLevelRevert)

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value)
  }

  const formatPercent = (value: number) => {
    return `${Math.round(value * 100)}%`
  }

  const formatDate = (date: Date | null) => {
    if (!date) return '-'
    return date.toLocaleDateString()
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

  const handleStartConfirm = (level: ExitLevel) => {
    setConfirmingLevelId(level.id)
    setHitDate(new Date().toISOString().split('T')[0])
    setHitPrice(level.price.toNumber().toString())
  }

  const handleConfirmHit = async (levelId: number) => {
    if (!onLevelHit) return
    setSubmitting(true)
    try {
      const price = hitPrice ? parseFloat(hitPrice) : undefined
      await onLevelHit(levelId, hitDate, price)
      setConfirmingLevelId(null)
    } finally {
      setSubmitting(false)
    }
  }

  const handleRevert = async (levelId: number) => {
    if (!onLevelRevert) return
    setSubmitting(true)
    try {
      await onLevelRevert(levelId)
    } finally {
      setSubmitting(false)
    }
  }

  const renderLevelTable = (levelList: ExitLevel[], title: string) => {
    if (levelList.length === 0) return null

    const totalPct = levelList.reduce((sum, l) => sum + l.unitsPct.toNumber(), 0)
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
              {showActions && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {levelList.map((level) => {
              const levelUnits = Math.round(units * level.unitsPct.toNumber())
              const isConfirming = confirmingLevelId === level.id
              return (
                <React.Fragment key={level.id}>
                  <tr className={getStatusClass(level.status)}>
                    <td>{level.orderIndex}</td>
                    <td>{formatCurrency(level.price.toNumber())}</td>
                    <td>{formatPercent(level.unitsPct.toNumber())}</td>
                    <td>{levelUnits} units</td>
                    <td className={`level-status ${getStatusClass(level.status)}`}>
                      {level.status.charAt(0).toUpperCase() + level.status.slice(1)}
                    </td>
                    <td>{formatDate(level.hitDate)}</td>
                    {title.includes('Take Profit') && (
                      <td>{level.moveSlToBreakeven ? 'BE' : '-'}</td>
                    )}
                    {showActions && (
                      <td>
                        {level.status === 'pending' && onLevelHit && (
                          <button
                            className="btn-action btn-hit"
                            onClick={() => handleStartConfirm(level)}
                            disabled={submitting}
                          >
                            Hit
                          </button>
                        )}
                        {level.status === 'hit' && onLevelRevert && (
                          <button
                            className="btn-action btn-undo"
                            onClick={() => handleRevert(level.id)}
                            disabled={submitting}
                          >
                            Undo
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                  {isConfirming && (
                    <tr className="level-hit-confirm-row">
                      <td colSpan={showActions ? (title.includes('Take Profit') ? 8 : 7) : (title.includes('Take Profit') ? 7 : 6)}>
                        <div className="level-hit-confirm">
                          <label>
                            Date:
                            <input
                              type="date"
                              value={hitDate}
                              onChange={(e) => setHitDate(e.target.value)}
                            />
                          </label>
                          <label>
                            Price:
                            <input
                              type="number"
                              step="0.01"
                              value={hitPrice}
                              onChange={(e) => setHitPrice(e.target.value)}
                              placeholder="Actual price"
                            />
                          </label>
                          <button
                            className="btn-action btn-confirm"
                            onClick={() => handleConfirmHit(level.id)}
                            disabled={submitting}
                          >
                            {submitting ? 'Saving...' : 'Confirm'}
                          </button>
                          <button
                            className="btn-action btn-secondary"
                            onClick={() => setConfirmingLevelId(null)}
                            disabled={submitting}
                          >
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
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
