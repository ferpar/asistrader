import type { CloseSeriesDTO } from '../../types/radar'
import type { DatedClose } from './types'

export function mapCloseSeries(dto: CloseSeriesDTO): DatedClose[] {
  return dto.dates.map((date, i) => ({ date, close: dto.close[i], adjClose: dto.adj_close[i] ?? null }))
}
