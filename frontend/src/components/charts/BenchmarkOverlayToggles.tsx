import type { Benchmark } from '../../domain/benchmark/types'
import type { Basket } from '../../domain/basket/types'
import { swatchBackground } from './RebasedLineChart'
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

/**
 * Basket overlays also take their colour from their place in the Basket list,
 * cycling through the same palette as benchmarks; charts draw them dashed so
 * a Basket never reads as the benchmark sharing its hue.
 */
export function basketColor(position: number): string {
  return `var(--series-${(position % 7) + 2})`
}

/** The optional second group of chips: which Baskets to overlay (by id). */
export interface BasketOverlayChoice {
  baskets: Basket[]
  selected: number[]
  onToggle: (id: number) => void
}

function Chip({
  label,
  title,
  on,
  color,
  dashed = false,
  onClick,
}: {
  label: string
  title: string
  on: boolean
  color: string
  dashed?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      className={`${styles.chip} ${on ? styles.chipOn : ''}`}
      onClick={onClick}
      title={title}
    >
      {on && <span className={styles.chipSwatch} style={{ background: swatchBackground(color, dashed) }} />}
      {label}
    </button>
  )
}

/**
 * Chips above a rebased chart: which benchmarks to overlay and, when
 * `baskets` is given, which Basket Indexes too (a second row).
 */
export function BenchmarkOverlayToggles({
  benchmarks,
  selected,
  onToggle,
  baskets,
}: {
  benchmarks: Benchmark[]
  selected: string[]
  onToggle: (symbol: string) => void
  baskets?: BasketOverlayChoice
}) {
  const basketList = baskets?.baskets ?? []
  if (benchmarks.length === 0 && basketList.length === 0) return null
  return (
    <>
      {benchmarks.length > 0 && (
        <div className={styles.overlays} role="group" aria-label="Benchmark overlays">
          <span className={styles.overlayLabel}>Compare with</span>
          {benchmarks.map((b, position) => (
            <Chip
              key={b.symbol}
              label={b.name ?? b.symbol}
              title={b.symbol}
              on={selected.includes(b.symbol)}
              color={benchmarkColor(position)}
              onClick={() => onToggle(b.symbol)}
            />
          ))}
        </div>
      )}
      {baskets && basketList.length > 0 && (
        <div className={styles.overlays} role="group" aria-label="Basket overlays">
          <span className={styles.overlayLabel}>Baskets</span>
          {basketList.map((b, position) => (
            <Chip
              key={b.id}
              label={b.name}
              title={`${b.kind === 'curated' ? 'Curated' : 'Personal'} Basket Index`}
              on={baskets.selected.includes(b.id)}
              color={basketColor(position)}
              dashed
              onClick={() => baskets.onToggle(b.id)}
            />
          ))}
        </div>
      )}
    </>
  )
}
