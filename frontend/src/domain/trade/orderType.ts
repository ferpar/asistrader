import type { OrderType, TradeDirection } from '../../types/trade'

/**
 * Order-type semantics, mirroring the backend's `entry_fills_on_rise`
 * (backend/src/asistrader/services/sltp_detection_service.py). Keeping the
 * truth table here lets the trade form derive the natural order type and warn
 * about orders that would settle immediately, without a round-trip.
 *
 *   long  + limit -> fill on fall  (price dips to entry)
 *   long  + stop  -> fill on rise  (price breaks up to entry)
 *   short + limit -> fill on rise  (price rises to entry)
 *   short + stop  -> fill on fall  (price breaks down to entry)
 */

/** Which side the market must move to fill the order: true = rise to entry. */
export function fillsOnRise(direction: TradeDirection, orderType: OrderType): boolean {
  const isLong = direction === 'long'
  const isStop = orderType === 'stop'
  // long==stop and short==limit both fill on a rise; the other two on a fall.
  return isLong === isStop
}

/**
 * The order type that is NOT yet triggered for an entry on the given side of
 * the current price — i.e. the one the trader is waiting for the market to
 * reach. Returns null when entry equals current (ambiguous) so callers leave
 * the existing choice untouched.
 */
export function deriveOrderType(
  direction: TradeDirection,
  entryPrice: number,
  currentPrice: number,
): OrderType | null {
  if (entryPrice === currentPrice) return null
  const needsRise = entryPrice > currentPrice
  if (direction === 'long') return needsRise ? 'stop' : 'limit'
  return needsRise ? 'limit' : 'stop' // short
}

/**
 * True when a limit/stop order placed at `entryPrice` would fill immediately
 * because the current price is already on (or past) its fill side. Market
 * orders are meant to fill now, so they never count as accidental auto-settle.
 */
export function wouldAutoSettle(
  direction: TradeDirection,
  orderType: OrderType,
  entryPrice: number,
  currentPrice: number,
): boolean {
  if (orderType === 'market') return false
  return fillsOnRise(direction, orderType)
    ? currentPrice >= entryPrice
    : currentPrice <= entryPrice
}
