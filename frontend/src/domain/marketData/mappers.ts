import type { SyncResponseDTO } from '../../types/marketData'
import type { SyncResult } from './types'

export function mapSyncResponse(dto: SyncResponseDTO): SyncResult {
  return {
    results: dto.results,
    totalRows: dto.total_rows,
    skipped: dto.skipped,
    errors: dto.errors,
  }
}
