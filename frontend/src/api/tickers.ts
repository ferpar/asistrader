import { TickerListResponse } from '../types/trade'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

export async function fetchTickers(): Promise<TickerListResponse> {
  const response = await fetch(`${API_BASE_URL}/api/tickers`)
  if (!response.ok) {
    throw new Error(`Failed to fetch tickers: ${response.statusText}`)
  }
  return response.json()
}
