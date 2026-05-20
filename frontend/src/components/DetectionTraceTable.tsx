import type { BarEval, LevelCheck, ScanTrace } from '../domain/trade/types'
import styles from './DetectionTraceTable.module.css'

interface Props {
  trace: ScanTrace
}

/**
 * Bar-by-bar diagnostic table for one detection scan. Mirrors the layout of
 * the CLI (`asistrader.cli.detect`): one row per bar, one cell per level
 * check, plus decision and reason. Pure presentational — both the modal on
 * an alert and the detection sandbox page use this.
 */
export function DetectionTraceTable({ trace }: Props) {
  if (trace.bars.length === 0) {
    return <div className={styles.empty}>{trace.verdict}</div>
  }

  const keys = orderedKeys(trace.bars)

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>date</th>
          <th className={styles.num}>open</th>
          <th className={styles.num}>high</th>
          <th className={styles.num}>low</th>
          <th className={styles.num}>close</th>
          <th className={styles.num}>prev</th>
          {keys.map(k => <th key={k} className={styles.check}>{k}</th>)}
          <th>decision</th>
          <th>reason</th>
        </tr>
      </thead>
      <tbody>
        {trace.bars.map(bar => (
          <tr key={bar.date} className={rowClass(bar)}>
            <td>{bar.date}</td>
            <td className={styles.num}>{fmt(bar.open)}</td>
            <td className={styles.num}>{fmt(bar.high)}</td>
            <td className={styles.num}>{fmt(bar.low)}</td>
            <td className={styles.num}>{fmt(bar.close)}</td>
            <td className={styles.num}>{fmt(bar.prevClose)}</td>
            {keys.map(k => (
              <td key={k} className={styles.check}>
                {renderCheck(bar.checks.find(c => c.key === k))}
              </td>
            ))}
            <td className={styles.decision}>{bar.decision}</td>
            <td className={styles.reason}>{bar.reason}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Stable key order across the scan: SLs by order_index, then TPs, then entry. */
function orderedKeys(bars: BarEval[]): string[] {
  const seen: string[] = []
  for (const bar of bars) {
    for (const c of bar.checks) {
      if (!seen.includes(c.key)) seen.push(c.key)
    }
  }
  return seen.sort((a, b) => sortRank(a) - sortRank(b))
}

function sortRank(key: string): number {
  if (key === 'entry') return 200
  const [kind, idx] = key.split(':')
  const kindOrder = kind === 'sl' ? 0 : 100
  const i = idx ? Number(idx) : 0
  return kindOrder + i
}

function rowClass(bar: BarEval): string {
  if (bar.decision === 'hit' || bar.decision === 'both_hit') return styles.rowHit
  if (bar.decision === 'no_data') return styles.rowNoData
  return ''
}

function renderCheck(check: LevelCheck | undefined): string {
  if (!check) return ''
  const marker = check.pierced ? '✓' : '·'
  return check.gap ? `${marker}*` : marker
}

function fmt(d: { toString(): string } | null): string {
  if (d === null || d === undefined) return '—'
  return d.toString()
}
