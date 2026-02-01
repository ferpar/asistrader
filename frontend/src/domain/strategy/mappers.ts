import type { StrategyDTO } from '../../types/strategy'
import type { Strategy } from './types'

export function mapStrategy(dto: StrategyDTO): Strategy {
  return {
    id: dto.id,
    name: dto.name,
    peMethod: dto.pe_method,
    slMethod: dto.sl_method,
    tpMethod: dto.tp_method,
    description: dto.description,
  }
}
