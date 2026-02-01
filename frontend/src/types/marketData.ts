export interface SyncRequest {
  start_date: string
  symbols?: string[] | null
}

export interface SyncResponseDTO {
  results: Record<string, number>
  total_rows: number
  skipped: string[]
  errors: Record<string, string>
}
