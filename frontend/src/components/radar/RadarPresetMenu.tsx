import { useEffect, useState } from 'react'
import { observer } from '@legendapp/state/react'
import { useRadarStore } from '../../container/ContainerContext'
import { viewMatchesConfig } from '../../domain/radar/filterSort'
import styles from './RadarPresetMenu.module.css'

/**
 * Save / apply / manage named radar view presets.
 *
 * A preset stores only the settings that differ from the radar defaults, so
 * applying one resets every other setting to its current default. Once a
 * preset is applied it has no live link to the view — editing filters marks
 * the selection as "modified" but never mutates the stored preset until the
 * user explicitly updates it.
 */
export const RadarPresetMenu = observer(function RadarPresetMenu() {
  const radar = useRadarStore()
  const presets = radar.presets$.get()
  const error = radar.presetsError$.get()
  const view = radar.view$.get()
  const [activeId, setActiveId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    radar.loadPresets()
  }, [radar])

  const activePreset = presets.find((p) => p.id === activeId) ?? null
  const isDirty = activePreset !== null && !viewMatchesConfig(view, activePreset.config)

  const handleApply = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const id = Number(event.target.value)
    const preset = presets.find((p) => p.id === id)
    if (preset) {
      radar.applyPreset(preset)
      setActiveId(id)
    } else {
      setActiveId(null)
    }
  }

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await action()
    } catch {
      // Error surfaced via radar.presetsError$.
    } finally {
      setBusy(false)
    }
  }

  const handleSave = () => {
    const name = window.prompt('Save current radar view as preset:')?.trim()
    if (!name) return
    run(async () => {
      const preset = await radar.savePreset(name)
      setActiveId(preset.id)
    })
  }

  const handleOverwrite = () => {
    if (!activePreset) return
    if (!window.confirm(`Update "${activePreset.name}" to the current radar view?`)) return
    run(() => radar.overwritePreset(activePreset.id))
  }

  const handleRevert = () => {
    if (activePreset) radar.applyPreset(activePreset)
  }

  const handleRename = () => {
    if (!activePreset) return
    const name = window.prompt('Rename preset:', activePreset.name)?.trim()
    if (!name || name === activePreset.name) return
    run(() => radar.renamePreset(activePreset.id, name))
  }

  const handleDelete = () => {
    if (!activePreset) return
    if (!window.confirm(`Delete preset "${activePreset.name}"?`)) return
    const id = activePreset.id
    run(async () => {
      await radar.deletePreset(id)
      setActiveId(null)
    })
  }

  return (
    <div className={styles.menu} data-testid="radar-preset-menu">
      <span className={styles.label}>Presets</span>
      <select
        className={styles.select}
        value={activeId ?? ''}
        onChange={handleApply}
        disabled={busy}
        aria-label="Apply radar preset"
      >
        <option value="">
          {presets.length === 0 ? 'No saved presets' : 'Select a preset…'}
        </option>
        {presets.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.name}
          </option>
        ))}
      </select>

      {isDirty && (
        <span className={styles.dirty} data-testid="radar-preset-dirty" title="The current view no longer matches this preset">
          ● Modified
        </span>
      )}

      <button type="button" className={styles.btn} onClick={handleSave} disabled={busy}>
        Save as preset…
      </button>

      {activePreset && (
        <>
          {isDirty && (
            <button
              type="button"
              className={styles.btn}
              onClick={handleRevert}
              disabled={busy}
            >
              Revert
            </button>
          )}
          <button
            type="button"
            className={styles.btn}
            onClick={handleOverwrite}
            disabled={busy || !isDirty}
            title={isDirty ? undefined : 'The preset already matches the current view'}
          >
            Update to current view
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={handleRename}
            disabled={busy}
          >
            Rename
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.danger}`}
            onClick={handleDelete}
            disabled={busy}
          >
            Delete
          </button>
        </>
      )}

      {error && <div className={styles.error}>{error}</div>}
    </div>
  )
})
