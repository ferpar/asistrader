import { useState } from 'react'
import { observer } from '@legendapp/state/react'
import { useFundStore } from '../../container/ContainerContext'
import styles from './Portfolio.module.css'

/** Listing countries offered as Home Market (ISO-2 → name). */
const MARKETS: Record<string, string> = {
  ES: 'Spain',
  US: 'United States',
  GB: 'United Kingdom',
  DE: 'Germany',
  FR: 'France',
  NL: 'Netherlands',
  IT: 'Italy',
  PT: 'Portugal',
  CH: 'Switzerland',
  IE: 'Ireland',
  BE: 'Belgium',
  SE: 'Sweden',
  DK: 'Denmark',
  NO: 'Norway',
  FI: 'Finland',
  CA: 'Canada',
  JP: 'Japan',
}

/**
 * The user's Home Market: stocks listed there are Domestic Stock, any other
 * stock International Stock. A per-user setting; `onChanged` lets the page
 * reload the figures it classifies.
 */
export const HomeMarketSelect = observer(function HomeMarketSelect({
  onChanged,
}: {
  onChanged: () => Promise<void>
}) {
  const fundStore = useFundStore()
  const homeMarket = fundStore.homeMarket$.get()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const options = homeMarket in MARKETS ? MARKETS : { ...MARKETS, [homeMarket]: homeMarket }

  const change = async (value: string) => {
    setSaving(true)
    setError(null)
    try {
      await fundStore.updateHomeMarket(value)
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update Home Market')
    } finally {
      setSaving(false)
    }
  }

  return (
    <label
      className={styles.homeMarket}
      title="Stocks listed in your Home Market are Domestic Stock; other stocks are International Stock"
    >
      Home Market
      <select value={homeMarket} disabled={saving} onChange={(e) => change(e.target.value)}>
        {Object.entries(options).map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </select>
      {error && <span className={styles.error}>{error}</span>}
    </label>
  )
})
