/**
 * Frontend aggregation of per-trade IRR into a portfolio `GroupIrr`, for
 * subsets the backend doesn't pre-aggregate (e.g. the trades behind a screening
 * tier). This is a faithful port of the backend `_group` / `_xirr`
 * (irr_service.py): capital-weighted return, linear annualized TIR, and a
 * money-weighted XIRR by bisection over dated cash flows.
 */
import type { GroupIrr, TradeIrr } from './types'

const ANNUAL_DAYS = 365

const sum = (xs: number[]): number => xs.reduce((s, v) => s + v, 0)

/** Whole-day difference between two date-only ISO strings (UTC, DST-free). */
function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso)
  const b = Date.parse(toIso)
  return Math.round((b - a) / 86_400_000)
}

type DatedFlow = { offsetDays: number; amount: number }

/** NPV of dated flows (offsets from t0) at an annual `rate`. */
function xnpv(rate: number, flows: DatedFlow[]): number {
  return sum(flows.map((f) => f.amount / (1 + rate) ** (f.offsetDays / ANNUAL_DAYS)))
}

/**
 * Money-weighted IRR for arbitrary dated flows, via bisection. Returns null
 * when the flows have no sign change (IRR undefined) or the root falls outside
 * the search bracket — XIRR on sub-month trades genuinely explodes off-chart.
 */
export function xirr(flows: DatedFlow[]): number | null {
  if (flows.length < 2) return null
  const amounts = flows.map((f) => f.amount)
  if (!(amounts.some((a) => a < 0) && amounts.some((a) => a > 0))) return null

  let lo = -0.9999
  let hi = 1e9
  let fLo = xnpv(lo, flows)
  const fHi = xnpv(hi, flows)
  if (fLo * fHi > 0) return null

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    const fMid = xnpv(mid, flows)
    if (Math.abs(fMid) < 1e-9) return mid
    if (fLo * fMid < 0) {
      hi = mid
    } else {
      lo = mid
      fLo = fMid
    }
  }
  return (lo + hi) / 2
}

/** Cash flows for a group: -investment at entry, +proceeds at exit, per trade.
 *  Returns null if any trade lacks the dates needed to place a flow in time. */
function groupCashflows(transactions: TradeIrr[]): DatedFlow[] | null {
  const dated: { ordered: string; exit: string; t: TradeIrr }[] = []
  for (const t of transactions) {
    if (!t.dateOrdered || !t.exitDate) return null
    dated.push({ ordered: t.dateOrdered, exit: t.exitDate, t })
  }
  if (dated.length === 0) return null
  // Offsets are measured from the earliest entry date (the backend's t0).
  const t0 = dated.reduce((min, d) => (Date.parse(d.ordered) < Date.parse(min) ? d.ordered : min), dated[0].ordered)
  const flows: DatedFlow[] = []
  for (const { ordered, exit, t } of dated) {
    const proceeds = t.investmentBase + t.profitBase
    flows.push({ offsetDays: daysBetween(t0, ordered), amount: -t.investmentBase })
    flows.push({ offsetDays: daysBetween(t0, exit), amount: proceeds })
  }
  return flows
}

/**
 * Aggregate a set of trades into one portfolio `GroupIrr` (capital-weighted).
 * Returns null for an empty set. `currency` is null for a mixed-currency group
 * (so the card shows FX drift), matching the backend portfolio summary.
 */
export function aggregateGroup(
  label: string,
  transactions: TradeIrr[],
  currency: string | null = null,
): GroupIrr | null {
  if (transactions.length === 0) return null

  const investmentBase = sum(transactions.map((t) => t.investmentBase))
  const profitBase = sum(transactions.map((t) => t.profitBase))
  const avgHoldingDays = sum(transactions.map((t) => t.holdingDays)) / transactions.length
  const returnPct = investmentBase !== 0 ? profitBase / investmentBase : 0
  const tir = avgHoldingDays > 0 ? (returnPct / avgHoldingDays) * ANNUAL_DAYS : 0
  const fxDriftBase = sum(transactions.map((t) => t.fxDriftBase))

  const flows = groupCashflows(transactions)

  return {
    label,
    tickerName: null,
    currency,
    tradeCount: transactions.length,
    investmentBase,
    profitBase,
    returnPct,
    avgHoldingDays,
    tir,
    xirr: flows ? xirr(flows) : null,
    fxDriftBase,
  }
}
