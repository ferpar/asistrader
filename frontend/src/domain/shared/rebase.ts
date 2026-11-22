/** One day of a level series (an index, a price). */
export interface LevelPoint {
  date: string
  value: number
}

/**
 * Rebase several level series to 100 at a common start, so they can be read
 * on one axis. The common start is the latest first date among the non-empty
 * series (the first day every one of them has a level). Each series is then
 * cut to that start and divided by its own first level from there. Empty
 * series stay empty and don't move the start. Dates are ISO strings, so they
 * compare lexically.
 */
export function rebaseToCommonStart(series: LevelPoint[][]): LevelPoint[][] {
  const usable = series.map((points) => points.filter((p) => Number.isFinite(p.value) && p.value > 0))
  const firsts = usable.filter((points) => points.length > 0).map((points) => points[0].date)
  if (firsts.length === 0) return series.map(() => [])
  const start = firsts.reduce((a, b) => (a > b ? a : b))
  return usable.map((points) => {
    const from = points.filter((p) => p.date >= start)
    if (from.length === 0) return []
    const base = from[0].value
    return from.map((p) => ({ date: p.date, value: (p.value / base) * 100 }))
  })
}
