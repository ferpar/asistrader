import { observable } from '@legendapp/state'
import { Decimal } from '../shared/Decimal'
import type { TradeWithMetrics, LiveMetrics } from './types'
import type { TradeStore } from './TradeStore'
import type { LiveMetricsStore } from './LiveMetricsStore'
import type { FundStore } from '../fund/FundStore'
import type { FxStore } from '../fx/FxStore'

/** Aggregated stats for a slice of trades. */
export interface PnLStats {
  count: number
  wins: number
  losses: number
  winRate: number
  totalPnL: number
  avgWin: number
  avgLoss: number
  profitFactor: number
}

export interface TickerStats {
  symbol: string
  currency: string | null
  priceHint: number | null
  tradeCount: number
  wins: number
  losses: number
  winRate: number
  totalPnL: number
  avgPnL: number
}

const EMPTY_PNL: PnLStats = {
  count: 0, wins: 0, losses: 0, winRate: 0,
  totalPnL: 0, avgWin: 0, avgLoss: 0, profitFactor: 0,
}

function buildStats(
  winPnL: Decimal,
  lossPnL: Decimal,
  wins: number,
  losses: number,
  count: number,
): PnLStats {
  const lossAbs = lossPnL.abs()
  return {
    count,
    wins,
    losses,
    winRate: wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0,
    totalPnL: winPnL.minus(lossAbs).toNumber(),
    avgWin: wins > 0 ? winPnL.div(Decimal.from(wins)).toNumber() : 0,
    avgLoss: losses > 0 ? lossAbs.div(Decimal.from(losses)).toNumber() : 0,
    profitFactor:
      lossAbs.isPositive()
        ? winPnL.div(lossAbs).toNumber()
        : winPnL.isPositive()
        ? Infinity
        : 0,
  }
}

function convertOrSkip(
  amount: Decimal,
  fromCcy: string | null,
  baseCurrency: string,
  onDate: Date,
  fxStore: FxStore,
): Decimal | null {
  const ccy = fromCcy || baseCurrency
  if (ccy === baseCurrency) return amount
  try {
    return fxStore.convert(amount, ccy, baseCurrency, onDate)
  } catch {
    return null
  }
}

function calculateRealized(
  trades: TradeWithMetrics[],
  baseCurrency: string,
  fxStore: FxStore,
): PnLStats {
  const closed = trades.filter((t) => t.status === 'close')
  if (closed.length === 0) return EMPTY_PNL

  let winPnL = Decimal.zero()
  let lossPnL = Decimal.zero()
  let wins = 0
  let losses = 0

  for (const trade of closed) {
    if (!trade.exitPrice || !trade.exitDate) continue
    const pnlNative = trade.exitPrice
      .minus(trade.entryPrice)
      .times(Decimal.from(trade.units))
    const pnlInBase = convertOrSkip(
      pnlNative,
      trade.tickerCurrency,
      baseCurrency,
      trade.exitDate,
      fxStore,
    )
    if (pnlInBase === null) continue
    if (trade.exitType === 'tp') {
      winPnL = winPnL.plus(pnlInBase)
      wins++
    } else if (trade.exitType === 'sl') {
      lossPnL = lossPnL.plus(pnlInBase)
      losses++
    }
  }

  return buildStats(winPnL, lossPnL, wins, losses, closed.length)
}

function calculateUnrealized(
  trades: TradeWithMetrics[],
  liveMetrics: Record<number, LiveMetrics>,
  baseCurrency: string,
  fxStore: FxStore,
): PnLStats {
  const open = trades.filter((t) => t.status === 'open')
  if (open.length === 0) return EMPTY_PNL

  const today = new Date()
  let winPnL = Decimal.zero()
  let lossPnL = Decimal.zero()
  let wins = 0
  let losses = 0

  for (const trade of open) {
    const pnlNative = liveMetrics[trade.id]?.unrealizedPnL
    if (!pnlNative) continue
    const pnlInBase = convertOrSkip(
      pnlNative,
      trade.tickerCurrency,
      baseCurrency,
      today,
      fxStore,
    )
    if (pnlInBase === null) continue
    if (pnlInBase.isPositive()) {
      winPnL = winPnL.plus(pnlInBase)
      wins++
    } else if (pnlInBase.isNegative()) {
      lossPnL = lossPnL.plus(pnlInBase)
      losses++
    }
  }

  return buildStats(winPnL, lossPnL, wins, losses, open.length)
}

function calculatePerTicker(trades: TradeWithMetrics[]): TickerStats[] {
  const closed = trades.filter((t) => t.status === 'close')
  const byTicker = new Map<string, TradeWithMetrics[]>()
  for (const trade of closed) {
    const list = byTicker.get(trade.ticker) ?? []
    list.push(trade)
    byTicker.set(trade.ticker, list)
  }

  const result: TickerStats[] = []
  byTicker.forEach((tickerTrades, symbol) => {
    const winners = tickerTrades.filter((t) => t.exitType === 'tp')
    const losers = tickerTrades.filter((t) => t.exitType === 'sl')

    const tickerPnL = (t: TradeWithMetrics): Decimal =>
      t.exitPrice
        ? t.exitPrice.minus(t.entryPrice).times(Decimal.from(t.units))
        : Decimal.zero()

    const totalPnL = tickerTrades.reduce(
      (sum, t) => sum.plus(tickerPnL(t)),
      Decimal.zero(),
    )

    result.push({
      symbol,
      currency: tickerTrades[0]?.tickerCurrency ?? null,
      priceHint: tickerTrades[0]?.tickerPriceHint ?? null,
      tradeCount: tickerTrades.length,
      wins: winners.length,
      losses: losers.length,
      winRate:
        tickerTrades.length > 0
          ? (winners.length / tickerTrades.length) * 100
          : 0,
      totalPnL: totalPnL.toNumber(),
      avgPnL:
        tickerTrades.length > 0
          ? totalPnL.div(Decimal.from(tickerTrades.length)).toNumber()
          : 0,
    })
  })

  return result.sort((a, b) => b.totalPnL - a.totalPnL)
}

/**
 * Owns the realized / unrealized / per-ticker aggregations that used to be
 * inlined in TradeStatistics and TickerPerformance. Recomputes happen in a
 * microtask so the UI paints a skeleton first; memoization on a cheap input
 * key skips redundant work.
 */
export class TradeMetricsStore {
  readonly realized$ = observable<PnLStats | null>(null)
  readonly unrealized$ = observable<PnLStats | null>(null)
  readonly perTicker$ = observable<TickerStats[] | null>(null)
  readonly computing$ = observable(false)

  private lastKey = ''

  constructor(
    private readonly tradeStore: TradeStore,
    private readonly liveMetricsStore: LiveMetricsStore,
    private readonly fundStore: FundStore,
    private readonly fxStore: FxStore,
  ) {
    // Trigger recompute when any input changes. filter$ changes the inputs to
    // realized/unrealized stats (via the filtered set); trades$ changes
    // perTicker. Live prices change unrealized.
    this.tradeStore.trades$.onChange(() => this.scheduleRecompute())
    this.tradeStore.filter$.onChange(() => this.scheduleRecompute())
    this.liveMetricsStore.prices$.onChange(() => this.scheduleRecompute())
    this.fundStore.baseCurrency$.onChange(() => this.scheduleRecompute())
    this.fxStore.loaded$.onChange(() => this.scheduleRecompute())
  }

  private inputKey(): string {
    const allTrades = this.tradeStore.trades$.get()
    const filtered = this.tradeStore.filteredTrades$.get()
    const filter = this.tradeStore.filter$.get()
    const base = this.fundStore.baseCurrency$.get()
    const fxLoaded = this.fxStore.loaded$.get() ? 1 : 0
    // Live prices update frequently; include the price map's reference signal
    // by hashing keys. Fast and good enough.
    const priceKeys = Object.keys(this.liveMetricsStore.prices$.get()).length
    return [
      allTrades.length,
      filtered.length,
      filter,
      priceKeys,
      base,
      fxLoaded,
    ].join('|')
  }

  private scheduleRecompute(): void {
    const key = this.inputKey()
    if (key === this.lastKey) return
    this.lastKey = key
    this.computing$.set(true)
    queueMicrotask(() => {
      const allTrades = this.tradeStore.trades$.get()
      const filtered = this.tradeStore.filteredTrades$.get()
      const liveMetrics = this.liveMetricsStore.metrics$.get()
      const base = this.fundStore.baseCurrency$.get()
      // Realized + unrealized respect the active filter (matches old UX).
      this.realized$.set(calculateRealized(filtered, base, this.fxStore))
      this.unrealized$.set(
        calculateUnrealized(filtered, liveMetrics, base, this.fxStore),
      )
      // Per-ticker performance stays against ALL closed trades — it's a
      // portfolio overview, not a filtered view.
      this.perTicker$.set(calculatePerTicker(allTrades))
      this.computing$.set(false)
    })
  }
}
