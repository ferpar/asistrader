import styles from './StickyColumns.module.css'

/** The "Dock columns" checkbox that pins a wide table's leading columns while
 *  it scrolls sideways. Hidden on phones, where nothing is pinned. */
export function DockToggle({ docked, onChange }: { docked: boolean; onChange: (docked: boolean) => void }) {
  return (
    <div className={styles.controls}>
      <label className={styles.dockToggle}>
        <input type="checkbox" checked={docked} onChange={(e) => onChange(e.target.checked)} />
        Dock columns
      </label>
    </div>
  )
}
