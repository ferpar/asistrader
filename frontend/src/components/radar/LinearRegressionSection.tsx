import { Fragment } from 'react'
import type { LinearRegressionStructure } from '../../domain/radar/types'
import { annualizedTir } from '../../domain/radar/indicators'
import { HelpTooltip } from '../HelpTooltip'
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

/** Short legend explaining what the TIR bar chart shows. */
const TIR_GUIDE: [string, string][] = [
  ['bars', 'slope %/day × 365 per regression window (20d / 50d / 200d)'],
  ['avg', 'dashed line marks the average across the bars'],
  ['0%', 'baseline — bars grow up for gains, down for losses'],
  ['y-axis', 'fitted to the values, always keeping 0% in view'],
]

/**
 * Linear-regression block shared by the ticker and benchmark radar cards. Emits
 * two sibling sections so they flow (and fold) independently: the per-window
 * slope / slope % / annualized TIR (slope % × 365) / R² figures, and a small bar
 * chart comparing the annualized TIRs.
 */
export function LinearRegressionSection({ linearRegression, fmt }: LinearRegressionSectionProps) {
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
          <span className={styles.tirHeaderLeft}>
            Annualized TIR
            <HelpTooltip ariaLabel="Annualized TIR chart guide">
              <span className={styles.guideHeading}>Annualized TIR</span>
              <span className={styles.guideGrid}>
                {TIR_GUIDE.map(([name, desc]) => (
                  <Fragment key={name}>
                    <span className={styles.guideName}>{name}</span>
                    <span className={styles.guideDesc}>{desc}</span>
                    <span aria-hidden="true" />
                  </Fragment>
                ))}
              </span>
            </HelpTooltip>
          </span>
        </div>
        <TirBarChart
          bars={windows.map(([label, lr]) => ({ label, value: annualizedTir(lr.slopePct) }))}
        />
      </div>
    </>
  )
}
