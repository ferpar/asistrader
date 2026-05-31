import { useEffect, useRef, useState, type ReactNode } from 'react'
import tooltipStyles from '../styles/tooltip.module.css'
import styles from './HelpTooltip.module.css'

interface HelpTooltipProps {
  /** Accessible label for the icon (e.g. "TIR chart guide"). */
  ariaLabel: string
  /** Tooltip body — heading, grid, prose, whatever the caller needs. */
  children: ReactNode
  /** Glyph shown inside the icon. Defaults to a question mark. */
  glyph?: string
}

/**
 * Small `?` info icon with a rich popover. Opens on hover/focus (CSS), and also
 * toggles open on click so it works on touch and can be pinned open. While
 * pinned it stays visible until an outside click or Escape dismisses it.
 */
export function HelpTooltip({ ariaLabel, children, glyph = '?' }: HelpTooltipProps) {
  const [pinned, setPinned] = useState(false)
  const hostRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!pinned) return
    const onDocPointer = (e: MouseEvent) => {
      if (hostRef.current && !hostRef.current.contains(e.target as Node)) setPinned(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPinned(false)
    }
    document.addEventListener('mousedown', onDocPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [pinned])

  return (
    <span ref={hostRef} className={tooltipStyles.richTooltipHost}>
      <button
        type="button"
        className={styles.helpIcon}
        aria-label={ariaLabel}
        aria-expanded={pinned}
        onClick={() => setPinned((v) => !v)}
      >
        {glyph}
      </button>
      <span
        className={`${tooltipStyles.richTooltip} ${pinned ? tooltipStyles.pinned : ''}`}
        role="tooltip"
      >
        {children}
      </span>
    </span>
  )
}
