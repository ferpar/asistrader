import { useState } from 'react'
import { observer } from '@legendapp/state/react'
import { useFundStore } from '../../container/ContainerContext'
import styles from './RiskSettings.module.css'

export const RiskSettings = observer(function RiskSettings() {
  const store = useFundStore()
  const currentPct = store.riskPct$.get().toNumber()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')

  const handleEdit = () => {
    setValue((currentPct * 100).toFixed(1))
    setEditing(true)
  }

  const handleSave = async () => {
    const pct = parseFloat(value) / 100
    if (pct > 0 && pct <= 100) {
      await store.updateRiskPct(pct)
    }
    setEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave()
    if (e.key === 'Escape') setEditing(false)
  }

  return (
    <div className={styles.settings}>
      <span className={styles.label}>Risk per trade:</span>
      {editing ? (
        <span className={styles.editRow}>
          <input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleSave}
            step="0.1"
            min="0.1"
            max="100"
            className={styles.input}
            autoFocus
          />
          <span className={styles.unit}>%</span>
        </span>
      ) : (
        <button className={styles.valueBtn} onClick={handleEdit}>
          {(currentPct * 100).toFixed(1)}%
        </button>
      )}
    </div>
  )
})
