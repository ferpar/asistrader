import type { TradeWithMetrics } from '../domain/trade/types'

type TradeDateFields = Pick<TradeWithMetrics, 'status' | 'datePlanned' | 'dateActual' | 'exitDate'>

export function calculateDaysInTrade(trade: TradeDateFields): number | null {
  if (trade.status === 'plan' || !trade.dateActual) return null

  const startDate = trade.dateActual
  const endDate = trade.status === 'close' && trade.exitDate
    ? trade.exitDate
    : new Date()

  const diffTime = endDate.getTime() - startDate.getTime()
  return Math.max(0, Math.round(diffTime / (1000 * 60 * 60 * 24)))
}

export function formatDaysInTrade(trade: TradeDateFields): string {
  const days = calculateDaysInTrade(trade)
  if (days === null) return '-'
  if (days === 0) return 'Today'
  if (days === 1) return '1 day'
  return `${days} days`
}

export function calculateEntryDelta(trade: TradeDateFields): number | null {
  if (!trade.dateActual) return null

  const plannedDate = trade.datePlanned
  const actualDate = trade.dateActual

  const diffTime = actualDate.getTime() - plannedDate.getTime()
  return Math.round(diffTime / (1000 * 60 * 60 * 24))
}

export function formatEntryDelta(trade: TradeDateFields): string {
  const days = calculateEntryDelta(trade)
  if (days === null) return '-'
  if (days === 0) return 'On time'
  if (days === 1) return '+1 day'
  if (days === -1) return '-1 day'
  return days > 0 ? `+${days} days` : `${days} days`
}

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

export function calculatePlanAge(trade: TradeDateFields): number | null {
  const startDate = trade.datePlanned
  const endDate = trade.status === 'close' && trade.exitDate
    ? trade.exitDate
    : new Date()
  const diffTime = endDate.getTime() - startDate.getTime()
  return Math.max(0, Math.round(diffTime / (1000 * 60 * 60 * 24)))
}

export function calculateOpenAge(trade: TradeDateFields): number | null {
  if (!trade.dateActual) return null
  const startDate = trade.dateActual
  const endDate = trade.status === 'close' && trade.exitDate
    ? trade.exitDate
    : new Date()
  const diffTime = endDate.getTime() - startDate.getTime()
  return Math.max(0, Math.round(diffTime / (1000 * 60 * 60 * 24)))
}

export function calculatePlanToOpen(trade: TradeDateFields): number | null {
  if (!trade.dateActual) return null
  const plannedDate = trade.datePlanned
  const actualDate = trade.dateActual
  const diffTime = actualDate.getTime() - plannedDate.getTime()
  return Math.round(diffTime / (1000 * 60 * 60 * 24))
}

export function calculateOpenToClose(trade: TradeDateFields): number | null {
  if (!trade.dateActual || !trade.exitDate) return null
  const openDate = trade.dateActual
  const closeDate = trade.exitDate
  const diffTime = closeDate.getTime() - openDate.getTime()
  return Math.max(0, Math.round(diffTime / (1000 * 60 * 60 * 24)))
}

export function formatPlanAge(trade: TradeDateFields): string {
  const days = calculatePlanAge(trade)
  if (days === null) return '-'
  return formatDaysValue(days)
}

export function formatOpenAge(trade: TradeDateFields): string {
  const days = calculateOpenAge(trade)
  if (days === null) return '-'
  return formatDaysValue(days)
}

export function formatPlanToOpen(trade: TradeDateFields): string {
  const days = calculatePlanToOpen(trade)
  if (days === null) return '-'
  return formatDeltaValue(days)
}

export function formatOpenToClose(trade: TradeDateFields): string {
  const days = calculateOpenToClose(trade)
  if (days === null) return '-'
  return formatDaysValue(days)
}
