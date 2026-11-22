import { describe, it, expect } from 'vitest'
import { mapCloseSeries } from '../mappers'

describe('mapCloseSeries', () => {
  it('zips parallel dates, closes and adjusted closes into dated closes', () => {
    expect(
      mapCloseSeries({ dates: ['2026-01-01', '2026-01-02'], close: [100, 101.5], adj_close: [98, null] }),
    ).toEqual([
      { date: '2026-01-01', close: 100, adjClose: 98 },
      { date: '2026-01-02', close: 101.5, adjClose: null },
    ])
  })

  it('maps an empty series to no closes', () => {
    expect(mapCloseSeries({ dates: [], close: [], adj_close: [] })).toEqual([])
  })
})
