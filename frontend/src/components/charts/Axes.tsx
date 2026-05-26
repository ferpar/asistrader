import { useEffect, useRef } from 'react'
import {
  axisBottom,
  axisLeft,
  axisRight,
  select,
  type AxisDomain,
  type AxisScale,
  type NumberValue,
} from 'd3'
import styles from './charts.module.css'

interface XAxisProps<D extends AxisDomain> {
  /** A d3 scale mapping the domain to a horizontal pixel position. */
  scale: AxisScale<D>
  /** Pixel offset from the top where the axis baseline sits. */
  top: number
  ticks?: number
  format?: (value: D) => string
}

/** Bottom (horizontal) axis — ticks rendered by d3 into an SVG <g>. */
export function XAxis<D extends AxisDomain>({
  scale,
  top,
  ticks = 6,
  format,
}: XAxisProps<D>) {
  const ref = useRef<SVGGElement | null>(null)
  useEffect(() => {
    if (!ref.current) return
    const axis = axisBottom<D>(scale).ticks(ticks)
    if (format) axis.tickFormat((d) => format(d))
    select(ref.current).call(axis)
  }, [scale, ticks, format])
  return <g ref={ref} className={styles.axis} transform={`translate(0, ${top})`} />
}

interface YAxisProps {
  scale: AxisScale<NumberValue>
  /** Pixel offset from the left where the axis baseline sits. */
  left: number
  /** 'left' draws ticks to the left of the line, 'right' to the right. */
  orient?: 'left' | 'right'
  ticks?: number
  format?: (value: NumberValue) => string
  /** Override d3's default tick-label padding (3px). */
  tickPadding?: number
}

/** Vertical axis — left- or right-hand side, for single- or dual-axis charts. */
export function YAxis({ scale, left, orient = 'left', ticks = 5, format, tickPadding }: YAxisProps) {
  const ref = useRef<SVGGElement | null>(null)
  useEffect(() => {
    if (!ref.current) return
    const axis = (orient === 'right' ? axisRight(scale) : axisLeft(scale)).ticks(ticks)
    if (format) axis.tickFormat((d) => format(d))
    if (tickPadding !== undefined) axis.tickPadding(tickPadding)
    select(ref.current).call(axis)
  }, [scale, orient, ticks, format, tickPadding])
  return <g ref={ref} className={styles.axis} transform={`translate(${left}, 0)`} />
}
