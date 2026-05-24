import { describe, expect, it } from 'vitest'
import { buildBenchmarkIndicators } from '../RadarStore'

/** Synthetic close series long enough to satisfy the 14-period RSI warmup. */
function syntheticRows(n: number): { date: string; close: number | null }[] {
  const rows: { date: string; close: number | null }[] = []
  for (let i = 0; i < n; i++) {
    const day = String(i + 1).padStart(2, '0')
    // Mild oscillation so RSI gets both gains and losses to chew on.
    const close = 100 + Math.sin(i / 3) * 5 + i * 0.1
    rows.push({ date: `2025-01-${day}`, close })
  }
  return rows
}

describe('buildBenchmarkIndicators', () => {
  it('populates rsi and datedCloses on the happy path', () => {
    const result = buildBenchmarkIndicators('SPX', syntheticRows(40), null)
    expect(result.error).toBeNull()
    expect(result.datedCloses).toHaveLength(40)
    expect(result.rsi.series).toHaveLength(40)
    expect(result.rsi.latest).not.toBeNull()
    expect(result.rsi.latest! >= 0 && result.rsi.latest! <= 100).toBe(true)
  })

  it('returns an empty RSI when the upstream fetch errored', () => {
    const result = buildBenchmarkIndicators('SPX', [], 'fetch failed')
    expect(result.error).toBe('fetch failed')
    expect(result.rsi.series).toEqual([])
    expect(result.rsi.latest).toBeNull()
    expect(result.datedCloses).toEqual([])
  })

  it('returns an empty RSI when every row has a null close', () => {
    const rows = [
      { date: '2025-01-01', close: null },
      { date: '2025-01-02', close: null },
    ]
    const result = buildBenchmarkIndicators('SPX', rows, null)
    expect(result.error).toBe('No price data available')
    expect(result.rsi.series).toEqual([])
    expect(result.rsi.latest).toBeNull()
    expect(result.datedCloses).toEqual([])
  })

  it('skips null closes when assembling datedCloses', () => {
    const rows = [
      { date: '2025-01-01', close: 100 },
      { date: '2025-01-02', close: null },
      { date: '2025-01-03', close: 102 },
    ]
    const result = buildBenchmarkIndicators('SPX', rows, null)
    expect(result.datedCloses).toEqual([
      { date: '2025-01-01', close: 100 },
      { date: '2025-01-03', close: 102 },
    ])
  })
})
