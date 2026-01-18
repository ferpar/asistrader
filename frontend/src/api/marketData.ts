const API_BASE_URL = import.meta.env.VITE_API_URL || ''

export interface SyncRequest {
  start_date: string  // YYYY-MM-DD
  symbols?: string[] | null
}

export interface SyncResponse {
  results: Record<string, number>
  total_rows: number
  skipped: string[]
  errors: Record<string, string>
}

export async function syncMarketData(request: SyncRequest): Promise<SyncResponse> {
  const response = await fetch(`${API_BASE_URL}/api/market-data/sync-all`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })
  if (!response.ok) {
    throw new Error(`Failed to sync market data: ${response.statusText}`)
  }
  return response.json()
}
