import { useMemo, useState } from 'react'
import type { DailyPoint } from '../../domain/irr/types'
import { simpleMovingAverage } from '../../domain/irr/stats'
import {
  MetricTimeSeriesChart,
  type SmaOverlay,
} from '../../components/charts/MetricTimeSeriesChart'
import { TimeSeriesChart } from '../../components/charts/TimeSeriesChart'
import { fmtDaysTick, fmtPctTick } from './format'
import { Toggle } from './Toggle'
import styles from './ThroughTimeChart.module.css'

type Metric = 'tir' | 'returnPct' | 'avgDays' | 'dual'

const METRICS: { id: Metric; label: string }[] = [
  { id: 'tir', label: 'TIR' },
  { id: 'returnPct', label: 'Return %' },
  { id: 'avgDays', label: 'Avg days' },
  { id: 'dual', label: 'TIR & Days' },
]

const SMA_A_COLOR = 'var(--color-success, #1a7f37)'
const SMA_B_COLOR = '#d97706' // amber — no warning token in the theme

interface MetricConfig {
  label: string
  caption: string
  pick: (p: DailyPoint) => number
  format: (v: number) => string
}

const CONFIGS: Record<Exclude<Metric, 'dual'>, MetricConfig> = {
  tir: {
    label: 'Daily TIR',
    caption: 'Annualized daily TIR. One point per day a trade closed.',
    pick: (p) => p.tir,
    format: fmtPctTick,
  },
  returnPct: {
    label: 'Daily Return %',
    caption: 'Un-annualized daily return. One point per day a trade closed.',
    pick: (p) => p.returnPct,
    format: fmtPctTick,
  },
  avgDays: {
    label: 'Avg holding days',
    caption: 'Per-day average holding period. One point per day a trade closed.',
    pick: (p) => p.avgHoldingDays,
    format: fmtDaysTick,
  },
}

/**
 * The Drivers "Through time" chart: pick one of three metrics with up to two
 * SMA overlays, or fall back to the original dual-axis TIR + avg-days view.
 * SMA controls are hidden in dual mode — overlaying four lines wouldn't read.
 */
export function ThroughTimeChart({ points }: { points: DailyPoint[] }) {
  const [metric, setMetric] = useState<Metric>('tir')
  const [smaAOn, setSmaAOn] = useState(true)
  const [smaAWindow, setSmaAWindow] = useState(7)
  const [smaBOn, setSmaBOn] = useState(false)
  const [smaBWindow, setSmaBWindow] = useState(30)

  const sorted = useMemo(
    () => [...points].sort((a, b) => a.date.localeCompare(b.date)),
    [points],
  )
  const dates = useMemo(() => sorted.map((p) => p.date), [sorted])

  const singleMetric = metric === 'dual' ? null : CONFIGS[metric]
  const values = useMemo(
    () => (singleMetric ? sorted.map(singleMetric.pick) : []),
    [sorted, singleMetric],
  )

  const smas: SmaOverlay[] = useMemo(() => {
    if (!singleMetric) return []
    const out: SmaOverlay[] = []
    if (smaAOn && smaAWindow >= 2) {
      out.push({
        label: `SMA ${smaAWindow}d`,
        color: SMA_A_COLOR,
        values: simpleMovingAverage(values, smaAWindow),
      })
    }
    if (smaBOn && smaBWindow >= 2) {
      out.push({
        label: `SMA ${smaBWindow}d`,
        color: SMA_B_COLOR,
        values: simpleMovingAverage(values, smaBWindow),
      })
    }
    return out
  }, [singleMetric, values, smaAOn, smaAWindow, smaBOn, smaBWindow])

  // Dual mode reuses the original chart, which expects {date, tir, avgDays}.
  const dualPoints = useMemo(
    () =>
      sorted.map((p) => ({
        date: p.date,
        tir: p.tir,
        avgDays: p.avgHoldingDays,
      })),
    [sorted],
  )

  return (
    <>
      <div className={styles.toolbar}>
        <span className={styles.toolbarGroup}>
          <span className={styles.toolbarLabel}>Metric</span>
          <Toggle options={METRICS} value={metric} onChange={setMetric} />
        </span>
        {singleMetric && (
          <>
            <SmaControl
              label="SMA A"
              color={SMA_A_COLOR}
              enabled={smaAOn}
              setEnabled={setSmaAOn}
              window={smaAWindow}
              setWindow={setSmaAWindow}
            />
            <SmaControl
              label="SMA B"
              color={SMA_B_COLOR}
              enabled={smaBOn}
              setEnabled={setSmaBOn}
              window={smaBWindow}
              setWindow={setSmaBWindow}
            />
          </>
        )}
      </div>

      {singleMetric ? (
        <MetricTimeSeriesChart
          dates={dates}
          values={values}
          valueLabel={singleMetric.label}
          formatValue={singleMetric.format}
          smas={smas}
          title={singleMetric.label}
          caption={singleMetric.caption}
        />
      ) : (
        <TimeSeriesChart
          points={dualPoints}
          title="Daily TIR & average holding days"
          caption="One point per day a trade closed."
        />
      )}
    </>
  )
}

function SmaControl({
  label,
  color,
  enabled,
  setEnabled,
  window,
  setWindow,
}: {
  label: string
  color: string
  enabled: boolean
  setEnabled: (v: boolean) => void
  window: number
  setWindow: (v: number) => void
}) {
  return (
    <label className={styles.toolbarGroup}>
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => setEnabled(e.target.checked)}
      />
      <span className={styles.swatch} style={{ background: color }} />
      <span className={styles.toolbarLabel}>{label}</span>
      <input
        type="number"
        className={styles.windowInput}
        value={window}
        min={2}
        max={365}
        disabled={!enabled}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n) && n >= 2) setWindow(Math.floor(n))
        }}
      />
      <span className={styles.dayUnit}>d</span>
    </label>
  )
}
