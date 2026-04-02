import { observer } from '@legendapp/state/react'
import { useFundStore } from '../../container/ContainerContext'
import styles from './FundFilters.module.css'

export const FundFilters = observer(function FundFilters() {
  const store = useFundStore()
  const includePaper = store.includePaper$.get()
  const includeVoided = store.includeVoided$.get()

  return (
    <div className={styles.filters}>
      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={includePaper}
          onChange={(e) => store.setIncludePaper(e.target.checked)}
        />
        Include paper trades
      </label>
      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={includeVoided}
          onChange={(e) => store.setIncludeVoided(e.target.checked)}
        />
        Show voided events
      </label>
    </div>
  )
})
