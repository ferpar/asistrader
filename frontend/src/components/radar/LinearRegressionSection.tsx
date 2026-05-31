import { useState } from 'react'
import type { LinearRegressionStructure } from '../../domain/radar/types'
import { annualizedTir } from '../../domain/radar/indicators'
import { TirBarChart } from '../charts/TirBarChart'
import styles from './RadarTickerCard.module.css'

interface LinearRegressionSectionProps {
  linearRegression: LinearRegressionStructure
  /** Formats an absolute price-space value (currency-aware on ticker cards). */
  fmt: (value: number) => string
}

const formatPercent = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)

const formatR2 = (value: number) => value.toFixed(2)

const formatTir = (value: number) => `${(value * 100).toFixed(1)}% TIR`

/**
 * Linear-regression block shared by the ticker and benchmark radar cards. Emits
 * two sibling sections so they flow (and fold) independently: the per-window
 * slope / slope % / annualized TIR (slope % × 365) / R² figures, and a small bar
 * chart comparing the annualized TIRs.
 */
export function LinearRegressionSection({ linearRegression, fmt }: LinearRegressionSectionProps) {
  const [freeRange, setFreeRange] = useState(true)
  const windows = [
    ['20d', linearRegression.lr20],
    ['50d', linearRegression.lr50],
    ['200d', linearRegression.lr200],
  ] as const

  return (
    <>
      <div className={styles.section}>
        <div className={styles.sectionLabel}>Linear Regression</div>
        <div className={styles.changeGrid}>
          {windows.map(([label, lr]) => {
            const tir = annualizedTir(lr.slopePct)
            return (
              <div key={label} className={styles.changeItem}>
                <span className={styles.changeLabel}>{label}</span>
                <span className={lr.slope !== null && lr.slope >= 0 ? 'positive' : 'negative'}>
                  {lr.slope !== null ? fmt(lr.slope) : '-'}
                </span>
                <span className={lr.slopePct !== null && lr.slopePct >= 0 ? 'positive' : 'negative'}>
                  {lr.slopePct !== null ? formatPercent(lr.slopePct) : '-'}
                </span>
                <span
                  className={tir !== null && tir >= 0 ? 'positive' : 'negative'}
                  title="Annualized TIR = daily regression slope % × 365"
                >
                  {tir !== null ? formatTir(tir) : '-'}
                </span>
                <span>R² {lr.r2 !== null ? formatR2(lr.r2) : '-'}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className={styles.section}>
        <div className={`${styles.sectionLabel} ${styles.tirHeader}`}>
          <span>Annualized TIR</span>
          <button
            type="button"
            className={styles.rangeToggle}
            onClick={() => setFreeRange((v) => !v)}
            title={freeRange ? 'Switch to a fixed −100%…100% range' : 'Switch to a free range fitted to the values (anchored at 0%)'}
          >
            {freeRange ? 'Free range' : '±100%'}
          </button>
        </div>
        <TirBarChart
          bars={windows.map(([label, lr]) => ({ label, value: annualizedTir(lr.slopePct) }))}
          freeRange={freeRange}
        />
      </div>
    </>
  )
}
