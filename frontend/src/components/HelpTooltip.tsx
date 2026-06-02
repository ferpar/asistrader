import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { getOverlayContainer } from '../overlay/overlayLayers'
import tooltipStyles from '../styles/tooltip.module.css'
import styles from './HelpTooltip.module.css'

interface HelpTooltipProps {
  /** Accessible label for the icon (e.g. "TIR chart guide"). */
  ariaLabel: string
  /** Tooltip body — heading, grid, prose, whatever the caller needs. */
  children: ReactNode
  /** Glyph shown inside the icon. Defaults to a question mark. */
  glyph?: string
  /** Preferred side to open toward; flips automatically when room is tight. */
  placement?: 'top' | 'bottom'
}

/** Margin kept between the popover and the viewport edges. */
const VIEWPORT_PAD = 8
/** Gap between the icon and the popover. */
const ANCHOR_GAP = 6
/** Hover bridge so moving from icon to popover across the gap doesn't dismiss it. */
const CLOSE_DELAY_MS = 120

interface Pos {
  left: number
  top: number
  maxWidth: number
  maxHeight: number
}

/**
 * Small `?` info icon with a rich popover. Opens on hover/focus and toggles
 * pinned on click (so it works on touch and can be kept open). While pinned it
 * stays until an outside click or Escape dismisses it.
 *
 * The popover is portaled to <body> and positioned with JS so it ALWAYS stays
 * within the viewport: it centers on the icon, flips to whichever side has more
 * room, clamps both axes inside the edges, and caps its height (scrolling the
 * overflow) when content is taller than the available space.
 */
export function HelpTooltip({ ariaLabel, children, glyph = '?', placement = 'top' }: HelpTooltipProps) {
  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [pos, setPos] = useState<Pos | null>(null)
  const hostRef = useRef<HTMLSpanElement>(null)
  const iconRef = useRef<HTMLButtonElement>(null)
  const tipRef = useRef<HTMLSpanElement>(null)
  const closeTimer = useRef<number | null>(null)

  const open = pinned || hovered

  const openHover = () => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    setHovered(true)
  }
  const closeHover = () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setHovered(false), CLOSE_DELAY_MS)
  }

  useEffect(() => () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current)
  }, [])

  // Outside-click / Escape dismissal while pinned.
  useEffect(() => {
    if (!pinned) return
    const onDocPointer = (e: MouseEvent) => {
      const t = e.target as Node
      if (hostRef.current?.contains(t) || tipRef.current?.contains(t)) return
      setPinned(false)
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

  // Measure the popover and clamp it into the viewport whenever it's shown.
  // Re-runs on scroll/resize so it tracks the anchor.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const place = () => {
      const icon = iconRef.current
      const tip = tipRef.current
      if (!icon || !tip) return
      const ir = icon.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight

      // Width: never wider than the viewport allows.
      const maxWidth = Math.min(tip.offsetWidth, vw - 2 * VIEWPORT_PAD)

      // Horizontal: center on the icon, then clamp inside the edges.
      const center = ir.left + ir.width / 2
      const left = Math.min(Math.max(center - maxWidth / 2, VIEWPORT_PAD), vw - maxWidth - VIEWPORT_PAD)

      // Vertical: prefer the requested side, flip to the roomier one when tight.
      const roomAbove = ir.top - ANCHOR_GAP - VIEWPORT_PAD
      const roomBelow = vh - ir.bottom - ANCHOR_GAP - VIEWPORT_PAD
      let below = placement === 'bottom'
      if (below && tip.offsetHeight > roomBelow && roomAbove > roomBelow) below = false
      else if (!below && tip.offsetHeight > roomAbove && roomBelow > roomAbove) below = true

      const maxHeight = Math.max(below ? roomBelow : roomAbove, 80)
      const usedHeight = Math.min(tip.offsetHeight, maxHeight)
      const top = below ? ir.bottom + ANCHOR_GAP : ir.top - ANCHOR_GAP - usedHeight
      setPos({ left, top, maxWidth, maxHeight })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, placement, children])

  const popover =
    open &&
    createPortal(
      <span
        ref={tipRef}
        className={`${tooltipStyles.richTooltip} ${tooltipStyles.floating} ${pinned ? tooltipStyles.pinned : ''}`}
        role="tooltip"
        style={
          pos
            ? { left: pos.left, top: pos.top, maxWidth: pos.maxWidth, maxHeight: pos.maxHeight }
            : { left: 0, top: 0, opacity: 0 }
        }
        onMouseEnter={openHover}
        onMouseLeave={closeHover}
      >
        {children}
      </span>,
      getOverlayContainer('tooltip'),
    )

  return (
    <span ref={hostRef} className={tooltipStyles.richTooltipHost}>
      <button
        ref={iconRef}
        type="button"
        className={styles.helpIcon}
        aria-label={ariaLabel}
        aria-expanded={pinned}
        onClick={() => setPinned((v) => !v)}
        onMouseEnter={openHover}
        onMouseLeave={closeHover}
        onFocus={openHover}
        onBlur={closeHover}
      >
        {glyph}
      </button>
      {popover}
    </span>
  )
}
