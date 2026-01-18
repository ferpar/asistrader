import {
  TickerCreateRequest,
  TickerCreateResponse,
  TickerListResponse,
  TickerSearchResponse,
} from '../types/trade'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

export async function fetchTickers(): Promise<TickerListResponse> {
  const response = await fetch(`${API_BASE_URL}/api/tickers`)
  if (!response.ok) {
    throw new Error(`Failed to fetch tickers: ${response.statusText}`)
  }
  return response.json()
}

export async function searchTickers(query: string): Promise<TickerSearchResponse> {
  const response = await fetch(
    `${API_BASE_URL}/api/tickers/search?q=${encodeURIComponent(query)}`
  )
  if (!response.ok) {
    throw new Error(`Failed to search tickers: ${response.statusText}`)
  }
  return response.json()
}

export async function createTicker(
  request: TickerCreateRequest
): Promise<TickerCreateResponse> {
  const response = await fetch(`${API_BASE_URL}/api/tickers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || `Failed to create ticker: ${response.statusText}`)
  }
  return response.json()
}
