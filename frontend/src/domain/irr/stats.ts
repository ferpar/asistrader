/** Distribution statistics for the Drivers daily charts.
 *
 * Pure, dependency-free helpers so they can be unit-tested in isolation and
 * reused by the hand-rolled SVG charts (histogram, CDF, normal overlay).
 */

/** Arithmetic mean. Returns 0 for an empty input. */
export function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

/** Sample standard deviation (n − 1). Returns 0 for fewer than two values. */
export function stdDev(values: number[], precomputedMean?: number): number {
  if (values.length < 2) return 0
  const m = precomputedMean ?? mean(values)
  const variance =
    values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

/** One histogram bucket: a half-open range [x0, x1) and how many values fell in it. */
export interface HistogramBin {
  x0: number
  x1: number
  count: number
}

/** Default bin count: the square-root rule, clamped to a readable range. */
function defaultBinCount(n: number): number {
  return Math.min(20, Math.max(5, Math.ceil(Math.sqrt(n))))
}

/**
 * Bin `values` into equal-width buckets spanning their full range. The last
 * bin is closed on the right so the maximum value is always included.
 */
export function histogramBins(values: number[], binCount?: number): HistogramBin[] {
  if (values.length === 0) return []
  const min = Math.min(...values)
  const max = Math.max(...values)
  const count = binCount ?? defaultBinCount(values.length)

  // Degenerate spread — every value is identical: a single bin holds them all.
  if (min === max) {
    return [{ x0: min, x1: min, count: values.length }]
  }

  const width = (max - min) / count
  const bins: HistogramBin[] = Array.from({ length: count }, (_, i) => ({
    x0: min + i * width,
    x1: min + (i + 1) * width,
    count: 0,
  }))
  for (const v of values) {
    const idx = Math.min(count - 1, Math.floor((v - min) / width))
    bins[idx].count += 1
  }
  return bins
}

/** A cumulative-distribution point: values ≤ `x` and the fraction they represent. */
export interface CumulativePoint {
  x: number
  count: number
  fraction: number
}

/** Turn histogram bins into a cumulative distribution (running count up to each bin's upper edge). */
export function cumulative(bins: HistogramBin[]): CumulativePoint[] {
  const total = bins.reduce((sum, b) => sum + b.count, 0)
  let running = 0
  return bins.map((b) => {
    running += b.count
    return { x: b.x1, count: running, fraction: total ? running / total : 0 }
  })
}

/** Normal probability density at `x` for a distribution with mean `mu`, std `sigma`. */
export function normalPdf(x: number, mu: number, sigma: number): number {
  if (sigma <= 0) return 0
  const z = (x - mu) / sigma
  return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI))
}

/** Evenly sample the fitted normal curve across [from, to] for an overlay polyline. */
export function normalCurve(
  mu: number,
  sigma: number,
  from: number,
  to: number,
  steps = 64,
): { x: number; y: number }[] {
  if (sigma <= 0 || to <= from) return []
  const points: { x: number; y: number }[] = []
  for (let i = 0; i <= steps; i++) {
    const x = from + ((to - from) * i) / steps
    points.push({ x, y: normalPdf(x, mu, sigma) })
  }
  return points
}

/** Mean / std of a normal fit. */
export interface NormalParams {
  mean: number
  std: number
}

/**
 * Cumulative ("expanding window") normal fit: for index `i`, the mean and std
 * of `values[0..i]`. Used to graph how the daily distribution stabilizes over
 * time — one (μ, σ) pair per day.
 */
export function rollingNormalParams(values: number[]): NormalParams[] {
  const out: NormalParams[] = []
  for (let i = 0; i < values.length; i++) {
    const window = values.slice(0, i + 1)
    const m = mean(window)
    out.push({ mean: m, std: stdDev(window, m) })
  }
  return out
}
