import type { EmaStructure, PriceChanges } from './types'

export function computeEma(closes: number[], period: number): number | null {
  if (closes.length < period) return null
  let sma = 0
  for (let i = 0; i < period; i++) sma += closes[i]
  sma /= period

  const k = 2 / (period + 1)
  let ema = sma
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k)
  }
  return ema
}

export function computeEmaStructure(closes: number[], currentPrice: number): EmaStructure {
  const ema5 = computeEma(closes, 5)
  const ema20 = computeEma(closes, 20)
  const ema50 = computeEma(closes, 50)
  const ema200 = computeEma(closes, 200)

  let structure: string | null = null
  if (ema5 !== null && ema20 !== null && ema50 !== null && ema200 !== null) {
    const items: [number, string][] = [
      [currentPrice, '0'],
      [ema5, '1'],
      [ema20, '2'],
      [ema50, '3'],
      [ema200, '4'],
    ]
    items.sort((a, b) => b[0] - a[0])
    structure = items.map(([, label]) => label).join('')
  }

  return { ema5, ema20, ema50, ema200, structure }
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
