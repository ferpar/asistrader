import { TradeListResponse } from '../types/trade'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

export async function fetchTrades(): Promise<TradeListResponse> {
  const response = await fetch(`${API_BASE_URL}/api/trades`)
  if (!response.ok) {
    throw new Error(`Failed to fetch trades: ${response.statusText}`)
  }
  return response.json()
}
