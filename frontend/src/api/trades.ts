import { TradeCreateRequest, TradeListResponse, TradeResponse, TradeUpdateRequest } from '../types/trade'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

export async function fetchTrades(): Promise<TradeListResponse> {
  const response = await fetch(`${API_BASE_URL}/api/trades`)
  if (!response.ok) {
    throw new Error(`Failed to fetch trades: ${response.statusText}`)
  }
  return response.json()
}

export async function createTrade(request: TradeCreateRequest): Promise<TradeResponse> {
  const response = await fetch(`${API_BASE_URL}/api/trades`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.detail || `Failed to create trade: ${response.statusText}`)
  }
  return response.json()
}

export async function updateTrade(id: number, request: TradeUpdateRequest): Promise<TradeResponse> {
  const response = await fetch(`${API_BASE_URL}/api/trades/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.detail || `Failed to update trade: ${response.statusText}`)
  }
  return response.json()
}
