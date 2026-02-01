export interface StrategyDTO {
  id: number
  name: string
  pe_method: string | null
  sl_method: string | null
  tp_method: string | null
  description: string | null
}

export interface StrategyListResponse {
  strategies: StrategyDTO[]
  count: number
}

export interface StrategyCreateRequest {
  name: string
  pe_method?: string
  sl_method?: string
  tp_method?: string
  description?: string
}

export interface StrategyUpdateRequest {
  name?: string
  pe_method?: string
  sl_method?: string
  tp_method?: string
  description?: string
}

export interface StrategyResponse {
  strategy: StrategyDTO
  message: string
}
