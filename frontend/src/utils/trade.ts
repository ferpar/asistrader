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

// Helper formatters for new timeline columns
function formatDaysValue(days: number): string {
  if (days === 0) return 'Today'
  if (days === 1) return '1 day'
  return `${days} days`
}

function formatDeltaValue(days: number): string {
  if (days === 0) return 'Same day'
  if (days === 1) return '+1 day'
  if (days === -1) return '-1 day'
  return days > 0 ? `+${days} days` : `${days} days`
}

// Maturation: Plan Age (plan → today or exit)
export function calculatePlanAge(trade: Trade): number | null {
  const startDate = new Date(trade.date_planned)
  const endDate = trade.status === 'close' && trade.exit_date
    ? new Date(trade.exit_date)
    : new Date()
  const diffTime = endDate.getTime() - startDate.getTime()
  return Math.max(0, Math.round(diffTime / (1000 * 60 * 60 * 24)))
}

// Maturation: Open Age (open → today or exit)
export function calculateOpenAge(trade: Trade): number | null {
  if (!trade.date_actual) return null
  const startDate = new Date(trade.date_actual)
  const endDate = trade.status === 'close' && trade.exit_date
    ? new Date(trade.exit_date)
    : new Date()
  const diffTime = endDate.getTime() - startDate.getTime()
  return Math.max(0, Math.round(diffTime / (1000 * 60 * 60 * 24)))
}

// Process: Plan → Open
export function calculatePlanToOpen(trade: Trade): number | null {
  if (!trade.date_actual) return null
  const plannedDate = new Date(trade.date_planned)
  const actualDate = new Date(trade.date_actual)
  const diffTime = actualDate.getTime() - plannedDate.getTime()
  return Math.round(diffTime / (1000 * 60 * 60 * 24))
}

// Process: Open → Close
export function calculateOpenToClose(trade: Trade): number | null {
  if (!trade.date_actual || !trade.exit_date) return null
  const openDate = new Date(trade.date_actual)
  const closeDate = new Date(trade.exit_date)
  const diffTime = closeDate.getTime() - openDate.getTime()
  return Math.max(0, Math.round(diffTime / (1000 * 60 * 60 * 24)))
}

export function formatPlanAge(trade: Trade): string {
  const days = calculatePlanAge(trade)
  if (days === null) return '-'
  return formatDaysValue(days)
}

export function formatOpenAge(trade: Trade): string {
  const days = calculateOpenAge(trade)
  if (days === null) return '-'
  return formatDaysValue(days)
}

export function formatPlanToOpen(trade: Trade): string {
  const days = calculatePlanToOpen(trade)
  if (days === null) return '-'
  return formatDeltaValue(days)
}

export function formatOpenToClose(trade: Trade): string {
  const days = calculateOpenToClose(trade)
  if (days === null) return '-'
  return formatDaysValue(days)
}
