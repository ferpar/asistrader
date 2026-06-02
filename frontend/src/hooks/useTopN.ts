import { useState } from 'react'

/**
 * Progressive disclosure for long row lists: show the top `limit` rows with a
 * "Show all" expander, instead of rendering dozens at once. Returns the visible
 * slice plus the controls to render the expander.
 */
export function useTopN<T>(rows: readonly T[], limit: number) {
  const [expanded, setExpanded] = useState(false)
  const canExpand = rows.length > limit
  const visible = expanded || !canExpand ? [...rows] : rows.slice(0, limit)
  return {
    visible,
    expanded,
    canExpand,
    total: rows.length,
    hidden: rows.length - visible.length,
    toggle: () => setExpanded((e) => !e),
  }
}
