import styles from './ShowMore.module.css'

/** "Show all (N) / Show fewer" expander for top-N truncated tables. */
export function ShowMore({
  expanded,
  total,
  onToggle,
}: {
  expanded: boolean
  total: number
  onToggle: () => void
}) {
  return (
    <button type="button" className={styles.showMore} onClick={onToggle}>
      {expanded ? 'Show fewer' : `Show all ${total}`}
    </button>
  )
}
