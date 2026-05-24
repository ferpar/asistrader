import type { SortTerm } from '../../hooks/useMultiSort'
import shared from './shared.module.css'
import styles from './SortableTh.module.css'

export interface SortCtl<K extends string> {
  terms: SortTerm<K>[]
  toggle: (key: K, additive: boolean) => void
  priorityOf: (key: K) => number
  dirOf: (key: K) => 'asc' | 'desc' | null
}

export function SortableTh<K extends string>({
  label,
  sortKey,
  numeric,
  sort,
}: {
  label: string
  sortKey: K
  numeric?: boolean
  sort: SortCtl<K>
}) {
  const dir = sort.dirOf(sortKey)
  const showPriority = sort.terms.length > 1 && dir !== null
  return (
    <th
      className={`${numeric ? shared.num : ''} ${styles.sortable} ${dir ? styles.sortActive : ''}`}
      onClick={(e) => sort.toggle(sortKey, e.shiftKey)}
      title="Click to sort · Shift-click to add a tie-breaker column"
      aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}
    >
      {label}
      {dir && <span className={styles.sortArrow}>{dir === 'asc' ? '▲' : '▼'}</span>}
      {showPriority && <span className={styles.sortPriority}>{sort.priorityOf(sortKey)}</span>}
    </th>
  )
}
