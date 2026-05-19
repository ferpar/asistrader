import type { RadarPresetConfig } from '../domain/radar/filterSort'

export interface RadarPresetDTO {
  id: number
  name: string
  config: RadarPresetConfig
  created_at: string
  updated_at: string
}

export interface RadarPresetListResponse {
  presets: RadarPresetDTO[]
  count: number
}

export interface RadarPresetResponse {
  preset: RadarPresetDTO
  message: string
}

export interface RadarPresetCreateRequest {
  name: string
  config: RadarPresetConfig
}

export interface RadarPresetUpdateRequest {
  name?: string
  config?: RadarPresetConfig
}
