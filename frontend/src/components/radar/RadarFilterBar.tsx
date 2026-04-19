import {
  DEFAULT_VIEW_STATE,
  SORT_KEY_LABELS,
  SORT_KEY_DEFAULT_DIR,
  type RadarViewState,
  type TickerScope,
  type TradeScope,
  type StructureCategory,
  type TrendSignFilter,
  type ActivityFilter,
  type TradeStatusFilter,
  type PnlSignFilter,
  type DriftFilter,
  type ProximityTarget,
  type SortKey,
  type SortDir,
} from '../../domain/radar/filterSort'
import styles from './RadarFilterBar.module.css'

interface RadarFilterBarProps {
  value: RadarViewState
  onChange: (next: RadarViewState) => void
  onReset: () => void
}

interface PillGroupProps<T extends string> {
  label: string
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}

function PillGroup<T extends string>({ label, options, value, onChange }: PillGroupProps<T>) {
  return (
    <div className={styles.group}>
      <span className={styles.groupLabel}>{label}</span>
      <div className={styles.pills}>
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`${styles.pill} ${value === opt.value ? styles.active : ''}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

const STRUCTURE_OPTIONS: readonly { value: StructureCategory; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'bullish', label: 'Bullish' },
  { value: 'bearish', label: 'Bearish' },
  { value: 'mixed', label: 'Mixed' },
]

const TREND_OPTIONS: readonly { value: TrendSignFilter; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'up', label: 'Up' },
  { value: 'down', label: 'Down' },
]

const ACTIVITY_OPTIONS: readonly { value: ActivityFilter; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'hasOpen', label: 'Has open' },
  { value: 'hasPlan', label: 'Has plan' },
  { value: 'hasActive', label: 'Has active' },
  { value: 'hasNone', label: 'No active' },
]

const STATUS_OPTIONS: readonly { value: TradeStatusFilter; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'plan', label: 'Plan' },
  { value: 'ordered', label: 'Ordered' },
  { value: 'open', label: 'Open' },
]

const PNL_OPTIONS: readonly { value: PnlSignFilter; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'winning', label: 'Winning' },
  { value: 'losing', label: 'Losing' },
]

const DRIFT_OPTIONS: readonly { value: DriftFilter; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'ahead', label: 'Ahead' },
  { value: 'behind', label: 'Behind' },
  { value: 'on-pace', label: 'On pace' },
]

const SORT_KEYS: readonly SortKey[] = [
  'symbol',
  'activeCount',
  'lrSlope50',
  'closestToSL',
  'closestToTP',
  'closestToPE',
  'biggestWinner',
  'biggestLoser',
  'worstDriftToTP',
  'oldestOpenAge',
  'oldestPlanAge',
]

export function RadarFilterBar({ value, onChange, onReset }: RadarFilterBarProps) {
  const patchTicker = (patch: Partial<TickerScope>) =>
    onChange({ ...value, ticker: { ...value.ticker, ...patch } })
  const patchTrade = (patch: Partial<TradeScope>) =>
    onChange({ ...value, trade: { ...value.trade, ...patch } })

  const proximity = value.trade.proximity
  const proximityTarget: ProximityTarget = proximity?.target ?? 'sl'
  const proximityPct = proximity?.withinPct ?? 20

  return (
    <div className={styles.bar} data-testid="radar-filter-bar">
      <div className={styles.scopeRow}>
        <span className={styles.scopeLabel}>Ticker</span>
        <input
          type="search"
          className={styles.search}
          placeholder="Search symbol or name"
          value={value.ticker.search}
          onChange={(e) => patchTicker({ search: e.target.value })}
          aria-label="Search tickers"
        />
        <PillGroup
          label="Structure"
          options={STRUCTURE_OPTIONS}
          value={value.ticker.structure}
          onChange={(structure) => patchTicker({ structure })}
        />
        <PillGroup
          label="Trend (50d)"
          options={TREND_OPTIONS}
          value={value.ticker.trendSign}
          onChange={(trendSign) => patchTicker({ trendSign })}
        />
        <PillGroup
          label="Activity"
          options={ACTIVITY_OPTIONS}
          value={value.ticker.activity}
          onChange={(activity) => patchTicker({ activity })}
        />
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={value.ticker.hideErrored}
            onChange={(e) => patchTicker({ hideErrored: e.target.checked })}
          />
          Hide errored
        </label>
      </div>

      <hr className={styles.divider} />

      <div className={styles.scopeRow}>
        <span className={styles.scopeLabel}>Trade</span>
        <PillGroup
          label="Status"
          options={STATUS_OPTIONS}
          value={value.trade.status}
          onChange={(status) => patchTrade({ status })}
        />
        <PillGroup
          label="PnL"
          options={PNL_OPTIONS}
          value={value.trade.pnlSign}
          onChange={(pnlSign) => patchTrade({ pnlSign })}
        />
        <PillGroup
          label="Drift"
          options={DRIFT_OPTIONS}
          value={value.trade.drift}
          onChange={(drift) => patchTrade({ drift })}
        />
        <div className={styles.group}>
          <span className={styles.groupLabel}>Proximity</span>
          <div className={styles.proximity}>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={proximity !== null}
                onChange={(e) =>
                  patchTrade({
                    proximity: e.target.checked
                      ? { target: proximityTarget, withinPct: proximityPct }
                      : null,
                  })
                }
                aria-label="Enable proximity filter"
              />
              on
            </label>
            <select
              className={styles.proximitySelect}
              value={proximityTarget}
              disabled={proximity === null}
              onChange={(e) =>
                proximity &&
                patchTrade({ proximity: { ...proximity, target: e.target.value as ProximityTarget } })
              }
              aria-label="Proximity target"
            >
              <option value="sl">SL</option>
              <option value="tp">TP</option>
              <option value="pe">PE</option>
            </select>
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              className={styles.proximityInput}
              value={proximityPct}
              disabled={proximity === null}
              onChange={(e) => {
                const pct = Number(e.target.value)
                if (proximity && Number.isFinite(pct)) {
                  patchTrade({ proximity: { ...proximity, withinPct: pct } })
                }
              }}
              aria-label="Proximity percentage"
            />
            <span className={styles.groupLabel}>%</span>
          </div>
        </div>

        <div className={styles.sortArea}>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={value.flatView}
              onChange={(e) => onChange({ ...value, flatView: e.target.checked })}
            />
            Flat view
          </label>
          <span className={styles.groupLabel}>Sort</span>
          <select
            className={styles.sortSelect}
            value={value.sort.key}
            onChange={(e) => {
              const key = e.target.value as SortKey
              onChange({ ...value, sort: { key, dir: SORT_KEY_DEFAULT_DIR[key] } })
            }}
            aria-label="Sort by"
          >
            {SORT_KEYS.map((key) => (
              <option key={key} value={key}>
                {SORT_KEY_LABELS[key]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={styles.dirBtn}
            onClick={() =>
              onChange({
                ...value,
                sort: { ...value.sort, dir: value.sort.dir === 'asc' ? 'desc' : 'asc' },
              })
            }
            aria-label="Toggle sort direction"
          >
            {value.sort.dir === 'asc' ? '↑ asc' : '↓ desc'}
          </button>
          <button
            type="button"
            className={styles.resetBtn}
            onClick={onReset}
            aria-label="Reset filters"
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  )
}

export { DEFAULT_VIEW_STATE }
export type { SortDir }
