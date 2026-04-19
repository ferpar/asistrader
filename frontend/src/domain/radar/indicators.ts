import type {
  SmaStructure,
  PriceChanges,
  DatedClose,
  LinearRegressionResult,
  LinearRegressionStructure,
} from './types'

const EMPTY_LR_RESULT: LinearRegressionResult = { slope: null, slopePct: null, r2: null }

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

export function computePriceChangesAsOf(
  datedCloses: DatedClose[],
  asOfDate: string,
): PriceChanges {
  const asOfKey = asOfDate.slice(0, 10)
  let lastIdx = -1
  for (let i = 0; i < datedCloses.length; i++) {
    if (datedCloses[i].date.slice(0, 10) <= asOfKey) lastIdx = i
    else break
  }
  if (lastIdx < 1) {
    return { avgChange50d: null, avgChangePct50d: null, avgChange5d: null, avgChangePct5d: null }
  }
  const sliced = datedCloses.slice(0, lastIdx + 1).map((r) => r.close)
  return computePriceChanges(sliced)
}

export function computeLinearRegression(closes: number[], period: number): LinearRegressionResult {
  if (period < 2 || closes.length < period) return { ...EMPTY_LR_RESULT }
  const slice = closes.slice(-period)
  const n = slice.length

  let sumY = 0
  for (const y of slice) sumY += y
  const meanY = sumY / n
  const meanX = (n - 1) / 2

  let num = 0
  let denX = 0
  for (let i = 0; i < n; i++) {
    const dx = i - meanX
    num += dx * (slice[i] - meanY)
    denX += dx * dx
  }
  if (denX === 0) return { ...EMPTY_LR_RESULT }

  const slope = num / denX
  const intercept = meanY - slope * meanX

  let ssRes = 0
  let ssTot = 0
  for (let i = 0; i < n; i++) {
    const yHat = intercept + slope * i
    const dy = slice[i] - meanY
    ssRes += (slice[i] - yHat) ** 2
    ssTot += dy * dy
  }

  const slopePct = meanY === 0 ? null : slope / meanY
  const r2 = ssTot === 0 ? null : 1 - ssRes / ssTot
  return { slope, slopePct, r2 }
}

export function computeLinearRegressionStructure(closes: number[]): LinearRegressionStructure {
  return {
    lr20: computeLinearRegression(closes, 20),
    lr50: computeLinearRegression(closes, 50),
    lr200: computeLinearRegression(closes, 200),
  }
}
