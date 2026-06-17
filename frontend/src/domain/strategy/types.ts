export interface Strategy {
  id: number
  name: string
  peMethod: string | null
  slMethod: string | null
  tpMethod: string | null
  description: string | null
  /** Automated strategies draft trades and lock the strategy on the trade. */
  automated: boolean
  /** Engine config (PLR default, D1, D2 range, lookback, gates...). Opaque blob. */
  params: Record<string, unknown> | null
}

export type DraftPresetKind = 'regular' | 'conservative' | 'aggressive'

/** One recommended preset with its stats and concrete drafted prices. */
export interface DraftPreset {
  kind: DraftPresetKind
  d2: number
  winRate: number | null
  expectancy: number | null
  expectancyPerDay: number | null
  efficiency: number | null
  winRateCi: [number, number] | null
  efficiencyCi: [number, number] | null
  nTrials: number
  entry: number
  stopLoss: number
  takeProfit: number
}

/** Result of asking an automated strategy to draft a trade for a ticker. */
export interface DraftResult {
  confident: boolean
  reason: string | null
  breakevenWinRate: number
  fillRate: number
  ticker: string
  lastBarDate: string | null
  speed: number | null
  presets: DraftPreset[]
}
