import { useMemo } from 'react'
import type { OrderedRow } from './orderedSelectors'
import { NormalParamsChart } from '../../components/charts/NormalParamsChart'
import { fmtDaysTick, fmtPctTick } from './format'
import shared from './shared.module.css'
import styles from './DailyDistributions.module.css'

const MIN_OBS = 3

/**
 * Cumulative μ ± σ for the order book's age and position-%. Each currently-
 * ordered trade contributes one observation, placed at its `dateOrdered`; the
 * chart settles as more orders accumulate, mirroring the daily-IRR pattern.
 */
export function OrderedDistributions({ rows }: { rows: OrderedRow[] }) {
  const ageSeries = useMemo(() => {
    const filtered = rows
      .filter(
        (r): r is OrderedRow & { dateOrdered: Date; orderAgeDays: number } =>
          r.dateOrdered !== null && r.orderAgeDays !== null,
      )
      .sort((a, b) => a.dateOrdered.getTime() - b.dateOrdered.getTime())
    return {
      dates: filtered.map((r) => r.dateOrdered.toISOString().slice(0, 10)),
      values: filtered.map((r) => r.orderAgeDays),
    }
  }, [rows])

  const positionSeries = useMemo(() => {
    const filtered = rows
      .filter(
        (r): r is OrderedRow & { dateOrdered: Date; positionPct: number } =>
          r.dateOrdered !== null && r.positionPct !== null,
      )
      .sort((a, b) => a.dateOrdered.getTime() - b.dateOrdered.getTime())
    return {
      dates: filtered.map((r) => r.dateOrdered.toISOString().slice(0, 10)),
      values: filtered.map((r) => r.positionPct),
    }
  }, [rows])

  const hasAge = ageSeries.values.length >= MIN_OBS
  const hasPosition = positionSeries.values.length >= MIN_OBS

  if (!hasAge && !hasPosition) {
    return (
      <div className={styles.charts}>
        <h4 className={shared.subTitle}>Ordered — fit over time</h4>
        <p className={shared.empty}>
          Need at least {MIN_OBS} orders with an order date to fit a distribution.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.charts}>
      <h4 className={shared.subTitle}>Ordered — fit over time</h4>
      <div className={styles.chartGrid}>
        {hasAge && (
          <NormalParamsChart
            dates={ageSeries.dates}
            values={ageSeries.values}
            title="Order age — cumulative μ ± σ"
            caption="Fit over orders in dateOrdered order. Age is measured today, so the curve shifts each day orders sit."
            formatValue={fmtDaysTick}
          />
        )}
        {hasPosition && (
          <NormalParamsChart
            dates={positionSeries.dates}
            values={positionSeries.values}
            title="Position % — cumulative μ ± σ"
            caption="Fit over orders in dateOrdered order. Positive = current price above PE, negative = below."
            formatValue={fmtPctTick}
          />
        )}
      </div>
    </div>
  )
}
