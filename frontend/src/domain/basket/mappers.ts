import type { BasketDTO } from '../../types/basket'
import type { CloseSeriesDTO } from '../../types/radar'
import type { Basket, BasketIndexPoint } from './types'

export function mapBasket(dto: BasketDTO): Basket {
  return {
    id: dto.id,
    kind: dto.kind,
    name: dto.name,
    description: dto.description,
    slug: dto.slug,
    members: dto.members,
  }
}

/** A Basket Index series: its `close` column is the index level. */
export function mapBasketIndex(dto: CloseSeriesDTO): BasketIndexPoint[] {
  return dto.dates.map((date, i) => ({ date, value: dto.close[i] }))
}
