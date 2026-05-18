import { useCallback, useMemo, useState } from 'react'

/** Sort direction for a single column. */
export type SortDir = 'asc' | 'desc'

/** One active sort term: a column key and its direction. */
export interface SortTerm<K extends string> {
  key: K
  dir: SortDir
}

/** A value the sorter knows how to compare. `null`/`undefined` sort last. */
export type Sortable = string | number | boolean | null | undefined

/**
 * Multi-column table sorting.
 *
 * A plain click on a header sorts by that column alone, cycling
 * asc → desc → off. A shift-click adds the column as a lower-priority tie
 * breaker (and cycles/removes it the same way) so several columns can be
 * combined — e.g. sort by ticker, then by profit within each ticker.
 */
export function useMultiSort<K extends string>(initial: SortTerm<K>[] = []) {
  const [terms, setTerms] = useState<SortTerm<K>[]>(initial)

  const toggle = useCallback((key: K, additive: boolean) => {
    setTerms((prev) => {
      const existing = prev.find((t) => t.key === key)

      if (!additive) {
        // Replace the whole sort with this single column, cycling its state.
        if (!existing) return [{ key, dir: 'asc' }]
        if (existing.dir === 'asc') return [{ key, dir: 'desc' }]
        return [] // was 'desc' — clear the sort
      }

      // Shift-click: cycle this column in place, leaving the others intact.
      if (!existing) return [...prev, { key, dir: 'asc' }]
      if (existing.dir === 'asc') {
        return prev.map((t) => (t.key === key ? { ...t, dir: 'desc' } : t))
      }
      return prev.filter((t) => t.key !== key) // drop it from the chain
    })
  }, [])

  /** The 1-based priority of a column in the sort chain, or 0 if unsorted. */
  const priorityOf = useCallback(
    (key: K): number => {
      const i = terms.findIndex((t) => t.key === key)
      return i < 0 ? 0 : i + 1
    },
    [terms],
  )

  const dirOf = useCallback(
    (key: K): SortDir | null => terms.find((t) => t.key === key)?.dir ?? null,
    [terms],
  )

  return { terms, toggle, priorityOf, dirOf }
}

function isEmpty(v: Sortable): boolean {
  return v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v))
}

/**
 * Compare two cells for one sort term. The direction is folded in here so that
 * `null`/`undefined`/`NaN` can always sort last — even for a descending sort,
 * where a naive caller-side negation would otherwise push them to the top.
 */
function compareCell(a: Sortable, b: Sortable, dir: SortDir): number {
  if (isEmpty(a)) return isEmpty(b) ? 0 : 1
  if (isEmpty(b)) return -1
  let c: number
  if (typeof a === 'string' && typeof b === 'string') {
    c = a.localeCompare(b)
  } else {
    // Numeric (or boolean, via 0/1) comparison.
    const na = Number(a)
    const nb = Number(b)
    c = na < nb ? -1 : na > nb ? 1 : 0
  }
  return dir === 'asc' ? c : -c
}

/**
 * Return a new array sorted by the given terms. The sort is stable, so rows
 * equal under every term keep their original order. `getValue` maps a row +
 * column key to the comparable value for that cell.
 */
export function sortRows<T, K extends string>(
  rows: readonly T[],
  terms: SortTerm<K>[],
  getValue: (row: T, key: K) => Sortable,
): T[] {
  if (terms.length === 0) return [...rows]
  return [...rows].sort((ra, rb) => {
    for (const { key, dir } of terms) {
      const c = compareCell(getValue(ra, key), getValue(rb, key), dir)
      if (c !== 0) return c
    }
    return 0
  })
}

/** Hook to memoize a sorted view of `rows`. */
export function useSortedRows<T, K extends string>(
  rows: readonly T[],
  terms: SortTerm<K>[],
  getValue: (row: T, key: K) => Sortable,
): T[] {
  return useMemo(() => sortRows(rows, terms, getValue), [rows, terms, getValue])
}
