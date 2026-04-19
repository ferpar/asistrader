import type { DayEstimate } from '../../../utils/timelineExpectations'
import styles from './TimelineOverlapBar.module.css'

export interface TimelineSide {
  a: DayEstimate | null
  b: DayEstimate | null
}

interface Props {
  dynamic: TimelineSide
  projected: TimelineSide | null
  title?: string
}

function numericsOf(side: TimelineSide): number[] {
  const out: number[] = []
  if (typeof side.a === 'number') out.push(side.a)
  if (typeof side.b === 'number') out.push(side.b)
  return out
}

export function TimelineOverlapBar({ dynamic, projected, title }: Props) {
  const dNums = numericsOf(dynamic)
  const pNums = projected ? numericsOf(projected) : []
  const allNums = [...dNums, ...pNums]
  if (allNums.length === 0) return null

  const axisMin = Math.min(...allNums)
  const axisMax = Math.max(...allNums)
  const span = axisMax - axisMin
  const pad = span === 0 ? Math.max(0.5, Math.abs(axisMax) * 0.1) : span * 0.05
  const domMin = Math.max(0, axisMin - pad)
  const domMax = axisMax + pad
  const domSpan = domMax - domMin || 1

  const pct = (v: number) => ((v - domMin) / domSpan) * 100

  const renderSeg = (nums: number[], className: string) => {
    if (nums.length === 0) return null
    const lo = Math.min(...nums)
    const hi = Math.max(...nums)
    const left = pct(lo)
    const width = Math.max(4, pct(hi) - left)
    return <span className={className} style={{ left: `${left}%`, width: `${width}%` }} />
  }

  return (
    <span className={styles.bar} title={title}>
      {projected && renderSeg(pNums, styles.projected)}
      {renderSeg(dNums, styles.dynamic)}
    </span>
  )
}
