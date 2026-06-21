import { Fragment } from 'react'
import { observer } from '@legendapp/state/react'
import type { UseTradeCreation } from '../hooks/useTradeCreation'
import type { DraftResult } from '../domain/strategy/types'
import { orderedPresets } from '../domain/strategy/draftPresets'
import styles from './StrategyDraftPanel.module.css'

function pct(n: number | null): string {
  return n == null ? '—' : `${(n * 100).toFixed(0)}%`
}

function pctFine(n: number | null): string {
  return n == null ? '—' : `${(n * 100).toFixed(2)}%`
}

function price(n: number): string {
  return String(Number(n.toFixed(4)))
}

/** What each preset optimizes — engine-agnostic, so it lives as UI help copy. */
const PRESET_INFO: Record<string, string> = {
  aggressive:
    'Fastest turnover — the shortest viable horizon: smaller, quicker targets and more trades, accepting a lower win-rate.',
  regular:
    'Best capital efficiency — the horizon with the highest return per holding-day, weighted by how often the order actually fills.',
  conservative:
    'Safest — the horizon whose win-rate most convincingly clears break-even (highest lower bound of its confidence interval).',
}

/** All swept candidates, grouped by scale, so drift and dispersion are comparable.
 * The 3 presets are just picks from this landscape; this shows the rest. */
function CompareTable({ result }: { result: DraftResult }) {
  const groups = [
    { key: 'drift' as const, label: 'Momentum (drift)' },
    { key: 'range' as const, label: 'Dispersion (range)' },
  ].filter((g) => result.candidates.some((c) => c.scale === g.key))

  return (
    <details className={styles.compare}>
      <summary className={styles.compareSummary}>
        Compare all {result.candidates.length} candidates — drift vs dispersion
      </summary>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Pick</th>
              <th>Hold (d)</th>
              <th>TP frac</th>
              <th>Trials</th>
              <th>Win</th>
              <th>Win CI</th>
              <th>Eff/day</th>
              <th>Fill</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const rows = result.candidates
                .filter((c) => c.scale === g.key)
                .sort((a, b) => (b.efficiency ?? -Infinity) - (a.efficiency ?? -Infinity))
              return (
                <Fragment key={g.key}>
                  <tr className={styles.scaleHead}>
                    <td colSpan={8}>{g.label}</td>
                  </tr>
                  {rows.map((c, i) => (
                    <tr key={i} className={c.presetKind ? styles.rowPicked : ''}>
                      <td className={styles.pick} style={{ textAlign: 'left' }}>
                        {c.presetKind ?? (c.confident ? <span className={styles.confDot}>●</span> : '')}
                      </td>
                      <td>{c.timeBarrier}</td>
                      <td>{c.scale === 'range' ? c.targetCoef.toFixed(2) : '—'}</td>
                      <td>{c.nTrials}</td>
                      <td>{pct(c.winRate)}</td>
                      <td>{c.winRateCi ? `${pct(c.winRateCi[0])}–${pct(c.winRateCi[1])}` : '—'}</td>
                      <td>{pctFine(c.expectancyPerDay)}</td>
                      <td>{pct(c.fillRate)}</td>
                    </tr>
                  ))}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className={styles.legend}>
        Rows are sorted by efficiency within each scale; <strong>●</strong> = cleared the
        confidence gate; a named <strong>Pick</strong> is the preset that chose that row.
        <strong> TP frac</strong> is the dispersion fraction (range only).
      </p>
    </details>
  )
}

/**
 * Draft panel shown when an automated strategy is selected in the trade form.
 * Lets the user tweak PLR/side, see the regular/aggressive/conservative presets
 * (with their stats + what each optimizes), and apply one to pre-fill entry/SL/TP.
 * A low-confidence sweep shows its reason.
 */
export const StrategyDraftPanel = observer(function StrategyDraftPanel({
  form,
}: {
  form: UseTradeCreation
}) {
  if (!form.isAutomatedStrategy) return null

  const result = form.draftResult

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>Automated draft — {form.selectedStrategy?.name}</span>
        <label className={styles.control}>
          PLR
          <input
            type="text"
            inputMode="decimal"
            value={form.plrInput}
            onChange={(e) => form.setPlrInput(e.target.value)}
            className={styles.plrInput}
            aria-label="Profit-loss ratio"
          />
        </label>
        <label className={styles.control}>
          Side
          <select
            value={form.draftSide}
            onChange={(e) => form.setDraftSide(e.target.value as 'long' | 'short')}
            aria-label="Trade side"
          >
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
        </label>
        <label
          className={styles.control}
          title={
            'Limit enters on a pullback (buy the dip / sell strength). ' +
            'Stop enters on a breakout in the trade direction (buy higher / sell lower) ' +
            'for trend continuation. The choice reshapes the historical sweep.'
          }
        >
          Entry
          <select
            value={form.draftOrderType}
            onChange={(e) => form.setDraftOrderType(e.target.value as 'limit' | 'stop')}
            aria-label="Entry order type"
          >
            <option value="limit">Limit (pullback)</option>
            <option value="stop">Stop (breakout)</option>
          </select>
        </label>
        <button type="button" className={styles.redraft} onClick={form.runDraft} disabled={form.draftLoading}>
          {form.draftLoading ? 'Computing…' : 'Redraft'}
        </button>
      </div>

      {result?.engineDescription && (
        <p className={styles.blurb}>{result.engineDescription}</p>
      )}

      {form.draftError && <p className={styles.err}>{form.draftError}</p>}

      {!form.draftError && form.draftLoading && !result && (
        <p className={styles.status}>Running historical sweep…</p>
      )}

      {result && !result.confident && (
        <p className={styles.warn}>
          Low confidence: {result.reason ?? 'not enough of an edge to recommend.'}
        </p>
      )}

      {result && result.presets.length > 0 && (
        <>
          <div className={styles.cards}>
            {orderedPresets(result).map((p) => (
              <button
                key={p.kind}
                type="button"
                title={PRESET_INFO[p.kind]}
                className={`${styles.card} ${form.appliedPresetKind === p.kind ? styles.cardActive : ''}`}
                onClick={() => form.applyPreset(p)}
              >
                <span className={styles.kind}>{p.kind}</span>
                <span className={styles.criterion}>{PRESET_INFO[p.kind]}</span>
                <span className={styles.row}>Hold ~{p.d2}d · {p.nTrials} trials</span>
                {p.scale && (
                  <span className={styles.row}>
                    Basis: {p.scale === 'drift' ? 'momentum' : 'dispersion'}
                  </span>
                )}
                <span className={styles.row}>
                  Win {pct(p.winRate)}
                  {p.winRateCi && ` (CI ${pct(p.winRateCi[0])}–${pct(p.winRateCi[1])})`}
                </span>
                <span className={styles.row}>
                  Fill {pct(result.fillRate)} · break-even {pct(result.breakevenWinRate)}
                </span>
                <span className={styles.row}>Eff/day {pctFine(p.expectancyPerDay)}</span>
                <span className={styles.prices}>
                  <span className={styles.pair}>Entry {price(p.entry)}</span>
                  <span className={styles.pair}>TP {price(p.takeProfit)}</span>
                  <span className={styles.pair}>SL {price(p.stopLoss)}</span>
                </span>
              </button>
            ))}
          </div>
          <p className={styles.legend}>
            <strong>Win</strong> = share of filled trades that hit the target before the stop ·{' '}
            <strong>CI</strong> = 90% confidence range (wide = few independent windows) ·{' '}
            <strong>break-even</strong> = win-rate needed just to not lose at this PLR — clear it
            with margin for a real edge · <strong>Eff/day</strong> = expected return per holding-day.
          </p>
        </>
      )}

      {result && result.candidates.length > 0 && <CompareTable result={result} />}
    </div>
  )
})
