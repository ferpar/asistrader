import type { IRadarPresetRepository } from './IRadarPresetRepository'
import type { RadarPreset } from './types'
import type { RadarPresetConfig } from './filterSort'
import type {
  RadarPresetDTO,
  RadarPresetListResponse,
  RadarPresetResponse,
} from '../../types/radarPreset'
import { buildHeaders } from '../shared/httpHelpers'

function mapPreset(dto: RadarPresetDTO): RadarPreset {
  return {
    id: dto.id,
    name: dto.name,
    config: dto.config ?? {},
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  }
}

async function detail(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => ({}))
  return body.detail || `${fallback}: ${response.statusText}`
}

export class HttpRadarPresetRepository implements IRadarPresetRepository {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => string | null,
  ) {}

  async fetchPresets(): Promise<RadarPreset[]> {
    const response = await fetch(`${this.baseUrl}/api/radar/presets`, {
      headers: buildHeaders(this.getToken),
    })
    if (!response.ok) {
      throw new Error(await detail(response, 'Failed to fetch radar presets'))
    }
    const data: RadarPresetListResponse = await response.json()
    return data.presets.map(mapPreset)
  }

  async createPreset(name: string, config: RadarPresetConfig): Promise<RadarPreset> {
    const response = await fetch(`${this.baseUrl}/api/radar/presets`, {
      method: 'POST',
      headers: buildHeaders(this.getToken, true),
      body: JSON.stringify({ name, config }),
    })
    if (!response.ok) {
      throw new Error(await detail(response, 'Failed to create radar preset'))
    }
    const data: RadarPresetResponse = await response.json()
    return mapPreset(data.preset)
  }

  async updatePreset(
    id: number,
    patch: { name?: string; config?: RadarPresetConfig },
  ): Promise<RadarPreset> {
    const response = await fetch(`${this.baseUrl}/api/radar/presets/${id}`, {
      method: 'PUT',
      headers: buildHeaders(this.getToken, true),
      body: JSON.stringify(patch),
    })
    if (!response.ok) {
      throw new Error(await detail(response, 'Failed to update radar preset'))
    }
    const data: RadarPresetResponse = await response.json()
    return mapPreset(data.preset)
  }

  async deletePreset(id: number): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/radar/presets/${id}`, {
      method: 'DELETE',
      headers: buildHeaders(this.getToken),
    })
    if (!response.ok) {
      throw new Error(await detail(response, 'Failed to delete radar preset'))
    }
  }
}
