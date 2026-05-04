import { Decimal } from '../shared/Decimal'
import type { FxStore } from '../fx/FxStore'
import type { FundEvent, BalanceSummary } from './types'

/**
 * Compute equity / committed / available / max-per-trade in the user's base
 * currency. Each non-voided event is converted via `FxStore.convert` using
 * the rate at its `eventDate` — locking in the rate that was in effect at
 * the moment of the transition.
 *
 * If `fxStore` is not yet hydrated for one of the events' currencies, that
 * event is simply skipped (with a console warning) — the UI remains
 * functional and re-renders correctly once history arrives.
 */
export function computeBalance(
  events: FundEvent[],
  riskPct: Decimal,
  baseCurrency: string,
  fxStore: FxStore | null,
): BalanceSummary {
  const active = events.filter((e) => !e.voided)

  let equity = Decimal.zero()
  let committed = Decimal.zero()

  for (const e of active) {
    const amountInBase = convertOrSkip(e, baseCurrency, fxStore)
    if (amountInBase === null) continue

    switch (e.eventType) {
      case 'deposit':
      case 'benefit':
        equity = equity.plus(amountInBase)
        break
      case 'withdrawal':
      case 'loss':
        equity = equity.minus(amountInBase)
        break
      case 'reserve':
        committed = committed.plus(amountInBase)
        break
    }
  }

  return {
    equity,
    committed,
    available: equity.minus(committed),
    maxPerTrade: equity.times(riskPct),
    riskPct,
    baseCurrency,
  }
}

function convertOrSkip(
  event: FundEvent,
  baseCurrency: string,
  fxStore: FxStore | null,
): Decimal | null {
  if (event.currency === baseCurrency) return event.amount
  if (!fxStore) return null
  try {
    return fxStore.convert(event.amount, event.currency, baseCurrency, event.eventDate)
  } catch {
    return null
  }
}
