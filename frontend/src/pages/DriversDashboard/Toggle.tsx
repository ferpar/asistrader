import styles from './Toggle.module.css'

/** Segmented button row, used for the scope and daily view switches. */
export function Toggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
}) {
  return (
    <div className={styles.toggle}>
      {options.map((o) => (
        <button
          key={o.id}
          className={`${styles.toggleBtn} ${value === o.id ? styles.toggleBtnActive : ''}`}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
