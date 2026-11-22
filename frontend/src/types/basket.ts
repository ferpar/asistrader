import type { CloseSeriesDTO } from './radar'

export type BasketKindDTO = 'curated' | 'personal'

export interface BasketDTO {
  id: number
  kind: BasketKindDTO
  name: string
  description: string | null
  slug: string | null
  members: string[]
}

export interface BasketListResponse {
  baskets: BasketDTO[]
  count: number
}

/**
 * Every visible Basket's index, keyed by Basket id, in the bulk market-data
 * columnar shape (`adj_close` repeats `close`: the index is already adjusted).
 */
export interface BulkBasketIndexResponse {
  data: Record<string, CloseSeriesDTO>
  errors: Record<string, string>
}
