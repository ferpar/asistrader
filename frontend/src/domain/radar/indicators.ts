import type { SmaStructure, PriceChanges } from './types'

export function computeSma(closes: number[], period: number): number | null {
  if (closes.length < period) return null
  const slice = closes.slice(-period)
  let sum = 0
  for (const c of slice) sum += c
  return sum / period
}

export function computeSmaStructure(closes: number[], currentPrice: number): SmaStructure {
  const sma5 = computeSma(closes, 5)
  const sma20 = computeSma(closes, 20)
  const sma50 = computeSma(closes, 50)
  const sma200 = computeSma(closes, 200)

  let structure: string | null = null
  if (sma5 !== null && sma20 !== null && sma50 !== null && sma200 !== null) {
    const items: [number, string][] = [
      [currentPrice, '0'],
      [sma5, '1'],
      [sma20, '2'],
      [sma50, '3'],
      [sma200, '4'],
    ]
    items.sort((a, b) => b[0] - a[0])
    structure = items.map(([, label]) => label).join('')
  }

  return { sma5, sma20, sma50, sma200, structure }
}

export function computePriceChanges(closes: number[]): PriceChanges {
  const result: PriceChanges = {
    avgChange50d: null,
    avgChangePct50d: null,
    avgChange5d: null,
    avgChangePct5d: null,
  }

  if (closes.length < 2) return result

  const computeForPeriod = (n: number) => {
    const start = Math.max(0, closes.length - n - 1)
    const slice = closes.slice(start)
    if (slice.length < 2) return { abs: null, pct: null }

    let sumAbs = 0
    let sumPct = 0
    let count = 0
    for (let i = 1; i < slice.length; i++) {
      const prev = slice[i - 1]
      if (prev === 0) continue
      sumAbs += slice[i] - prev
      sumPct += (slice[i] - prev) / prev
      count++
    }
    if (count === 0) return { abs: null, pct: null }
    return { abs: sumAbs / count, pct: sumPct / count }
  }

  const d50 = computeForPeriod(50)
  result.avgChange50d = d50.abs
  result.avgChangePct50d = d50.pct

  const d5 = computeForPeriod(5)
  result.avgChange5d = d5.abs
  result.avgChangePct5d = d5.pct

  return result
}
