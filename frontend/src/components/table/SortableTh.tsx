import type { SortTerm } from '../../hooks/useMultiSort'
import styles from './SortableTh.module.css'

export interface SortCtl<K extends string> {
  terms: SortTerm<K>[]
  toggle: (key: K, additive: boolean) => void
  priorityOf: (key: K) => number
  dirOf: (key: K) => 'asc' | 'desc' | null
}

const SORT_HINT = 'Click to sort · Shift-click to add a tie-breaker column'

export function SortableTh<K extends string>({
  label,
  sortKey,
  numeric,
  sort,
  className,
  title,
}: {
  label: string
  sortKey: K
  numeric?: boolean
  sort: SortCtl<K>
  /** Extra class for the header cell (e.g. a left-aligned label column). */
  className?: string
  /** Column-meaning tooltip; the sort hint is appended after it. */
  title?: string
}) {
  const dir = sort.dirOf(sortKey)
  const showPriority = sort.terms.length > 1 && dir !== null
  const cls = [numeric ? styles.num : '', className ?? '', styles.sortable, dir ? styles.sortActive : '']
    .filter(Boolean)
    .join(' ')
  return (
    <th
      className={cls}
      onClick={(e) => sort.toggle(sortKey, e.shiftKey)}
      title={title ? `${title} · ${SORT_HINT}` : SORT_HINT}
      aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}
    >
      {label}
      {dir && <span className={styles.sortArrow}>{dir === 'asc' ? '▲' : '▼'}</span>}
      {showPriority && <span className={styles.sortPriority}>{sort.priorityOf(sortKey)}</span>}
    </th>
  )
}
