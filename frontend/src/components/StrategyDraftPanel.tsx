import { observer } from '@legendapp/state/react'
import type { UseTradeCreation } from '../hooks/useTradeCreation'
import { orderedPresets } from '../domain/strategy/draftPresets'
import styles from './StrategyDraftPanel.module.css'

function pct(n: number | null): string {
  return n == null ? '—' : `${(n * 100).toFixed(0)}%`
}

function pctFine(n: number | null): string {
  return n == null ? '—' : `${(n * 100).toFixed(2)}%`
}

/**
 * Draft panel shown when an automated strategy is selected in the trade form.
 * Lets the user tweak PLR/side, see the regular/aggressive/conservative presets
 * (with their stats), and apply one to pre-fill the entry/SL/TP. A low-confidence
 * sweep shows its reason and offers no presets.
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
            type="number"
            step="0.1"
            min="0.1"
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
        <button type="button" className={styles.redraft} onClick={form.runDraft} disabled={form.draftLoading}>
          {form.draftLoading ? 'Computing…' : 'Redraft'}
        </button>
      </div>

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
        <div className={styles.cards}>
          {orderedPresets(result).map((p) => (
            <button
              key={p.kind}
              type="button"
              className={`${styles.card} ${form.appliedPresetKind === p.kind ? styles.cardActive : ''}`}
              onClick={() => form.applyPreset(p)}
            >
              <span className={styles.kind}>{p.kind}</span>
              <span className={styles.row}>Hold ~{p.d2}d · {p.nTrials} trials</span>
              <span className={styles.row}>Win {pct(p.winRate)} · Fill {pct(result.fillRate)}</span>
              <span className={styles.row}>Eff/day {pctFine(p.expectancyPerDay)}</span>
              <span className={styles.prices}>
                {p.entry} · TP {p.takeProfit} · SL {p.stopLoss}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
})
