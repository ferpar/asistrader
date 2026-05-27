import { useLayoutEffect, useRef, useState } from 'react'
import {
  convergenceBand,
  type ConvergenceScore,
} from '../domain/radar/convergenceScore'
import styles from './ConvergenceChip.module.css'

const VIEWPORT_PAD = 8

interface Props {
  score: ConvergenceScore
  /** Compact chip omits the sign for tighter table cells. */
  compact?: boolean
}

const BAND_CLASS: Record<ReturnType<typeof convergenceBand>, string> = {
  'strong-pos': styles.bandStrongPos,
  pos: styles.bandPos,
  neutral: styles.bandNeutral,
  neg: styles.bandNeg,
  'strong-neg': styles.bandStrongNeg,
}

function formatScore(score: number, compact: boolean): string {
  const rounded = Math.round(score)
  if (compact) return String(rounded)
  return rounded > 0 ? `+${rounded}` : String(rounded)
}

function formatContribution(value: number): string {
  const rounded = Math.round(value * 10) / 10
  if (rounded === 0) return '0'
  return rounded > 0 ? `+${rounded}` : String(rounded)
}

export function ConvergenceChip({ score, compact = false }: Props) {
  const [popoverPos, setPopoverPos] = useState<{ left: number; top: number } | null>(null)
  const chipRef = useRef<HTMLSpanElement | null>(null)
  const popoverRef = useRef<HTMLSpanElement | null>(null)

  // Position the popover in viewport coordinates anchored to the chip so it
  // escapes any clipping ancestor (the table wrapper uses overflow-x: auto,
  // which forces overflow-y to clip per spec).
  function openPopover() {
    if (!chipRef.current) return
    const rect = chipRef.current.getBoundingClientRect()
    // Provisional placement; clamped to the viewport in the layout effect
    // below once we know the popover's actual rendered size.
    setPopoverPos({ left: rect.left, top: rect.bottom + 6 })
  }

  // Clamp the popover into the viewport once it's measurable: nudge left/right
  // if it overflows horizontally, and flip above the chip if there's no room
  // below. The effect is a fixed point — re-running with already-clamped
  // coords produces the same coords and short-circuits.
  useLayoutEffect(() => {
    if (!popoverPos || !popoverRef.current || !chipRef.current) return
    const popoverRect = popoverRef.current.getBoundingClientRect()
    const chipRect = chipRef.current.getBoundingClientRect()
    let { left, top } = popoverPos

    const maxLeft = window.innerWidth - popoverRect.width - VIEWPORT_PAD
    if (left > maxLeft) left = maxLeft
    if (left < VIEWPORT_PAD) left = VIEWPORT_PAD

    if (top + popoverRect.height > window.innerHeight - VIEWPORT_PAD) {
      const above = chipRect.top - popoverRect.height - 6
      top =
        above >= VIEWPORT_PAD
          ? above
          : Math.max(VIEWPORT_PAD, window.innerHeight - popoverRect.height - VIEWPORT_PAD)
    }

    if (left !== popoverPos.left || top !== popoverPos.top) {
      setPopoverPos({ left, top })
    }
  }, [popoverPos])

  const band = convergenceBand(score.score)
  const open = popoverPos !== null

  return (
    <span
      ref={chipRef}
      className={`${styles.chip} ${BAND_CLASS[band]}`}
      onMouseEnter={openPopover}
      onMouseLeave={() => setPopoverPos(null)}
      onFocus={openPopover}
      onBlur={() => setPopoverPos(null)}
      tabIndex={0}
      aria-label={`Convergence score ${Math.round(score.score)}, ${score.confidence} confidence`}
    >
      {formatScore(score.score, compact)}
      {open && popoverPos && (
        <span
          ref={popoverRef}
          className={styles.popover}
          style={{ left: popoverPos.left, top: popoverPos.top }}
          role="tooltip"
        >
          <span className={styles.popoverTitle}>
            Convergence {formatScore(score.score, false)} · {score.confidence} confidence
          </span>
          <span className={styles.popoverIntro}>
            Signed score in [−100, +100]. Positive = price converging on PE in the
            direction needed to fill the order; negative = drifting away.
          </span>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Component</th>
                <th className={styles.numCol}>Weight</th>
                <th className={styles.numCol}>This trade</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {score.components.map((c) => {
                const signClass =
                  c.raw === null
                    ? styles.muted
                    : c.contribution > 0
                      ? styles.pos
                      : c.contribution < 0
                        ? styles.neg
                        : ''
                return (
                  <tr key={c.key}>
                    <td>{c.label}</td>
                    <td className={styles.numCol}>{c.weight}</td>
                    <td className={`${styles.numCol} ${signClass}`}>
                      {c.raw === null ? '—' : formatContribution(c.contribution)}
                    </td>
                    <td className={styles.note}>{c.note}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </span>
      )}
    </span>
  )
}
