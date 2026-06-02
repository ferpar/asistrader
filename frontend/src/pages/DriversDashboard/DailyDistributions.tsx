import { useMemo } from 'react'
import type { DailyPoint } from '../../domain/irr/types'
import { Histogram } from '../../components/charts/Histogram'
import { NormalParamsChart } from '../../components/charts/NormalParamsChart'
import { fmtDaysTick, fmtPctTick } from '../../components/portfolio/format'
import { ThroughTimeChart } from './ThroughTimeChart'
import shared from './shared.module.css'
import styles from './DailyDistributions.module.css'

/** Histograms, time series and rolling-normal charts for the daily series. */
export function DailyDistributions({ points }: { points: DailyPoint[] }) {
  const { tirValues, returnValues, dayValues, dates } = useMemo(() => {
    const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date))
    return {
      tirValues: sorted.map((p) => p.tir),
      returnValues: sorted.map((p) => p.returnPct),
      dayValues: sorted.map((p) => p.avgHoldingDays),
      dates: sorted.map((p) => p.date),
    }
  }, [points])

  if (points.length === 0) {
    return <p className={shared.empty}>No closed trades to chart for this view.</p>
  }

  return (
    <div className={styles.charts}>
      <h4 className={shared.subTitle}>Distributions</h4>
      <div className={styles.chartGrid}>
        <Histogram
          values={tirValues}
          title="Daily annualized TIR"
          caption="Frequency of daily TIR, with the fitted normal curve and cumulative %."
          formatValue={fmtPctTick}
        />
        <Histogram
          values={returnValues}
          title="Daily Return %"
          caption="Frequency of the per-day un-annualized return, with the fitted normal curve."
          formatValue={fmtPctTick}
        />
        <Histogram
          values={dayValues}
          title="Daily average holding days"
          caption="Frequency of the per-day average holding period."
          formatValue={fmtDaysTick}
        />
      </div>

      <h4 className={shared.subTitle}>Through time</h4>
      <ThroughTimeChart points={points} />

      <h4 className={shared.subTitle}>Normal-fit parameters by day</h4>
      <div className={styles.chartGrid}>
        <NormalParamsChart
          dates={dates}
          values={tirValues}
          title="TIR — cumulative μ ± σ"
          caption="The normal fit of daily TIR as it stabilizes with each new day."
          formatValue={fmtPctTick}
        />
        <NormalParamsChart
          dates={dates}
          values={returnValues}
          title="Return % — cumulative μ ± σ"
          caption="The normal fit of daily Return % as it stabilizes with each new day."
          formatValue={fmtPctTick}
        />
        <NormalParamsChart
          dates={dates}
          values={dayValues}
          title="Avg days — cumulative μ ± σ"
          caption="The normal fit of daily average holding days over time."
          formatValue={fmtDaysTick}
        />
      </div>
    </div>
  )
}
