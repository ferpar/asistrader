import type { IrrAnalysis } from './types'

export interface IIrrRepository {
  fetchAnalysis(): Promise<IrrAnalysis>
}
