import { useEffect, useMemo } from 'react'
import { observer } from '@legendapp/state/react'
import { useRadarStore, useIrrStore } from '../../container/ContainerContext'
import { HelpTooltip } from '../../components/HelpTooltip'
import { PortfolioCard } from '../../components/portfolio/PortfolioCard'
import { aggregateGroup } from '../../domain/irr/aggregate'
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
  { label: 'Hist', title: 'Historical family sub-score (0–100)', get: (r) => r.familyScores.historical, fmt: num0 },
  { label: 'Tech', title: 'Technical family sub-score (0–100)', get: (r) => r.familyScores.technical, fmt: num0 },
  { label: 'Avg ret', title: 'Average return per closed trade', get: (r) => r.metrics.avgReturnPerTrade, fmt: pct, signed: true },
  { label: 'Win%', title: 'Winner frequency among decisive closes', get: (r) => r.metrics.winnerFreq, fmt: pct },
  { label: 'Loss%', title: 'Loser frequency among decisive closes (lower is better)', get: (r) => r.metrics.loserFreq, fmt: pct },
  { label: 'Avg days', title: 'Average holding days per trade (lower is better)', get: (r) => r.metrics.avgHoldingDays, fmt: num1 },
  { label: 'Bullish', title: 'SMA bullish-order score (0–10)', get: (r) => r.metrics.bullishScore, fmt: bullish },
  { label: 'TIR', title: 'Average annualized TIR over the 20/50/200 regression windows', get: (r) => r.metrics.avgAnnualizedTir, fmt: pct, signed: true },
  { label: 'RSI', title: 'Latest RSI (oversold <30 favored, overbought >70 penalized)', get: (r) => r.metrics.rsiLatest, fmt: num0, signed: true, colorBy: (r) => r.metrics.rsiBand },
  { label: 'Div', title: 'Signed divergence strength (+bullish / −bearish)', get: (r) => r.metrics.divergence, fmt: signed, signed: true },
  { label: 'Mom', title: 'Average of 5d & 50d daily change %', get: (r) => r.metrics.momentum, fmt: pct, signed: true },
]

function ScoreTable({ rows, showScore }: { rows: ScreenedTicker[]; showScore: boolean }) {
  if (!rows.length) return <p className={styles.empty}>None.</p>
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {showScore && <th className={styles.num}>Score</th>}
            <th className={styles.symCol}>Ticker</th>
            <th className={styles.num} title="Closed trades">N</th>
            {COLUMNS.map((c) => (
              <th key={c.label} className={styles.num} title={c.title}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
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
                  <td key={c.label} className={`${styles.num} ${cls}`}>{c.fmt(c.get(r))}</td>
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
  const radarStore = useRadarStore()
  const irrStore = useIrrStore()

  useEffect(() => {
    radarStore.loadIndicators()
    irrStore.loadAnalysis()
  }, [radarStore, irrStore])

  const indicators = radarStore.indicators$.get()
  const analysis = irrStore.analysis$.get()
  const loading = radarStore.loading$.get() || irrStore.loading$.get()
  const error = radarStore.error$.get() || irrStore.error$.get()

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
    radarStore.loadIndicators(true)
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
        on every load. Hover a column header for its meaning.
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
