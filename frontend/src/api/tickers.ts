import {
  BatchPriceResponse,
  TickerCreateRequest,
  TickerCreateResponse,
  TickerListResponse,
  TickerPriceResponse,
  TickerSearchResponse,
} from '../types/trade'
import { getAccessToken } from '../utils/tokenStorage'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

function getAuthHeaders(): Record<string, string> {
  const token = getAccessToken()
  if (!token) return {}
  return { Authorization: `Bearer ${token}` }
}

export async function fetchTickers(): Promise<TickerListResponse> {
  const response = await fetch(`${API_BASE_URL}/api/tickers`, {
    headers: {
      ...getAuthHeaders(),
    },
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch tickers: ${response.statusText}`)
  }
  return response.json()
}

export async function searchTickers(query: string): Promise<TickerSearchResponse> {
  const response = await fetch(
    `${API_BASE_URL}/api/tickers/search?q=${encodeURIComponent(query)}`,
    {
      headers: {
        ...getAuthHeaders(),
      },
    }
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
      ...getAuthHeaders(),
    },
    body: JSON.stringify(request),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || `Failed to create ticker: ${response.statusText}`)
  }
  return response.json()
}

export async function fetchTickerPrice(symbol: string): Promise<TickerPriceResponse> {
  const response = await fetch(
    `${API_BASE_URL}/api/tickers/${encodeURIComponent(symbol)}/price`,
    {
      headers: {
        ...getAuthHeaders(),
      },
    }
  )
  if (!response.ok) {
    throw new Error(`Failed to fetch price: ${response.statusText}`)
  }
  return response.json()
}

export async function fetchBatchPrices(symbols: string[]): Promise<BatchPriceResponse> {
  const response = await fetch(`${API_BASE_URL}/api/tickers/prices`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ symbols }),
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch batch prices: ${response.statusText}`)
  }
  return response.json()
}
