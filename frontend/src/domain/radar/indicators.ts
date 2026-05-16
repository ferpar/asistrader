import type {
  SmaStructure,
  PriceChanges,
  DatedClose,
  LinearRegressionResult,
  LinearRegressionStructure,
  RsiPivot,
  RsiIndicator,
  DivergenceSignal,
  DivergenceStrength,
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

// --- RSI -------------------------------------------------------------------

const RSI_PERIOD = 14
const RSI_PIVOT_WIDTH = 5
const RSI_TOUCH_TOLERANCE = 2 // RSI points; absolute, since RSI is bounded 0-100

// Overbought / oversold thresholds — shared by the filter, card tint, and sparkline.
export const RSI_OVERBOUGHT = 70
export const RSI_OVERSOLD = 30

function rsiFromAverages(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100
  if (avgGain === 0) return 0
  return 100 - 100 / (1 + avgGain / avgLoss)
}

/**
 * Wilder-smoothed RSI, aligned index-for-index with `closes`.
 * Entries before the smoothing seed has formed are `null`.
 */
export function computeRsiSeries(closes: number[], period = RSI_PERIOD): (number | null)[] {
  const n = closes.length
  const out: (number | null)[] = new Array(n).fill(null)
  if (period < 1 || n < period + 1) return out

  // Seed: simple average of the first `period` close-to-close changes.
  let gainSum = 0
  let lossSum = 0
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1]
    if (ch >= 0) gainSum += ch
    else lossSum -= ch
  }
  let avgGain = gainSum / period
  let avgLoss = lossSum / period
  out[period] = rsiFromAverages(avgGain, avgLoss)

  // Wilder smoothing forward: each average decays the prior one.
  for (let i = period + 1; i < n; i++) {
    const ch = closes[i] - closes[i - 1]
    const gain = ch > 0 ? ch : 0
    const loss = ch < 0 ? -ch : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    out[i] = rsiFromAverages(avgGain, avgLoss)
  }
  return out
}

/**
 * Confirmed swing pivots on the RSI series. A swing high at `i` strictly
 * exceeds the `w` values on each side; lows mirror it. `price` is the local
 * close extreme within ±w (max near a high, min near a low).
 */
export function findRsiPivots(
  series: (number | null)[],
  datedCloses: DatedClose[],
  w = RSI_PIVOT_WIDTH,
): { highs: RsiPivot[]; lows: RsiPivot[] } {
  const highs: RsiPivot[] = []
  const lows: RsiPivot[] = []
  const n = Math.min(series.length, datedCloses.length)

  for (let i = w; i < n - w; i++) {
    const v = series[i]
    if (v === null) continue
    let isHigh = true
    let isLow = true
    for (let j = i - w; j <= i + w; j++) {
      if (j === i) continue
      const o = series[j]
      if (o === null) { isHigh = false; isLow = false; break }
      if (o >= v) isHigh = false
      if (o <= v) isLow = false
    }
    if (!isHigh && !isLow) continue

    let extreme = datedCloses[i].close
    for (let j = i - w; j <= i + w; j++) {
      const c = datedCloses[j].close
      if (isHigh) extreme = Math.max(extreme, c)
      else extreme = Math.min(extreme, c)
    }
    const pivot: RsiPivot = { index: i, date: datedCloses[i].date, rsi: v, price: extreme }
    if (isHigh) highs.push(pivot)
    else lows.push(pivot)
  }
  return { highs, lows }
}

/**
 * Detects a divergence by joining the latest pivot `pf` to its hull
 * predecessor — for highs the earlier pivot with the minimum slope-to-`pf`,
 * for lows the maximum. That edge is the unique trendline to `pf` that no
 * other pivot crosses. A signal fires only when RSI and price disagree.
 */
export function detectDivergenceLine(
  pivots: RsiPivot[],
  isHigh: boolean,
  touchTol = RSI_TOUCH_TOLERANCE,
): DivergenceSignal | null {
  if (pivots.length < 2) return null
  const pf = pivots[pivots.length - 1]
  const earlier = pivots.slice(0, -1)

  let from = earlier[0]
  let rsiSlope = (pf.rsi - from.rsi) / (pf.index - from.index)
  for (let i = 1; i < earlier.length; i++) {
    const k = earlier[i]
    const s = (pf.rsi - k.rsi) / (pf.index - k.index)
    if (isHigh ? s < rsiSlope : s > rsiSlope) {
      rsiSlope = s
      from = k
    }
  }

  // RSI momentum must run counter to the trade direction.
  if (isHigh ? rsiSlope >= 0 : rsiSlope <= 0) return null

  // Price must confirm: higher high for bearish, lower low for bullish.
  const priceMove = pf.price - from.price
  if (isHigh ? priceMove <= 0 : priceMove >= 0) return null
  if (from.price === 0) return null

  const span = pf.index - from.index
  const priceSlopePct = priceMove / from.price / span

  // Confidence: intermediate pivots hugging the trendline.
  const touching: RsiPivot[] = []
  for (const p of earlier) {
    if (p.index <= from.index || p.index >= pf.index) continue
    const lineRsi = from.rsi + rsiSlope * (p.index - from.index)
    const gap = isHigh ? lineRsi - p.rsi : p.rsi - lineRsi
    if (gap >= -1e-6 && gap <= touchTol) touching.push(p)
  }
  const linePivots = [from, ...touching, pf]
  const touchCount = linePivots.length
  const strength: DivergenceStrength =
    touchCount >= 4 ? 'strong' : touchCount === 3 ? 'moderate' : 'weak'

  return { pivots: linePivots, rsiSlope, priceSlopePct, touchCount, strength }
}

export function computeRsi(datedCloses: DatedClose[]): RsiIndicator {
  const closes = datedCloses.map((d) => d.close)
  const series = computeRsiSeries(closes)

  let latest: number | null = null
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i] !== null) {
      latest = series[i]
      break
    }
  }

  const { highs, lows } = findRsiPivots(series, datedCloses)
  return {
    series,
    latest,
    pivots: { highs, lows },
    divergence: {
      bearish: detectDivergenceLine(highs, true),
      bullish: detectDivergenceLine(lows, false),
    },
  }
}
