import { useEffect, useMemo } from 'react'
import { observer } from '@legendapp/state/react'
import { useIndicatorStore, useIrrStore } from '../../container/ContainerContext'
import { HelpTooltip } from '../../components/HelpTooltip'
import { PortfolioCard } from '../../components/portfolio/PortfolioCard'
import { SortableTh } from '../../components/table/SortableTh'
import { aggregateGroup } from '../../domain/irr/aggregate'
import { useMultiSort, useSortedRows, type Sortable } from '../../hooks/useMultiSort'
import {
  computeScreening,
  DEFAULT_WEIGHTS,
  HISTORY_CONFIDENCE_K,
  historyConfidence,
  TIER_A_MIN,
  TIER_B_MIN,
  type ScreenedTicker,
  type Tier,
} from '../../domain/screening/screeningScore'
import styles from './ScreeningDashboard.module.css'

const wpct = (w: number) => `${Math.round(w * 100)}%`
const confPct = (n: number) => `${Math.round(historyConfidence(n) * 100)}%`

/** Per-metric weights within each family, surfaced verbatim in the guide. */
const HIST_WEIGHTS: [string, number][] = [
  ['Avg return / trade', DEFAULT_WEIGHTS.historical.avgReturnPerTrade],
  ['Winner frequency', DEFAULT_WEIGHTS.historical.winnerFreq],
  ['Loser frequency (lower better)', DEFAULT_WEIGHTS.historical.loserFreq],
  ['Avg holding days (lower better)', DEFAULT_WEIGHTS.historical.avgHoldingDays],
]
const TECH_WEIGHTS: [string, number][] = [
  ['Avg annualized TIR', DEFAULT_WEIGHTS.technical.avgAnnualizedTir],
  ['Bullish SMA score', DEFAULT_WEIGHTS.technical.bullishScore],
  ['Divergence (signed strength)', DEFAULT_WEIGHTS.technical.divergence],
  ['RSI band (oversold favored)', DEFAULT_WEIGHTS.technical.rsiBand],
  ['5d / 50d momentum', DEFAULT_WEIGHTS.technical.momentum],
]

/** The full scoring methodology, shown in the title's info popover. */
function ScoringGuide() {
  return (
    <div className={styles.guide}>
      <span className={styles.guideHeading}>How the screening score works</span>
      <p className={styles.guideText}>
        Each watchlist ticker gets a <strong>0–100 composite</strong> from two families. Every
        metric is normalized <em>relative to the current watchlist</em> (best in set = full marks),
        weighted within its family, then the families are combined.
      </p>

      <span className={styles.guideSub}>
        Historical — {wpct(DEFAULT_WEIGHTS.family.historical)} of composite
      </span>
      <ul className={styles.guideList}>
        {HIST_WEIGHTS.map(([label, w]) => (
          <li key={label}>
            <span>{label}</span>
            <span>{wpct(w)}</span>
          </li>
        ))}
      </ul>

      <span className={styles.guideSub}>
        Technical — {wpct(DEFAULT_WEIGHTS.family.technical)} of composite
      </span>
      <ul className={styles.guideList}>
        {TECH_WEIGHTS.map(([label, w]) => (
          <li key={label}>
            <span>{label}</span>
            <span>{wpct(w)}</span>
          </li>
        ))}
      </ul>

      <span className={styles.guideSub}>Confidence — thin-history guard</span>
      <p className={styles.guideText}>
        The historical sub-score is <strong>shrunk toward neutral (50)</strong> when a ticker has
        few closed trades, by a factor n / (n + {HISTORY_CONFIDENCE_K}): 1 trade ≈ {confPct(1)},
        {' '}5 ≈ {confPct(5)}, 10 ≈ {confPct(10)}. So a single lucky win can't mint an A tier —
        earning a top tier on track record needs a real sample.
      </p>

      <span className={styles.guideSub}>Tiers</span>
      <p className={styles.guideText}>
        <strong>A</strong> ≥ {TIER_A_MIN}, <strong>B</strong> ≥ {TIER_B_MIN}, <strong>C</strong>{' '}
        below. Tickers with no closed trades have no historical family and are listed as{' '}
        <strong>Unrated</strong>.
      </p>
    </div>
  )
}

const TIER_LABEL: Record<Tier, string> = {
  A: `A — top (score ≥ ${TIER_A_MIN})`,
  B: `B — middle (${TIER_B_MIN}–${TIER_A_MIN})`,
  C: `C — bottom (< ${TIER_B_MIN})`,
}

const num0 = (v: number | null) => (v === null ? '—' : v.toFixed(0))
const num1 = (v: number | null) => (v === null ? '—' : v.toFixed(1))
const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`)
const bullish = (v: number | null) => (v === null ? '—' : `${v}/10`)
const signed = (v: number | null) => (v === null ? '—' : v > 0 ? `+${v}` : `${v}`)

/** Green/red/neutral via the global helper classes (see styles/global.css). */
const sign = (v: number | null) => (v === null || v === 0 ? '' : v > 0 ? 'positive' : 'negative')

interface Column {
  /** Stable id used as the sort key. */
  key: string
  label: string
  title: string
  get: (r: ScreenedTicker) => number | null
  fmt: (v: number | null) => string
  /** When true, color the cell green/red by the sign of `colorBy ?? get`. */
  signed?: boolean
  /** Value that drives the sign color, when it differs from the displayed value. */
  colorBy?: (r: ScreenedTicker) => number | null
}

const COLUMNS: Column[] = [
  { key: 'hist', label: 'Hist', title: 'Historical family sub-score (0–100)', get: (r) => r.familyScores.historical, fmt: num0 },
  { key: 'tech', label: 'Tech', title: 'Technical family sub-score (0–100)', get: (r) => r.familyScores.technical, fmt: num0 },
  { key: 'avgRet', label: 'Avg ret', title: 'Average return per closed trade', get: (r) => r.metrics.avgReturnPerTrade, fmt: pct, signed: true },
  { key: 'winPct', label: 'Win%', title: 'Winner frequency among decisive closes', get: (r) => r.metrics.winnerFreq, fmt: pct },
  { key: 'lossPct', label: 'Loss%', title: 'Loser frequency among decisive closes (lower is better)', get: (r) => r.metrics.loserFreq, fmt: pct },
  { key: 'avgDays', label: 'Avg days', title: 'Average holding days per trade (lower is better)', get: (r) => r.metrics.avgHoldingDays, fmt: num1 },
  { key: 'bullish', label: 'Bullish', title: 'SMA bullish-order score (0–10)', get: (r) => r.metrics.bullishScore, fmt: bullish },
  { key: 'tir', label: 'TIR', title: 'Average annualized TIR over the 20/50/200 regression windows', get: (r) => r.metrics.avgAnnualizedTir, fmt: pct, signed: true },
  { key: 'rsi', label: 'RSI', title: 'Latest RSI (oversold <30 favored, overbought >70 penalized)', get: (r) => r.metrics.rsiLatest, fmt: num0, signed: true, colorBy: (r) => r.metrics.rsiBand },
  { key: 'div', label: 'Div', title: 'Signed divergence strength (+bullish / −bearish)', get: (r) => r.metrics.divergence, fmt: signed, signed: true },
  { key: 'mom', label: 'Mom', title: 'Average of 5d & 50d daily change %', get: (r) => r.metrics.momentum, fmt: pct, signed: true },
]

const COL_BY_KEY = new Map(COLUMNS.map((c) => [c.key, c]))

/** Comparable value for one cell, used by the multi-column sorter. */
function cellValue(r: ScreenedTicker, key: string): Sortable {
  if (key === 'score') return r.score
  if (key === 'symbol') return r.symbol
  if (key === 'tradeCount') return r.tradeCount
  return COL_BY_KEY.get(key)?.get(r) ?? null
}

function ScoreTable({ rows, showScore }: { rows: ScreenedTicker[]; showScore: boolean }) {
  // Default sort mirrors the prior order: rated tiers by score desc, the
  // score-less unrated list alphabetically by ticker.
  const sort = useMultiSort<string>(
    showScore ? [{ key: 'score', dir: 'desc' }] : [{ key: 'symbol', dir: 'asc' }],
  )
  const sorted = useSortedRows(rows, sort.terms, cellValue)

  if (!rows.length) return <p className={styles.empty}>None.</p>
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {showScore && <SortableTh label="Score" sortKey="score" numeric sort={sort} />}
            <SortableTh label="Ticker" sortKey="symbol" sort={sort} className={styles.symCol} />
            <SortableTh label="N" sortKey="tradeCount" numeric title="Closed trades" sort={sort} />
            {COLUMNS.map((c) => (
              <SortableTh key={c.key} label={c.label} sortKey={c.key} numeric title={c.title} sort={sort} />
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.symbol}>
              {showScore && <td className={`${styles.num} ${styles.scoreCell}`}>{num0(r.score)}</td>}
              <td className={styles.symCol}>
                <span className={styles.sym}>{r.symbol}</span>
                {r.name && r.name !== r.symbol && <span className={styles.name}>{r.name}</span>}
              </td>
              <td className={styles.num}>{r.tradeCount || '—'}</td>
              {COLUMNS.map((c) => {
                const cls = c.signed ? sign((c.colorBy ?? c.get)(r)) : ''
                return (
                  <td key={c.key} className={`${styles.num} ${cls}`}>{c.fmt(c.get(r))}</td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export const ScreeningDashboard = observer(function ScreeningDashboard() {
  const indicatorStore = useIndicatorStore()
  const irrStore = useIrrStore()

  useEffect(() => {
    irrStore.loadAnalysis()
  }, [irrStore])

  // Indicators are loaded for the whole universe by IndicatorBootstrap (a common
  // ancestor), so Screening reads the full set regardless of the Radar page.
  const indicators = indicatorStore.indicators$.get()
  const analysis = irrStore.analysis$.get()
  const loading = indicatorStore.loading$.get() || irrStore.loading$.get()
  const error = indicatorStore.error$.get() || irrStore.error$.get()

  const result = useMemo(() => {
    if (!analysis) return null
    return computeScreening(indicators, analysis.realized, DEFAULT_WEIGHTS)
  }, [indicators, analysis])

  // Realized-performance aggregate of each tier's tickers, for the per-tier
  // PortfolioCard. Mixed-currency, so currency stays null (card shows FX drift).
  const tierGroups = useMemo(() => {
    if (!result || !analysis) return null
    const txns = analysis.realized.transactions
    const groupFor = (rows: ScreenedTicker[]) => {
      const symbols = new Set(rows.map((r) => r.symbol.toUpperCase()))
      return aggregateGroup('tier', txns.filter((t) => symbols.has(t.ticker.toUpperCase())))
    }
    return { A: groupFor(result.tiers.A), B: groupFor(result.tiers.B), C: groupFor(result.tiers.C) }
  }, [result, analysis])

  const refresh = () => {
    indicatorStore.reload(true)
    irrStore.loadAnalysis()
  }

  return (
    <section>
      <div className={styles.header}>
        <h2>
          Screening
          <HelpTooltip ariaLabel="How screening scores work" placement="bottom">
            <ScoringGuide />
          </HelpTooltip>
        </h2>
        <button className={styles.refreshBtn} onClick={refresh} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <p className={styles.note}>
        Our watchlist ranked into A / B / C from the latest historical + technical data, recomputed
        on every load. Hover a column header for its meaning; click to sort, shift-click to add a
        tie-breaker column.
      </p>

      {error && <div className={styles.error}>{error}</div>}
      {loading && !result && <p className={styles.empty}>Loading screening…</p>}

      {result && (
        <>
          {(['A', 'B', 'C'] as Tier[]).map((tier) => {
            const group = tierGroups?.[tier] ?? null
            return (
              <section key={tier} className={styles.tierSection}>
                <h3 className={styles.tierHeading}>
                  <span className={`${styles.tierBadge} ${styles[`tier${tier}`]}`}>{tier}</span>
                  <span>{TIER_LABEL[tier]}</span>
                  <span className={styles.count}>{result.tiers[tier].length}</span>
                </h3>
                {group && (
                  <div className={styles.tierCard}>
                    <PortfolioCard group={group} ccy={analysis?.baseCurrency ?? ''} />
                  </div>
                )}
                <ScoreTable rows={result.tiers[tier]} showScore />
              </section>
            )
          })}

          <section className={styles.tierSection}>
            <h3 className={styles.tierHeading}>
              <span className={`${styles.tierBadge} ${styles.tierUnrated}`}>—</span>
              <span>Unrated — no closed trades</span>
              <span className={styles.count}>{result.unrated.length}</span>
            </h3>
            <ScoreTable rows={result.unrated} showScore={false} />
          </section>
        </>
      )}
    </section>
  )
})
