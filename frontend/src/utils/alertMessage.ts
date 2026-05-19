import type { AnyAlert, EntryAlert, SLTPAlert, LayeredAlert } from '../domain/trade/types'
import { formatPrice } from './priceFormat'

/**
 * Builds the human-readable text for a detection alert.
 *
 * The backend reports alerts as structured data (prices, units, dates) but no
 * longer formats the message string — prices must be shown in the ticker's own
 * currency, which only the frontend knows how to render. Each alert carries the
 * ticker `currency` and `priceHint` so `formatPrice` can format prices natively.
 */
export function buildAlertMessage(alert: AnyAlert): string {
  if (alert.alertKind === 'entry') return buildEntryMessage(alert as EntryAlert)
  if (alert.alertKind === 'layered') return buildLayeredMessage(alert as LayeredAlert)
  return buildSltpMessage(alert as SLTPAlert)
}

function price(alert: { currency: string | null; priceHint: number | null }, value: number): string {
  return formatPrice(value, alert.currency, alert.priceHint)
}

function buildEntryMessage(a: EntryAlert): string {
  if (a.autoOpened) {
    return `${a.ticker}: Entry hit on ${a.hitDate}. Trade auto-opened.`
  }
  return `${a.ticker}: Entry hit on ${a.hitDate} at ${price(a, a.entryPrice.toNumber())}. Review to open.`
}

function buildSltpMessage(a: SLTPAlert): string {
  if (a.hitType === 'both') {
    return `${a.ticker}: Both SL and TP hit on ${a.hitDate}. Manual resolution required.`
  }
  const label = a.hitType === 'sl' ? 'Stop Loss' : 'Take Profit'
  if (a.autoClosed) {
    return `${a.ticker}: ${label} hit on ${a.hitDate}. Trade auto-closed at ${price(a, a.hitPrice.toNumber())}.`
  }
  return `${a.ticker}: ${label} hit on ${a.hitDate} at ${price(a, a.hitPrice.toNumber())}. Consider closing manually.`
}

function buildLayeredMessage(a: LayeredAlert): string {
  const label = a.levelType === 'tp' ? 'Take Profit' : 'Stop Loss'
  if (a.remainingUnits === 0) {
    return `${a.ticker}: ${label} ${a.levelIndex} hit on ${a.hitDate}. Trade fully closed.`
  }
  return `${a.ticker}: ${label} ${a.levelIndex} hit on ${a.hitDate}. Closed ${a.unitsClosed} units at ${price(a, a.hitPrice.toNumber())}.`
}
