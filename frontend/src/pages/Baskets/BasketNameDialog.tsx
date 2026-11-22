import { useState, type FormEvent } from 'react'
import { BasketDialog } from './BasketDialog'
import styles from './BasketDialog.module.css'

interface BasketNameDialogProps {
  title: string
  submitLabel: string
  initialName?: string
  hint?: string
  onSubmit: (name: string) => Promise<void>
  onClose: () => void
}

/** Ask for a Personal Basket name: used to create, rename and copy. */
export function BasketNameDialog({ title, submitLabel, initialName = '', hint, onSubmit, onClose }: BasketNameDialogProps) {
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      await onSubmit(name.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setSaving(false)
    }
  }

  return (
    <BasketDialog title={title} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className={styles.form}>
          <input
            aria-label="Basket name"
            placeholder="Basket name"
            maxLength={100}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {hint && <p className={styles.hint}>{hint}</p>}
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.actions}>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={saving || !name.trim()}>
            {submitLabel}
          </button>
        </div>
      </form>
    </BasketDialog>
  )
}
