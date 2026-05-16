import { observable } from '@legendapp/state'
import type { IIrrRepository } from './IIrrRepository'
import type { IrrAnalysis } from './types'

export class IrrStore {
  analysis$ = observable<IrrAnalysis | null>(null)
  loading$ = observable(false)
  error$ = observable<string | null>(null)

  constructor(private readonly repo: IIrrRepository) {}

  async loadAnalysis(): Promise<void> {
    this.loading$.set(true)
    this.error$.set(null)
    try {
      const analysis = await this.repo.fetchAnalysis()
      this.analysis$.set(analysis)
    } catch (err) {
      this.error$.set(err instanceof Error ? err.message : 'Failed to load IRR analysis')
    } finally {
      this.loading$.set(false)
    }
  }
}
