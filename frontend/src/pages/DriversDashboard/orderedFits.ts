/** Trend overlays for the OrderedScatterChart age series.
 *
 *  Each fit takes a series of y-values indexed by rank (0..N-1) and returns
 *  the same-length series of fitted y-values. The chart renders the result
 *  as a polyline through the band centers, on top of the age dots.
 */

export type FitMode = 'off' | 'linear' | 'quadratic' | 'local'

/** Least-squares straight line. Returns the mean if x has no variance. */
export function linearFit(ys: number[]): number[] {
  const n = ys.length
  if (n < 2) return [...ys]
  const meanX = (n - 1) / 2
  const meanY = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (ys[i] - meanY)
    den += (i - meanX) ** 2
  }
  if (den === 0) return ys.map(() => meanY)
  const slope = num / den
  const intercept = meanY - slope * meanX
  return ys.map((_, i) => slope * i + intercept)
}

/** Least-squares parabola via the 3×3 normal equations (Cramer's rule). */
export function quadraticFit(ys: number[]): number[] {
  const n = ys.length
  if (n < 3) return linearFit(ys)

  let s1 = 0
  let s2 = 0
  let s3 = 0
  let s4 = 0
  let sy = 0
  let sxy = 0
  let sx2y = 0
  for (let i = 0; i < n; i++) {
    const x = i
    const y = ys[i]
    s1 += x
    s2 += x * x
    s3 += x * x * x
    s4 += x * x * x * x
    sy += y
    sxy += x * y
    sx2y += x * x * y
  }

  const m = [
    [n, s1, s2],
    [s1, s2, s3],
    [s2, s3, s4],
  ]
  const rhs = [sy, sxy, sx2y]
  const det = det3(m)
  // Fall back to a line if the system is ill-conditioned (e.g. all x equal,
  // which can't happen with distinct rank indices but guards against NaN).
  if (Math.abs(det) < 1e-9) return linearFit(ys)

  const a = det3(replaceCol(m, 0, rhs)) / det
  const b = det3(replaceCol(m, 1, rhs)) / det
  const c = det3(replaceCol(m, 2, rhs)) / det
  return ys.map((_, i) => a + b * i + c * i * i)
}

/**
 * Local centered mean — each point is replaced by the mean of itself and
 * its `radius` neighbours on each side (clamped at the array boundaries).
 * Reveals nonlinear trends that a polynomial fit can miss without picking
 * an arbitrary degree.
 */
export function localMean(ys: number[], radius: number): number[] {
  const n = ys.length
  if (n === 0) return []
  return ys.map((_, i) => {
    const lo = Math.max(0, i - radius)
    const hi = Math.min(n - 1, i + radius)
    let sum = 0
    for (let j = lo; j <= hi; j++) sum += ys[j]
    return sum / (hi - lo + 1)
  })
}

/** Dispatch by mode; returns null when no overlay should be drawn. */
export function computeFit(ys: number[], mode: FitMode, localRadius = 5): number[] | null {
  if (mode === 'off' || ys.length < 2) return null
  if (mode === 'linear') return linearFit(ys)
  if (mode === 'quadratic') return quadraticFit(ys)
  return localMean(ys, localRadius)
}

// --- 3x3 determinant helpers (kept local; only used here) ---------------

function det3(m: number[][]): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  )
}

function replaceCol(m: number[][], col: number, vec: number[]): number[][] {
  return m.map((row, i) => row.map((v, j) => (j === col ? vec[i] : v)))
}
