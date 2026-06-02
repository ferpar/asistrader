import { useState } from 'react'
import type { DailyPoint, DailyView } from '../../domain/irr/types'
import { CollapsibleSection } from '../../components/CollapsibleSection'
import { DailyDistributions } from './DailyDistributions'
import { DailyTable } from './DailyTable'
import { Toggle } from './Toggle'
import shared from './shared.module.css'

const DAILY_VIEWS: { id: DailyView; label: string }[] = [
  { id: 'mixed', label: 'Mixed' },
  { id: 'winners', label: 'Winners' },
  { id: 'losers', label: 'Losers' },
]

export function DailySection({
  daily,
  ccy,
}: {
  daily: { mixed: DailyPoint[]; winners: DailyPoint[]; losers: DailyPoint[] }
  ccy: string
}) {
  const [view, setView] = useState<DailyView>('mixed')
  const rows = daily[view]
  const showEnhanced = view === 'mixed'

  const body =
    rows.length === 0 ? null : (
      <>
        <p className={shared.note}>
          One point per day a trade closed. The winners / losers / mixed views split
          by trade outcome. <strong>Enhanced</strong> charges each day a share of the
          idle capital pool (ordered + open trades) — shown for the mixed view only.
        </p>
        <DailyTable rows={rows} ccy={ccy} showEnhanced={showEnhanced} />
        <DailyDistributions points={rows} />
      </>
    )

  return (
    <CollapsibleSection
      title="Daily annualized return"
      persistKey="drivers:daily"
      defaultExpanded={false}
      count={rows.length}
      headerExtra={<Toggle options={DAILY_VIEWS} value={view} onChange={setView} />}
      summary={
        rows.length === 0 ? (
          <p className={shared.empty}>No closed trades for this view.</p>
        ) : undefined
      }
    >
      {body}
    </CollapsibleSection>
  )
}
