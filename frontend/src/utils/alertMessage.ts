import type { AnyAlert, EntryAlert, HitKind, SLTPAlert, LayeredAlert } from '../domain/trade/types'
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

/**
 * Short suffix conveying *how* the hit was detected. Surfaces gap fills,
 * gap-on-entry, and unverifiable open-day candidates so users don't have to
 * open the trace modal to understand a suspect alert.
 */
export function hitKindSuffix(
  kind: HitKind,
  ctx: { currency: string | null; priceHint: number | null; barOpen: { toNumber(): number } | null; prevClose: { toNumber(): number } | null },
): string {
  switch (kind) {
    case 'intraday':
      return ''
    case 'gap':
      if (ctx.barOpen && ctx.prevClose) {
        return ` (gap from ${price(ctx, ctx.prevClose.toNumber())} to ${price(ctx, ctx.barOpen.toNumber())})`
      }
      return ' (gap fill)'
    case 'gap_on_entry':
      if (ctx.barOpen) {
        return ` (gap on entry day, open ${price(ctx, ctx.barOpen.toNumber())})`
      }
      return ' (gap on entry day)'
    case 'unverifiable':
      return ' (unverifiable — touched on entry day)'
  }
}

function buildEntryMessage(a: EntryAlert): string {
  const suffix = hitKindSuffix(a.hitKind, a)
  if (a.autoOpened) {
    return `${a.ticker}: Entry hit on ${a.hitDate}. Trade auto-opened${suffix}.`
  }
  return `${a.ticker}: Entry hit on ${a.hitDate} at ${price(a, a.entryPrice.toNumber())}${suffix}. Review to open.`
}

function buildSltpMessage(a: SLTPAlert): string {
  if (a.hitType === 'both') {
    return `${a.ticker}: Both SL and TP hit on ${a.hitDate}. Manual resolution required.`
  }
  const label = a.hitType === 'sl' ? 'Stop Loss' : 'Take Profit'
  const suffix = hitKindSuffix(a.hitKind, a)
  const alsoSuffix = a.alsoWouldHaveHit.length > 0
    ? ` — ${a.alsoWouldHaveHit.join(',').toUpperCase()} would have also hit`
    : ''
  if (a.autoClosed) {
    return `${a.ticker}: ${label} hit on ${a.hitDate}. Trade auto-closed at ${price(a, a.hitPrice.toNumber())}${suffix}${alsoSuffix}.`
  }
  return `${a.ticker}: ${label} hit on ${a.hitDate} at ${price(a, a.hitPrice.toNumber())}${suffix}${alsoSuffix}. Consider closing manually.`
}

function buildLayeredMessage(a: LayeredAlert): string {
  const label = a.levelType === 'tp' ? 'Take Profit' : 'Stop Loss'
  const suffix = hitKindSuffix(a.hitKind, a)
  if (a.remainingUnits === 0) {
    return `${a.ticker}: ${label} ${a.levelIndex} hit on ${a.hitDate}. Trade fully closed${suffix}.`
  }
  return `${a.ticker}: ${label} ${a.levelIndex} hit on ${a.hitDate}. Closed ${a.unitsClosed} units at ${price(a, a.hitPrice.toNumber())}${suffix}.`
}
