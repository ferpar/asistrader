import { useCallback, type ReactNode } from 'react'
import type { BasketKind, RankingRow } from '../../domain/basket/types'
import { annualizedTir } from '../../domain/radar/indicators'
import { useMultiSort, useSortedRows } from '../../hooks/useMultiSort'
import { SortableTh } from '../../components/table/SortableTh'
import { fmtPct } from '../../components/portfolio/format'
import { signClass } from '../../components/portfolio/signClass'
import styles from './Baskets.module.css'

type RankingKey =
  | 'name'
  | 'kind'
  | 'members'
  | 'momentum'
  | 'r1m'
  | 'r3m'
  | 'r6m'
  | 'r1y'
  | 'bullish'
  | 'lrSlope'
  | 'lrR2'
  | 'tir'
  | 'rsi'

const KIND_LABEL: Record<RankingRow['kind'], string> = {
  curated: 'Curated',
  personal: 'Personal',
  benchmark: 'Benchmark',
}

function value(row: RankingRow, key: RankingKey): string | number | null {
  const { momentum, sma, linearRegression, rsi } = row.indicators
  switch (key) {
    case 'name':
      return row.name
    case 'kind':
      return KIND_LABEL[row.kind]
    case 'members':
      return row.memberCount
    case 'momentum':
      return momentum.score
    case 'r1m':
      return momentum.r1m
    case 'r3m':
      return momentum.r3m
    case 'r6m':
      return momentum.r6m
    case 'r1y':
      return momentum.r1y
    case 'bullish':
      return sma.bullishScore
    case 'lrSlope':
      return linearRegression.lr50.slopePct
    case 'lrR2':
      return linearRegression.lr50.r2
    case 'tir':
      return annualizedTir(linearRegression.lr50.slopePct)
    case 'rsi':
      return rsi.latest
  }
}

const pct = (v: number | null) => (v === null ? '—' : fmtPct(v))
const PctCell = ({ v }: { v: number | null }) => <td className={`${styles.num} ${signClass(v ?? 0)}`}>{pct(v)}</td>

type BasketRow = Extract<RankingRow, { kind: BasketKind }>

interface BasketRankingTableProps {
  rows: RankingRow[]
  onOpen: (id: number) => void
  /** Per-Basket actions (copy, rename…) in a trailing column; benchmarks get none. */
  renderActions?: (row: BasketRow) => ReactNode
}

/**
 * Baskets and benchmark reference rows measured on their index series, sorted
 * by Momentum Score by default. Every column sorts; shift-click adds a
 * tie-breaker. The Kind column marks Curated, Personal and benchmark rows.
 */
export function BasketRankingTable({ rows, onOpen, renderActions }: BasketRankingTableProps) {
  const sort = useMultiSort<RankingKey>([{ key: 'momentum', dir: 'desc' }])
  const getValue = useCallback(value, [])
  const sorted = useSortedRows(rows, sort.terms, getValue)

  const th = (label: string, key: RankingKey, title?: string, numeric = true) => (
    <SortableTh label={label} sortKey={key} numeric={numeric} sort={sort} title={title} />
  )

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {th('Basket', 'name', undefined, false)}
            {th('Kind', 'kind', undefined, false)}
            {th('Members', 'members')}
            {th('Momentum', 'momentum', 'Momentum Score: 0.35·r1M + 0.30·r3M + 0.20·r6M + 0.15·r1Y')}
            {th('r1M', 'r1m', 'Return over 21 trading days')}
            {th('r3M', 'r3m', 'Return over 63 trading days')}
            {th('r6M', 'r6m', 'Return over 126 trading days')}
            {th('r1Y', 'r1y', 'Return over 252 trading days')}
            {th('Bullish', 'bullish', 'SMA structure bullish score, 0–10')}
            {th('LR50 %/d', 'lrSlope', '50-day linear regression slope, % per day')}
            {th('LR50 R²', 'lrR2', '50-day linear regression fit')}
            {th('TIR', 'tir', 'Annualised TIR = 50-day slope %/day × 365')}
            {th('RSI', 'rsi', '14-day RSI')}
            {renderActions && <th aria-label="Actions" />}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const { momentum, sma, linearRegression, rsi } = row.indicators
            const tir = annualizedTir(linearRegression.lr50.slopePct)
            const isBasket = row.kind !== 'benchmark'
            return (
              <tr key={`${row.kind}:${row.id}`} className={isBasket ? undefined : styles.reference}>
                <td>
                  {isBasket ? (
                    <button type="button" className={styles.linkButton} onClick={() => onOpen(row.id)}>
                      {row.name}
                    </button>
                  ) : (
                    row.name
                  )}
                </td>
                <td>
                  <span className={`${styles.badge} ${styles[row.kind]}`}>{KIND_LABEL[row.kind]}</span>
                </td>
                <td className={styles.num}>{row.memberCount ?? '—'}</td>
                <td className={`${styles.num} ${styles.strong} ${signClass(momentum.score ?? 0)}`}>
                  {pct(momentum.score)}
                </td>
                <PctCell v={momentum.r1m} />
                <PctCell v={momentum.r3m} />
                <PctCell v={momentum.r6m} />
                <PctCell v={momentum.r1y} />
                <td className={styles.num}>{sma.bullishScore ?? '—'}</td>
                <PctCell v={linearRegression.lr50.slopePct} />
                <td className={styles.num}>
                  {linearRegression.lr50.r2 === null ? '—' : linearRegression.lr50.r2.toFixed(2)}
                </td>
                <PctCell v={tir} />
                <td className={styles.num}>{rsi.latest === null ? '—' : rsi.latest.toFixed(0)}</td>
                {renderActions && (
                  <td className={styles.rowActions}>{row.kind !== 'benchmark' && renderActions(row)}</td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
