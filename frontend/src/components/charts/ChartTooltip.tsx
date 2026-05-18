import { useState } from 'react'
import styles from './charts.module.css'

/** One labelled row inside a tooltip. */
export interface TooltipRow {
  label: string
  value: string
  /** Optional CSS colour for the value (e.g. a series colour or sign). */
  color?: string
}

/** Tooltip content plus its anchor, expressed as percentages of the viewBox. */
export interface TooltipState {
  /** Anchor x, 0–100, as a percentage of the chart's viewBox width. */
  xPct: number
  /** Anchor y, 0–100, as a percentage of the chart's viewBox height. */
  yPct: number
  title?: string
  rows: TooltipRow[]
}

/** Hover-tooltip state for a single chart. */
export function useTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  return { tooltip, show: setTooltip, hide: () => setTooltip(null) }
}

/**
 * HTML tooltip overlaid on a chart. Positioning is percentage-based, which
 * works because the SVG scales uniformly to fill its frame (matching viewBox
 * aspect ratio + `height: auto`), so no pixel measurement is needed.
 */
export function ChartTooltip({ tooltip }: { tooltip: TooltipState | null }) {
  if (!tooltip) return null
  // Clamp the anchor so the tooltip body stays within the frame.
  const left = Math.min(92, Math.max(8, tooltip.xPct))
  const top = Math.min(90, Math.max(4, tooltip.yPct))
  return (
    <div
      className={styles.tooltip}
      style={{ left: `${left}%`, top: `${top}%` }}
      role="tooltip"
    >
      {tooltip.title && <div className={styles.tooltipTitle}>{tooltip.title}</div>}
      {tooltip.rows.map((r) => (
        <div key={r.label} className={styles.tooltipRow}>
          <span className={styles.tooltipLabel}>{r.label}</span>
          <span className={styles.tooltipValue} style={r.color ? { color: r.color } : undefined}>
            {r.value}
          </span>
        </div>
      ))}
    </div>
  )
}
