import styles from './Tabs.module.css'

/** Underline-style tab strip for switching between sibling views of the same
 *  data. Same API as Toggle — use this when the choice swaps content panels
 *  rather than filtering the same panel. */
export function Tabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
}) {
  return (
    <div className={styles.tabs} role="tablist">
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={value === o.id}
          className={`${styles.tab} ${value === o.id ? styles.tabActive : ''}`}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
