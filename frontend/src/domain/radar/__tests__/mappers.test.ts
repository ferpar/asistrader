import { describe, it, expect } from 'vitest'
import { mapCloseSeries } from '../mappers'

describe('mapCloseSeries', () => {
  it('zips parallel dates and closes into dated closes', () => {
    expect(mapCloseSeries({ dates: ['2026-01-01', '2026-01-02'], close: [100, 101.5] })).toEqual([
      { date: '2026-01-01', close: 100 },
      { date: '2026-01-02', close: 101.5 },
    ])
  })

  it('maps an empty series to no closes', () => {
    expect(mapCloseSeries({ dates: [], close: [] })).toEqual([])
  })
})
