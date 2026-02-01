export interface SyncResult {
  results: Record<string, number>
  totalRows: number
  skipped: string[]
  errors: Record<string, string>
}
