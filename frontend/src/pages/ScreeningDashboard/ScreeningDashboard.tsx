import { useEffect, useMemo } from 'react'
import { observer } from '@legendapp/state/react'
import { useRadarStore, useIrrStore } from '../../container/ContainerContext'
import { HelpTooltip } from '../../components/HelpTooltip'
import {
  computeScreening,
  DEFAULT_WEIGHTS,
  TIER_A_MIN,
  TIER_B_MIN,
  type ScreenedTicker,
  type Tier,
} from '../../domain/screening/screeningScore'
import styles from './ScreeningDashboard.module.css'

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

  const refresh = () => {
    radarStore.loadIndicators(true)
    irrStore.loadAnalysis()
  }

  return (
    <section>
      <div className={styles.header}>
        <h2>
          Screening
          <HelpTooltip ariaLabel="How screening scores work">
            <span className={styles.guideHeading}>How the score works</span>
            <p className={styles.guideText}>
              Each ticker is scored 0–100 from two families, with{' '}
              <strong>historical performance ({Math.round(DEFAULT_WEIGHTS.family.historical * 100)}%)</strong>{' '}
              weighted above <strong>technicals ({Math.round(DEFAULT_WEIGHTS.family.technical * 100)}%)</strong>.
              Every metric is normalized across the current watchlist (best in set = full marks),
              then weighted and summed.
            </p>
            <p className={styles.guideText}>
              <strong>Historical:</strong> higher avg return &amp; winner frequency, lower loser
              frequency &amp; holding days. <strong>Technical:</strong> bullish SMA score, bullish
              divergence (by strength), oversold RSI, higher avg annualized TIR, with recent 5d/50d
              momentum as a small counterpoint.
            </p>
            <p className={styles.guideText}>
              Tiers: <strong>A</strong> ≥ {TIER_A_MIN}, <strong>B</strong> ≥ {TIER_B_MIN},{' '}
              <strong>C</strong> below. Tickers with no closed trades have no historical track record
              and are listed as <strong>Unrated</strong>.
            </p>
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
          {(['A', 'B', 'C'] as Tier[]).map((tier) => (
            <section key={tier} className={styles.tierSection}>
              <h3 className={styles.tierHeading}>
                <span className={`${styles.tierBadge} ${styles[`tier${tier}`]}`}>{tier}</span>
                <span>{TIER_LABEL[tier]}</span>
                <span className={styles.count}>{result.tiers[tier].length}</span>
              </h3>
              <ScoreTable rows={result.tiers[tier]} showScore />
            </section>
          ))}

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
