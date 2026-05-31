/**
 * Forward-looking trade-flow expectations for the Realized summary.
 *
 * Turns the existing turnover stats (avg days to close, open positions, win
 * rate) into how many closes we'd expect per day — and how many "should" have
 * happened since the last actual close.
 *
 * Daily rate, split so winners + losers == mixed by construction:
 *   yearly turnover = 365 / avgDays;  orders/yr = turnover * open;  daily = /365
 *   ⇒ daily = open / avgDays, applied per side with its share of open orders.
 *     daily_winners = open * winRate  / avgDays_winners
 *     daily_losers  = open * loseRate / avgDays_losers
 *     daily_mixed   = daily_winners + daily_losers
 *
 * Expected today = days since that side's last close * its daily rate.
 */
import type { ScopeBlock, TradeIrr } from '../../domain/irr/types'
import { parseDateOnly } from '../../utils/dateOnly'

const MS_PER_DAY = 86_400_000

export interface ExpectedOrders {
  /** Steady-state expected closes per day. */
  daily: number
  /** Expected closes accrued since the last actual close; null when none yet. */
  today: number | null
}

export interface ExpectedOrdersByMode {
  mixed: ExpectedOrders
  winners: ExpectedOrders
  losers: ExpectedOrders
}

function daysSince(exitIso: string, today: Date): number {
  return Math.max(
    0,
    Math.round((today.getTime() - parseDateOnly(exitIso).getTime()) / MS_PER_DAY),
  )
}

/** Most-recent exit date among the given transactions; null if none closed.
 *  exitDate is a "YYYY-MM-DD" string, so a lexical max is a chronological max. */
function lastClose(txns: TradeIrr[]): string | null {
  let latest: string | null = null
  for (const t of txns) {
    if (t.exitDate && (latest === null || t.exitDate > latest)) latest = t.exitDate
  }
  return latest
}

export function computeExpectedOrders(
  scope: ScopeBlock,
  openOrders: number,
  today: Date,
): ExpectedOrdersByMode {
  const nW = scope.portfolioWinners?.tradeCount ?? 0
  const nL = scope.portfolioLosers?.tradeCount ?? 0
  const total = nW + nL
  const winRate = total > 0 ? nW / total : 0
  const loseRate = total > 0 ? nL / total : 0

  const avgW = scope.portfolioWinners?.avgHoldingDays ?? 0
  const avgL = scope.portfolioLosers?.avgHoldingDays ?? 0

  const dailyWinners = avgW > 0 ? (openOrders * winRate) / avgW : 0
  const dailyLosers = avgL > 0 ? (openOrders * loseRate) / avgL : 0
  const dailyMixed = dailyWinners + dailyLosers

  const winnerTxns = scope.transactions.filter((t) => t.isWinner)
  const loserTxns = scope.transactions.filter((t) => t.profitNative < 0)

  const todayFor = (daily: number, txns: TradeIrr[]): number | null => {
    const last = lastClose(txns)
    return last === null ? null : daysSince(last, today) * daily
  }

  return {
    mixed: { daily: dailyMixed, today: todayFor(dailyMixed, scope.transactions) },
    winners: { daily: dailyWinners, today: todayFor(dailyWinners, winnerTxns) },
    losers: { daily: dailyLosers, today: todayFor(dailyLosers, loserTxns) },
  }
}
