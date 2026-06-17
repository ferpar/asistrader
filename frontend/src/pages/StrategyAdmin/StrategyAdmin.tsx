import { useEffect, useMemo, useState } from 'react'
import { useStrategyRepo } from '../../container/ContainerContext'
import type { Strategy, StrategyEngine, EngineParamField } from '../../domain/strategy/types'
import type { StrategyCreateRequest } from '../../types/strategy'
import styles from './StrategyAdmin.module.css'

type Draft = {
  id: number | null
  name: string
  description: string
  automated: boolean
  peMethod: string
  slMethod: string
  tpMethod: string
  engineId: string
  params: Record<string, unknown>
}

function blankDraft(): Draft {
  return {
    id: null, name: '', description: '', automated: false,
    peMethod: '', slMethod: '', tpMethod: '', engineId: '', params: {},
  }
}

function draftFromStrategy(s: Strategy): Draft {
  const params = s.params ?? {}
  return {
    id: s.id,
    name: s.name,
    description: s.description ?? '',
    automated: s.automated,
    peMethod: s.peMethod ?? '',
    slMethod: s.slMethod ?? '',
    tpMethod: s.tpMethod ?? '',
    engineId: typeof params.engine === 'string' ? params.engine : '',
    params: { ...params },
  }
}

/** One typed input for an engine param, chosen by its declared type. */
function ParamInput({
  field,
  value,
  onChange,
}: {
  field: EngineParamField
  value: unknown
  onChange: (v: unknown) => void
}) {
  if (field.type === 'select') {
    return (
      <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
        {(field.options ?? []).map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    )
  }
  if (field.type === 'int_range') {
    const arr = Array.isArray(value) ? (value as number[]) : (field.default as number[]) ?? [1, 60]
    return (
      <span className={styles.range}>
        <input
          type="number" value={arr[0]}
          onChange={(e) => onChange([parseInt(e.target.value) || 0, arr[1]])}
        />
        <span>–</span>
        <input
          type="number" value={arr[1]}
          onChange={(e) => onChange([arr[0], parseInt(e.target.value) || 0])}
        />
      </span>
    )
  }
  const isInt = field.type === 'int'
  return (
    <input
      type="number"
      step={isInt ? '1' : field.step ?? 'any'}
      min={field.min ?? undefined}
      max={field.max ?? undefined}
      value={value === undefined || value === null ? '' : String(value)}
      onChange={(e) => {
        const n = isInt ? parseInt(e.target.value) : parseFloat(e.target.value)
        onChange(Number.isFinite(n) ? n : e.target.value)
      }}
    />
  )
}

export function StrategyAdmin() {
  const repo = useStrategyRepo()
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [engines, setEngines] = useState<StrategyEngine[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const reload = async () => {
    setStrategies(await repo.fetchStrategies())
  }

  useEffect(() => {
    Promise.all([repo.fetchStrategies(), repo.fetchEngines()])
      .then(([s, e]) => { setStrategies(s); setEngines(e) })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [repo])

  const selectedEngine = useMemo(
    () => engines.find((e) => e.id === draft?.engineId) ?? null,
    [engines, draft?.engineId],
  )

  const startNew = () => { setError(null); setDraft(blankDraft()) }
  const startEdit = (s: Strategy) => { setError(null); setDraft(draftFromStrategy(s)) }

  const pickEngine = (engineId: string) => {
    const engine = engines.find((e) => e.id === engineId)
    const params: Record<string, unknown> = { engine: engineId }
    if (engine) for (const f of engine.fields) params[f.key] = f.default
    setDraft((d) => (d ? { ...d, engineId, params } : d))
  }

  const setParam = (key: string, v: unknown) =>
    setDraft((d) => (d ? { ...d, params: { ...d.params, [key]: v } } : d))

  const save = async () => {
    if (!draft) return
    if (!draft.name.trim()) { setError('Name is required'); return }
    if (draft.automated && !draft.engineId) { setError('Pick an engine for an automated strategy'); return }
    setSaving(true)
    setError(null)
    try {
      const req: StrategyCreateRequest = draft.automated
        ? { name: draft.name.trim(), description: draft.description || undefined, automated: true, params: { ...draft.params, engine: draft.engineId } }
        : {
            name: draft.name.trim(), description: draft.description || undefined, automated: false,
            pe_method: draft.peMethod || undefined, sl_method: draft.slMethod || undefined, tp_method: draft.tpMethod || undefined,
          }
      if (draft.id == null) await repo.createStrategy(req)
      else await repo.updateStrategy(draft.id, req)
      setDraft(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (s: Strategy) => {
    if (!window.confirm(`Delete strategy "${s.name}"?`)) return
    try {
      await repo.deleteStrategy(s.id)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  if (loading) return <div className={styles.page}>Loading strategies…</div>

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h2>Strategies</h2>
        <button className={styles.primary} onClick={startNew}>New strategy</button>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <table className={styles.table}>
        <thead>
          <tr><th>Name</th><th>Type</th><th>Detail</th><th></th></tr>
        </thead>
        <tbody>
          {strategies.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>
                <span className={s.automated ? styles.badgeAuto : styles.badgeManual}>
                  {s.automated ? 'automated' : 'manual'}
                </span>
              </td>
              <td className={styles.detail}>
                {s.automated
                  ? `engine: ${typeof s.params?.engine === 'string' ? s.params.engine : '—'}`
                  : s.description || '—'}
              </td>
              <td className={styles.actions}>
                <button onClick={() => startEdit(s)}>Edit</button>
                <button onClick={() => remove(s)}>Delete</button>
              </td>
            </tr>
          ))}
          {strategies.length === 0 && (
            <tr><td colSpan={4} className={styles.empty}>No strategies yet.</td></tr>
          )}
        </tbody>
      </table>

      {draft && (
        <div className={styles.editor}>
          <h3>{draft.id == null ? 'New strategy' : `Edit “${draft.name}”`}</h3>

          <label className={styles.field}>
            <span>Name</span>
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>

          <label className={styles.field}>
            <span>Type</span>
            <select
              value={draft.automated ? 'automated' : 'manual'}
              onChange={(e) => setDraft({ ...draft, automated: e.target.value === 'automated' })}
            >
              <option value="manual">Manual (your own strategy)</option>
              <option value="automated">Automated (engine-driven)</option>
            </select>
          </label>

          {!draft.automated && (
            <>
              <label className={styles.field}><span>Description</span>
                <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
              <label className={styles.field}><span>Entry method</span>
                <input value={draft.peMethod} onChange={(e) => setDraft({ ...draft, peMethod: e.target.value })} /></label>
              <label className={styles.field}><span>Stop-loss method</span>
                <input value={draft.slMethod} onChange={(e) => setDraft({ ...draft, slMethod: e.target.value })} /></label>
              <label className={styles.field}><span>Take-profit method</span>
                <input value={draft.tpMethod} onChange={(e) => setDraft({ ...draft, tpMethod: e.target.value })} /></label>
            </>
          )}

          {draft.automated && (
            <>
              <label className={styles.field}>
                <span>Engine</span>
                <select value={draft.engineId} onChange={(e) => pickEngine(e.target.value)}>
                  <option value="">— pick an engine —</option>
                  {engines.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
                </select>
              </label>
              {selectedEngine && (
                <>
                  <p className={styles.engineDesc}>{selectedEngine.description}</p>
                  <div className={styles.params}>
                    {selectedEngine.fields.map((f) => (
                      <label key={f.key} className={styles.field} title={f.help ?? undefined}>
                        <span>{f.label}</span>
                        <ParamInput field={f} value={draft.params[f.key]} onChange={(v) => setParam(f.key, v)} />
                      </label>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          <div className={styles.editorActions}>
            <button className={styles.primary} onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
