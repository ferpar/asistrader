import type { TickerIndicators } from '../radar/types'

/** Curated: ours, visible to everyone, read-only. Personal: one user's own. */
export type BasketKind = 'curated' | 'personal'

export interface Basket {
  id: number
  kind: BasketKind
  name: string
  description: string | null
  slug: string | null
  members: string[]
}

/** One business day of a Basket Index (chained from 100). */
export interface BasketIndexPoint {
  date: string
  value: number
}

/** A row of the Baskets ranking: a Basket, or a benchmark shown for reference. */
export type RankingRow =
  | { kind: BasketKind; id: number; name: string; memberCount: number; indicators: TickerIndicators }
  | { kind: 'benchmark'; id: string; name: string; memberCount: null; indicators: TickerIndicators }

/** A Basket member, with the user's Portfolios whose current Holdings include it. */
export interface BasketMember {
  symbol: string
  name: string | null
  heldIn: { id: number; name: string }[]
}
