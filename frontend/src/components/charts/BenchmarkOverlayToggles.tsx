import type { Benchmark } from '../../domain/benchmark/types'
import styles from './BenchmarkOverlayToggles.module.css'

/**
 * Overlay colours follow the benchmark (its place in the benchmark list), not
 * the order it was picked in, so toggling one never repaints the others. The
 * charted index takes series 1; past the palette, benchmarks fall back to the
 * muted ink rather than a generated hue.
 */
export function benchmarkColor(position: number): string {
  return position < 7 ? `var(--series-${position + 2})` : 'var(--color-text-muted)'
}

/** One row of chips above a rebased chart: which benchmarks to overlay. */
export function BenchmarkOverlayToggles({
  benchmarks,
  selected,
  onToggle,
}: {
  benchmarks: Benchmark[]
  selected: string[]
  onToggle: (symbol: string) => void
}) {
  if (benchmarks.length === 0) return null
  return (
    <div className={styles.overlays} role="group" aria-label="Benchmark overlays">
      <span className={styles.overlayLabel}>Compare with</span>
      {benchmarks.map((b, position) => {
        const on = selected.includes(b.symbol)
        return (
          <button
            key={b.symbol}
            type="button"
            aria-pressed={on}
            className={`${styles.chip} ${on ? styles.chipOn : ''}`}
            onClick={() => onToggle(b.symbol)}
            title={b.symbol}
          >
            {on && <span className={styles.chipSwatch} style={{ background: benchmarkColor(position) }} />}
            {b.name ?? b.symbol}
          </button>
        )
      })}
    </div>
  )
}
