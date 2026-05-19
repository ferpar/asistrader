import type { RadarPreset } from './types'
import type { RadarPresetConfig } from './filterSort'

export interface IRadarPresetRepository {
  fetchPresets(): Promise<RadarPreset[]>
  createPreset(name: string, config: RadarPresetConfig): Promise<RadarPreset>
  updatePreset(
    id: number,
    patch: { name?: string; config?: RadarPresetConfig },
  ): Promise<RadarPreset>
  deletePreset(id: number): Promise<void>
}
