import { useEffect, useRef, useState, type ReactNode } from 'react'
import styles from './CollapsibleSection.module.css'

const STORAGE_PREFIX = 'asistrader:collapse:'

function usePersistedExpanded(persistKey: string, defaultExpanded: boolean) {
  const key = STORAGE_PREFIX + persistKey
  const [expanded, setExpanded] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw === null ? defaultExpanded : raw === '1'
    } catch {
      return defaultExpanded
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, expanded ? '1' : '0')
    } catch {
      // non-fatal
    }
  }, [key, expanded])
  return [expanded, setExpanded] as const
}

interface Props {
  title: string
  /** localStorage suffix so each section remembers its own open/closed state. */
  persistKey: string
  defaultExpanded?: boolean
  /** Row count shown beside the title (e.g. table length). */
  count?: number
  /** Controls kept in the header, always visible and not part of the fold. */
  headerExtra?: ReactNode
  /** Always-visible content (e.g. a summary card) shown above the foldable body. */
  summary?: ReactNode
  /** The foldable body — lazy-mounted on first expand, then kept mounted. */
  children?: ReactNode
}

/**
 * A section whose summary stays visible while its heavy body (tables/charts)
 * folds away. Open/closed is persisted per `persistKey`; the body is lazy-mounted
 * on first open and then kept mounted (so table sort/tab state survives folding).
 */
export function CollapsibleSection({
  title,
  persistKey,
  defaultExpanded = true,
  count,
  headerExtra,
  summary,
  children,
}: Props) {
  const [expanded, setExpanded] = usePersistedExpanded(persistKey, defaultExpanded)
  const hasOpened = useRef(expanded)
  if (expanded) hasOpened.current = true

  const hasBody = children != null

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={expanded}
          disabled={!hasBody}
          onClick={() => setExpanded((v) => !v)}
        >
          {hasBody && <span className={styles.chevron}>{expanded ? '▾' : '▸'}</span>}
          <span className={styles.title}>{title}</span>
          {count != null && <span className={styles.count}>{count}</span>}
        </button>
        {headerExtra && <div className={styles.controls}>{headerExtra}</div>}
      </div>

      {summary}

      {hasBody && hasOpened.current && (
        <div className={expanded ? undefined : styles.hidden} aria-hidden={!expanded}>
          {children}
        </div>
      )}
    </section>
  )
}
