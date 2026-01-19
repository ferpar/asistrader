import {
  StrategyCreateRequest,
  StrategyListResponse,
  StrategyResponse,
  StrategyUpdateRequest,
} from '../types/trade'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

export async function fetchStrategies(): Promise<StrategyListResponse> {
  const response = await fetch(`${API_BASE_URL}/api/strategies`)
  if (!response.ok) {
    throw new Error(`Failed to fetch strategies: ${response.statusText}`)
  }
  return response.json()
}

export async function createStrategy(
  request: StrategyCreateRequest
): Promise<StrategyResponse> {
  const response = await fetch(`${API_BASE_URL}/api/strategies`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || `Failed to create strategy: ${response.statusText}`)
  }
  return response.json()
}

export async function updateStrategy(
  id: number,
  request: StrategyUpdateRequest
): Promise<StrategyResponse> {
  const response = await fetch(`${API_BASE_URL}/api/strategies/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || `Failed to update strategy: ${response.statusText}`)
  }
  return response.json()
}

export async function deleteStrategy(id: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/strategies/${id}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || `Failed to delete strategy: ${response.statusText}`)
  }
}
