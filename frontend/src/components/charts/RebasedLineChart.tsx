import { useMemo, useState } from 'react'
import { extent, line, scaleLinear, scaleTime, timeFormat } from 'd3'
import { XAxis, YAxis } from './Axes'
import { ChartTooltip, useTooltip } from './ChartTooltip'
import { rebaseToCommonStart, type LevelPoint } from '../../domain/shared/rebase'
import styles from './charts.module.css'

const W = 720
const H = 300
const M = { top: 16, right: 24, bottom: 34, left: 48 }
const fmtTick = timeFormat('%b %y')

/** One level series to draw; the first one is the primary (thicker) line. */
export interface LevelSeries {
  key: string
  label: string
  /** Stroke colour (CSS). Follows the entity, not its position in the list. */
  color: string
  points: LevelPoint[]
}

interface Plotted extends LevelSeries {
  rebased: (LevelPoint & { t: Date })[]
}

/** The series' last point on or before `date` (carried forward over its holidays). */
function valueAt(points: LevelPoint[], date: string): number | null {
  let found: number | null = null
  for (const p of points) {
    if (p.date > date) break
    found = p.value
  }
  return found
}

/**
 * Several level series (an index and the benchmarks it is compared against)
 * rebased to 100 at their common start and drawn on one axis. Hovering shows
 * every series' rebased level on that day.
 */
export function RebasedLineChart({
  series,
  title,
  emptyText = 'No data to chart.',
}: {
  series: LevelSeries[]
  title: string
  emptyText?: string
}) {
  const { tooltip, show, hide } = useTooltip()
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const plotted = useMemo<Plotted[]>(() => {
    const rebased = rebaseToCommonStart(series.map((s) => s.points))
    return series.map((s, i) => ({ ...s, rebased: rebased[i].map((p) => ({ ...p, t: new Date(p.date) })) }))
  }, [series])

  const primary = plotted[0]
  if (!primary || primary.rebased.length === 0) return <p className={styles.empty}>{emptyText}</p>

  const anchors = primary.rebased
  const all = plotted.flatMap((s) => s.rebased)
  const [t0, t1] = extent(all, (d) => d.t) as [Date, Date]
  const x = scaleTime().domain([t0, t1]).range([M.left, W - M.right])
  const values = [100, ...all.map((d) => d.value)]
  const y = scaleLinear()
    .domain([Math.min(...values), Math.max(...values)])
    .nice()
    .range([H - M.bottom, M.top])
  const path = line<{ t: Date; value: number }>()
    .x((d) => x(d.t))
    .y((d) => y(d.value))

  return (
    <figure className={styles.figure}>
      <p className={styles.chartTitle}>{title}</p>
      <p className={styles.chartCaption}>Rebased to 100 on {anchors[0].date}, the first day every series has data.</p>
      <div className={styles.chartFrame}>
        <svg
          className={styles.chart}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`${title}: ${plotted.map((s) => s.label).join(', ')}`}
        >
          <line className={styles.gridLine} x1={M.left} x2={W - M.right} y1={y(100)} y2={y(100)} />
          {hoverIdx !== null && (
            <line
              className={styles.hoverGuide}
              x1={x(anchors[hoverIdx].t)}
              x2={x(anchors[hoverIdx].t)}
              y1={M.top}
              y2={H - M.bottom}
            />
          )}
          {/* Overlays first so the primary line sits on top. */}
          {plotted
            .slice(1)
            .reverse()
            .map((s) => (
              <path key={s.key} d={path(s.rebased) ?? ''} fill="none" stroke={s.color} strokeWidth={1.5} />
            ))}
          <path d={path(primary.rebased) ?? ''} fill="none" stroke={primary.color} strokeWidth={2} />
          {hoverIdx !== null &&
            plotted.map((s) => {
              const v = valueAt(s.rebased, anchors[hoverIdx].date)
              return v === null ? null : (
                <circle
                  key={`dot-${s.key}`}
                  className={styles.dotActive}
                  cx={x(anchors[hoverIdx].t)}
                  cy={y(v)}
                  r={4}
                  fill={s.color}
                />
              )
            })}
          <XAxis scale={x} top={H - M.bottom} ticks={7} format={fmtTick} />
          <YAxis scale={y} left={M.left} ticks={5} format={(v) => (v as number).toFixed(0)} />
          {anchors.map((d, i) => {
            const px = x(d.t)
            const left = i === 0 ? M.left : (x(anchors[i - 1].t) + px) / 2
            const right = i === anchors.length - 1 ? W - M.right : (px + x(anchors[i + 1].t)) / 2
            return (
              <rect
                key={`hit-${d.date}`}
                className={styles.hitArea}
                x={left}
                y={M.top}
                width={Math.max(0, right - left)}
                height={H - M.bottom - M.top}
                onMouseEnter={() => {
                  setHoverIdx(i)
                  show({
                    xPct: (px / W) * 100,
                    yPct: (y(d.value) / H) * 100,
                    title: d.date,
                    rows: plotted
                      .map((s) => ({ s, v: valueAt(s.rebased, d.date) }))
                      .filter((r): r is { s: Plotted; v: number } => r.v !== null)
                      .map(({ s, v }) => ({ label: s.label, value: v.toFixed(1) })),
                  })
                }}
                onMouseLeave={() => {
                  setHoverIdx(null)
                  hide()
                }}
              />
            )
          })}
        </svg>
        <ChartTooltip tooltip={tooltip} />
      </div>
      {plotted.length > 1 && (
        <div className={styles.legend}>
          {plotted.map((s) => (
            <span key={s.key} className={styles.legendItem}>
              <span className={styles.swatch} style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </figure>
  )
}
