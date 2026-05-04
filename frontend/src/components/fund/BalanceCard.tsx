import { observer } from '@legendapp/state/react'
import { useFundStore } from '../../container/ContainerContext'
import skeletonStyles from '../../styles/skeleton.module.css'
import styles from './BalanceCard.module.css'

const SkeletonValue = () => (
  <span className={skeletonStyles.skeleton} style={{ minWidth: '6em' }}>&nbsp;</span>
)

export const BalanceCard = observer(function BalanceCard() {
  const store = useFundStore()
  const balance = store.balance$.get()
  const computing = store.balanceComputing$.get()

  const baseCurrency = balance?.baseCurrency ?? store.baseCurrency$.get()

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: baseCurrency }).format(value)

  const formatPercent = (value: number) =>
    new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)

  // Show skeleton on every recompute (per agreed UX) and on the very first
  // load before balance$ has any value at all.
  const showSkeleton = computing || balance === null

  const renderValue = (value: number) =>
    showSkeleton ? <SkeletonValue /> : formatCurrency(value)

  return (
    <div className={styles.card}>
      <div className={styles.item}>
        <span className={styles.label}>Equity</span>
        <span className={styles.value}>{renderValue(balance?.equity.toNumber() ?? 0)}</span>
      </div>
      <div className={styles.item}>
        <span className={styles.label}>Committed</span>
        <span className={styles.value}>{renderValue(balance?.committed.toNumber() ?? 0)}</span>
      </div>
      <div className={styles.item}>
        <span className={styles.label}>Available</span>
        <span
          className={`${styles.value} ${
            !showSkeleton && balance && balance.available.isNegative() ? styles.negative : ''
          }`}
        >
          {renderValue(balance?.available.toNumber() ?? 0)}
        </span>
      </div>
      <div className={styles.item}>
        <span className={styles.label}>Max per Trade</span>
        <span className={styles.value}>{renderValue(balance?.maxPerTrade.toNumber() ?? 0)}</span>
      </div>
      <div className={styles.item}>
        <span className={styles.label}>Risk %</span>
        <span className={styles.value}>
          {showSkeleton ? <SkeletonValue /> : formatPercent(balance?.riskPct.toNumber() ?? 0)}
        </span>
      </div>
    </div>
  )
})
