import { observer } from '@legendapp/state/react'
import { useFundStore } from '../../container/ContainerContext'
import styles from './BalanceCard.module.css'

export const BalanceCard = observer(function BalanceCard() {
  const store = useFundStore()
  const balance = store.balance$.get()

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: balance.baseCurrency }).format(value)

  const formatPercent = (value: number) =>
    new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)

  return (
    <div className={styles.card}>
      <div className={styles.item}>
        <span className={styles.label}>Equity</span>
        <span className={styles.value}>{formatCurrency(balance.equity.toNumber())}</span>
      </div>
      <div className={styles.item}>
        <span className={styles.label}>Committed</span>
        <span className={styles.value}>{formatCurrency(balance.committed.toNumber())}</span>
      </div>
      <div className={styles.item}>
        <span className={styles.label}>Available</span>
        <span className={`${styles.value} ${balance.available.isNegative() ? styles.negative : ''}`}>
          {formatCurrency(balance.available.toNumber())}
        </span>
      </div>
      <div className={styles.item}>
        <span className={styles.label}>Max per Trade</span>
        <span className={styles.value}>{formatCurrency(balance.maxPerTrade.toNumber())}</span>
      </div>
      <div className={styles.item}>
        <span className={styles.label}>Risk %</span>
        <span className={styles.value}>{formatPercent(balance.riskPct.toNumber())}</span>
      </div>
    </div>
  )
})
