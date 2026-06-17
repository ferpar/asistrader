export interface StrategyDTO {
  id: number
  name: string
  pe_method: string | null
  sl_method: string | null
  tp_method: string | null
  description: string | null
  automated: boolean
  params: Record<string, unknown> | null
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
  automated?: boolean
  params?: Record<string, unknown> | null
}

export interface StrategyUpdateRequest {
  name?: string
  pe_method?: string
  sl_method?: string
  tp_method?: string
  description?: string
  automated?: boolean
  params?: Record<string, unknown> | null
}

export interface StrategyResponse {
  strategy: StrategyDTO
  message: string
}

// --- Draft a trade via an automated strategy ---

export interface StrategyDraftRequestDTO {
  ticker: string
  plr?: number | null
  d1?: number | null
  side?: string | null
  order_type?: string | null
  time_in_effect?: string | null
}

export interface StrategyDraftPresetDTO {
  kind: string
  d2: number
  win_rate: number | null
  expectancy: number | null
  expectancy_per_day: number | null
  efficiency: number | null
  win_rate_ci: [number, number] | null
  efficiency_ci: [number, number] | null
  n_trials: number
  entry: number
  stop_loss: number
  take_profit: number
}

export interface StrategyDraftResponseDTO {
  confident: boolean
  reason: string | null
  breakeven_win_rate: number
  fill_rate: number
  ticker: string
  last_bar_date: string | null
  speed: number | null
  presets: StrategyDraftPresetDTO[]
}
