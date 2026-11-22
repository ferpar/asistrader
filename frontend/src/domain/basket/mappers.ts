import type { BasketDTO, BasketMemberDTO } from '../../types/basket'
import type { CloseSeriesDTO } from '../../types/radar'
import type { Basket, BasketMember } from './types'
import type { LevelPoint } from '../shared/rebase'

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
export function mapBasketIndex(dto: CloseSeriesDTO): LevelPoint[] {
  return dto.dates.map((date, i) => ({ date, value: dto.close[i] }))
}

export function mapBasketMember(dto: BasketMemberDTO): BasketMember {
  return {
    symbol: dto.symbol,
    name: dto.name,
    heldIn: dto.held_in.map((p) => ({ id: p.id, name: p.name })),
  }
}
