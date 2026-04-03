import { Decimal } from '../shared/Decimal'
import type { FundEvent, BalanceSummary } from './types'

export function computeBalance(
  events: FundEvent[],
  riskPct: Decimal,
): BalanceSummary {
  const active = events.filter(e => !e.voided)

  let equity = Decimal.zero()
  let committed = Decimal.zero()

  for (const e of active) {
    switch (e.eventType) {
      case 'deposit':
        equity = equity.plus(e.amount)
        break
      case 'withdrawal':
        equity = equity.minus(e.amount)
        break
      case 'benefit':
        equity = equity.plus(e.amount)
        break
      case 'loss':
        equity = equity.minus(e.amount)
        break
      case 'reserve':
        committed = committed.plus(e.amount)
        break
    }
  }

  return {
    equity,
    committed,
    available: equity.minus(committed),
    maxPerTrade: equity.times(riskPct),
    riskPct,
  }
}
