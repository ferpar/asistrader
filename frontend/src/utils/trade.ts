import { Trade } from '../types/trade'

export function calculateDaysInTrade(trade: Trade): number | null {
  if (trade.status === 'plan' || !trade.date_actual) return null

  const startDate = new Date(trade.date_actual)
  const endDate = trade.status === 'close' && trade.exit_date
    ? new Date(trade.exit_date)
    : new Date()

  const diffTime = endDate.getTime() - startDate.getTime()
  return Math.max(0, Math.round(diffTime / (1000 * 60 * 60 * 24)))
}

export function formatDaysInTrade(trade: Trade): string {
  const days = calculateDaysInTrade(trade)
  if (days === null) return '-'
  if (days === 0) return 'Today'
  if (days === 1) return '1 day'
  return `${days} days`
}

export function calculateEntryDelta(trade: Trade): number | null {
  if (!trade.date_actual) return null

  const plannedDate = new Date(trade.date_planned)
  const actualDate = new Date(trade.date_actual)

  const diffTime = actualDate.getTime() - plannedDate.getTime()
  return Math.round(diffTime / (1000 * 60 * 60 * 24))
}

export function formatEntryDelta(trade: Trade): string {
  const days = calculateEntryDelta(trade)
  if (days === null) return '-'
  if (days === 0) return 'On time'
  if (days === 1) return '+1 day'
  if (days === -1) return '-1 day'
  return days > 0 ? `+${days} days` : `${days} days`
}
