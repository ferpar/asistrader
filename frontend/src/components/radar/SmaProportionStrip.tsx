import styles from './SmaProportionStrip.module.css'

const W = 200
const H = 38
const PAD_X = 8
const LINE_Y = 19
const LABEL_ABOVE_Y = 8
const LABEL_BELOW_Y = 34
const CHAR_PX = 5.2 // ~9px monospace
const MIN_LABEL_GAP = 1

// Per-series tick half-height. Shorter SMAs draw taller so the period
// ordering reads at a glance; P stands apart by stroke weight.
const TICK_HALF: Record<'P' | '5' | '20' | '50' | '200', number> = {
  P: 6,
  '5': 7,
  '20': 5.5,
  '50': 4,
  '200': 2.5,
}

interface SmaProportionStripProps {
  price: number | null
  sma5: number | null
  sma20: number | null
  sma50: number | null
  sma200: number | null
  formatValue: (value: number) => string
}

interface Entry {
  key: 'P' | '5' | '20' | '50' | '200'
  label: string
  value: number
  isPrice: boolean
}

/**
 * Renders price + 4 SMAs at proportional positions on a [min, max] strip.
 * Conveys both order and *spacing* at a glance: tightly clustered ticks
 * indicate compression; spread ticks indicate a fanned-out stack.
 */
export function SmaProportionStrip({
  price,
  sma5,
  sma20,
  sma50,
  sma200,
  formatValue,
}: SmaProportionStripProps) {
  const entries: Entry[] = []
  if (price !== null) entries.push({ key: 'P', label: 'P', value: price, isPrice: true })
  if (sma5 !== null) entries.push({ key: '5', label: '5', value: sma5, isPrice: false })
  if (sma20 !== null) entries.push({ key: '20', label: '20', value: sma20, isPrice: false })
  if (sma50 !== null) entries.push({ key: '50', label: '50', value: sma50, isPrice: false })
  if (sma200 !== null) entries.push({ key: '200', label: '200', value: sma200, isPrice: false })

  if (entries.length < 2) return null

  let min = entries[0].value
  let max = entries[0].value
  for (const e of entries) {
    if (e.value < min) min = e.value
    if (e.value > max) max = e.value
  }
  const span = max - min
  const usable = W - 2 * PAD_X
  const x = (v: number) => (span === 0 ? W / 2 : PAD_X + ((v - min) / span) * usable)

  // Place labels in two rows, preferring below; flip to above on collision.
  const placed = entries
    .map((e) => ({ ...e, x: x(e.value), width: e.label.length * CHAR_PX + 2 }))
    .sort((a, b) => a.x - b.x)

  let belowRight = -Infinity
  let aboveRight = -Infinity
  const rows = new Map<string, 'above' | 'below'>()
  for (const p of placed) {
    const left = p.x - p.width / 2
    const right = p.x + p.width / 2
    if (left >= belowRight + MIN_LABEL_GAP) {
      rows.set(p.key, 'below')
      belowRight = right
    } else if (left >= aboveRight + MIN_LABEL_GAP) {
      rows.set(p.key, 'above')
      aboveRight = right
    } else {
      // Both rows would overlap; pick the row with more headroom.
      const row = belowRight <= aboveRight ? 'below' : 'above'
      rows.set(p.key, row)
      if (row === 'below') belowRight = right
      else aboveRight = right
    }
  }

  return (
    <svg
      className={styles.strip}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="SMA proportion strip"
    >
      <line
        className={styles.axis}
        x1={PAD_X}
        x2={W - PAD_X}
        y1={LINE_Y}
        y2={LINE_Y}
      />
      {placed.map((p) => {
        const tickClass = p.isPrice ? styles.tickPrice : styles.tickSma
        const labelClass = p.isPrice ? styles.labelPrice : styles.labelSma
        const labelY = rows.get(p.key) === 'above' ? LABEL_ABOVE_Y : LABEL_BELOW_Y
        const half = TICK_HALF[p.key]
        return (
          <g key={p.key}>
            <line
              className={tickClass}
              x1={p.x}
              x2={p.x}
              y1={LINE_Y - half}
              y2={LINE_Y + half}
            >
              <title>{`${p.label}: ${formatValue(p.value)}`}</title>
            </line>
            <text
              className={labelClass}
              x={p.x}
              y={labelY}
              textAnchor="middle"
            >
              {p.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
