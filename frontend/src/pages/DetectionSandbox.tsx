import { useEffect, useState, useRef } from 'react'
import { observer } from '@legendapp/state/react'
import { useTradeRepo, useTradeStore } from '../container/ContainerContext'
import { DetectionTraceTable } from '../components/DetectionTraceTable'
import type {
  DetectionTraceOverrides,
  DetectionTraceResult,
  TradeWithMetrics,
} from '../domain/trade/types'
import styles from './DetectionSandbox.module.css'

/**
 * Interactive what-if sandbox: pick a trade, tweak SL/TP/entry/dates/margin,
 * see how the detection date and verdict change in real time. Read-only on
 * the backend — every refresh is `GET /trades/{id}/detection-trace` with the
 * overrides as query params; the trade row is never modified.
 */
export const DetectionSandbox = observer(function DetectionSandbox() {
  const repo = useTradeRepo()
  const tradeStore = useTradeStore()
  const trades = tradeStore.trades$.get()

  useEffect(() => {
    if (trades.length === 0) tradeStore.loadTrades()
  }, [tradeStore, trades.length])

  const [tradeId, setTradeId] = useState<number | null>(null)
  const [overrides, setOverrides] = useState<Form>({})
  const [result, setResult] = useState<DetectionTraceResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  // Trade-picker filters. Default to the two statuses the detector actually
  // produces hits for (OPEN, ORDERED); other statuses are reachable via the
  // status chips for trace inspection but hidden by default to cut noise.
  const [statusFilter, setStatusFilter] = useState<Set<string>>(
    () => new Set(['open', 'ordered']),
  )
  const [idQuery, setIdQuery] = useState('')

  const filteredTrades = trades.filter(t => {
    if (!statusFilter.has(t.status)) return false
    if (idQuery) {
      const q = idQuery.trim()
      if (q && !String(t.id).includes(q) && !String(t.number ?? '').includes(q)) {
        return false
      }
    }
    return true
  })

  // Keep the currently-selected trade visible in the dropdown even if it
  // falls outside the active filter, so the user doesn't get a phantom
  // "no selection" state when narrowing filters.
  const dropdownTrades = (() => {
    if (tradeId === null) return filteredTrades
    if (filteredTrades.some(t => t.id === tradeId)) return filteredTrades
    const selected = trades.find(t => t.id === tradeId)
    return selected ? [selected, ...filteredTrades] : filteredTrades
  })()

  // Debounce the fetch so typing in number inputs doesn't fire a request on
  // every keystroke. 300ms feels responsive without being chatty.
  const debounceRef = useRef<number | null>(null)
  useEffect(() => {
    if (tradeId === null) {
      setResult(null)
      return
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    setPending(true)
    debounceRef.current = window.setTimeout(() => {
      const overridesPayload = toOverrides(overrides)
      repo.fetchDetectionTrace(tradeId, overridesPayload).then(
        r => { setResult(r); setError(null); setPending(false) },
        e => { setError(e instanceof Error ? e.message : String(e)); setPending(false) },
      )
    }, 300)
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
    }
  }, [repo, tradeId, overrides])

  const selected = tradeId !== null ? trades.find(t => t.id === tradeId) : null
  const hasOverrides = Object.keys(toOverrides(overrides)).length > 0

  return (
    <div className={styles.page}>
      <h2>Detection sandbox</h2>
      <p className={styles.help}>
        Pick a trade and see exactly which bars the detector evaluated. Use the
        what-if fields to ask "would this still alert if SL were 92?" without
        touching the database.
      </p>

      <div className={styles.controls}>
        <div className={styles.pickerRow}>
          <label className={styles.field}>
            <span>Trade</span>
            <select
              value={tradeId ?? ''}
              onChange={e => setTradeId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">— pick a trade ({filteredTrades.length}) —</option>
              {dropdownTrades.map(t => (
                <option key={t.id} value={t.id}>
                  {tradeLabel(t)}
                </option>
              ))}
            </select>
          </label>

          <div className={styles.statusChips}>
            <span className={styles.fieldLabel}>Status</span>
            {(['open', 'ordered', 'plan', 'close', 'canceled'] as const).map(s => {
              const active = statusFilter.has(s)
              return (
                <button
                  key={s}
                  type="button"
                  className={`${styles.chip} ${active ? styles.chipActive : ''}`}
                  onClick={() => {
                    const next = new Set(statusFilter)
                    if (active) next.delete(s); else next.add(s)
                    setStatusFilter(next)
                  }}
                >
                  {s}
                </button>
              )
            })}
          </div>

          <label className={styles.field}>
            <span>Filter by # or id</span>
            <input
              type="search"
              placeholder="e.g. 42"
              value={idQuery}
              onChange={e => setIdQuery(e.target.value)}
            />
          </label>
        </div>

        <div className={styles.overrides}>
          <NumField label="SL" value={overrides.sl}
                    onChange={v => setOverrides({ ...overrides, sl: v })} />
          <NumField label="TP" value={overrides.tp}
                    onChange={v => setOverrides({ ...overrides, tp: v })} />
          <NumField label="Entry" value={overrides.entry}
                    onChange={v => setOverrides({ ...overrides, entry: v })} />
          <DateField label="Opened" value={overrides.opened}
                     onChange={v => setOverrides({ ...overrides, opened: v })} />
          <DateField label="Planned" value={overrides.planned}
                     onChange={v => setOverrides({ ...overrides, planned: v })} />
          <NumField label="Margin" value={overrides.margin} step="0.0001"
                    onChange={v => setOverrides({ ...overrides, margin: v })} />
          {hasOverrides && (
            <button className={styles.clearBtn} onClick={() => setOverrides({})}>
              Clear overrides
            </button>
          )}
        </div>
      </div>

      {tradeId === null && (
        <div className={styles.empty}>Pick a trade to see its detection trace.</div>
      )}

      {tradeId !== null && error && (
        <div className={styles.error}>Error: {error}</div>
      )}

      {tradeId !== null && !error && (
        <div className={styles.results}>
          {hasOverrides && (
            <div className={styles.whatIfBanner}>
              What-if mode — overrides are not persisted.
            </div>
          )}
          {selected && (
            <div className={styles.summary}>
              <span><strong>Ticker:</strong> {selected.ticker}</span>
              <span><strong>Status:</strong> {selected.status}</span>
              {result && <span><strong>Detector:</strong> {result.detectorKind}</span>}
              {result && <span><strong>Side:</strong> {result.trace.side}</span>}
              {result && (
                <span><strong>Margin:</strong> {result.trace.margin.toString()}</span>
              )}
              {result?.trace.scanFrom && (
                <span>
                  <strong>Scan:</strong> {result.trace.scanFrom} → {result.trace.scanTo}
                  {' '}({result.trace.barsScanned} bars)
                </span>
              )}
              {pending && <span className={styles.pending}>refreshing…</span>}
            </div>
          )}
          {result && <DetectionTraceTable trace={result.trace} />}
          {result && <div className={styles.verdict}>{result.trace.verdict}</div>}
        </div>
      )}
    </div>
  )
})

interface Form {
  sl?: string
  tp?: string
  entry?: string
  opened?: string
  planned?: string
  margin?: string
}

function toOverrides(form: Form): DetectionTraceOverrides {
  const out: DetectionTraceOverrides = {}
  if (form.sl) out.sl = Number(form.sl)
  if (form.tp) out.tp = Number(form.tp)
  if (form.entry) out.entry = Number(form.entry)
  if (form.opened) out.opened = form.opened
  if (form.planned) out.planned = form.planned
  if (form.margin) out.margin = Number(form.margin)
  return out
}

function tradeLabel(t: TradeWithMetrics): string {
  const n = t.number !== null ? `#${t.number}` : `id ${t.id}`
  return `${n}  ${t.ticker}  ${t.status}`
}

function NumField({ label, value, onChange, step = 'any' }: {
  label: string
  value: string | undefined
  onChange: (v: string | undefined) => void
  step?: string
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={value ?? ''}
        onChange={e => onChange(e.target.value || undefined)}
      />
    </label>
  )
}

function DateField({ label, value, onChange }: {
  label: string
  value: string | undefined
  onChange: (v: string | undefined) => void
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input
        type="date"
        value={value ?? ''}
        onChange={e => onChange(e.target.value || undefined)}
      />
    </label>
  )
}
