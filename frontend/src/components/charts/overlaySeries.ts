import type { Benchmark } from '../../domain/benchmark/types'
import type { Basket } from '../../domain/basket/types'
import type { LevelPoint } from '../../domain/shared/rebase'
import type { LevelSeries } from './RebasedLineChart'
import { basketColor, benchmarkColor } from './BenchmarkOverlayToggles'

/** What the user picked to overlay, and the series to draw for each pick. */
export interface OverlayPicks {
  benchmarks: Benchmark[]
  benchmarkSeries: Record<string, LevelPoint[]>
  selectedBenchmarks: string[]
  baskets?: Basket[]
  basketSeries?: Record<number, LevelPoint[]>
  selectedBaskets?: number[]
}

/**
 * The series of a rebased chart: the charted index first, then the picked
 * benchmarks, then the picked Baskets (dashed). Each overlay keeps the colour
 * of its place in its list, so toggling one never repaints the others.
 */
export function overlaySeries(primary: LevelSeries, picks: OverlayPicks): LevelSeries[] {
  const benchmarks = picks.benchmarks.flatMap((b, colorIndex) =>
    picks.selectedBenchmarks.includes(b.symbol)
      ? [
          {
            key: b.symbol,
            label: b.name ?? b.symbol,
            color: benchmarkColor(colorIndex),
            points: picks.benchmarkSeries[b.symbol] ?? [],
          },
        ]
      : [],
  )
  const selectedBaskets = picks.selectedBaskets ?? []
  const baskets = (picks.baskets ?? []).flatMap((b, colorIndex) =>
    selectedBaskets.includes(b.id)
      ? [
          {
            key: `basket:${b.id}`,
            label: b.name,
            color: basketColor(colorIndex),
            dashed: true,
            points: picks.basketSeries?.[b.id] ?? [],
          },
        ]
      : [],
  )
  return [primary, ...benchmarks, ...baskets]
}
