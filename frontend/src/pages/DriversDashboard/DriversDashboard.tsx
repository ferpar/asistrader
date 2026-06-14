import { useEffect } from 'react'
import { observer } from '@legendapp/state/react'
import { useIrrStore } from '../../container/ContainerContext'
import { CollapsibleSection } from '../../components/CollapsibleSection'
import { DailySection } from './DailySection'
import { OpenSection } from './OpenSection'
import { OrderedSection } from './OrderedSection'
import { PipelineCard } from './PipelineCard'
import { ScopeSection } from './ScopeSection'
import shared from './shared.module.css'

export const DriversDashboard = observer(function DriversDashboard() {
  const store = useIrrStore()

  useEffect(() => {
    store.loadAnalysis()
  }, [store])

  const analysis = store.analysis$.get()
  const loading = store.loading$.get()
  const error = store.error$.get()

  return (
    <section>
      <h2>Drivers — IRR / TIR Analysis</h2>
      <p className={shared.note}>
        Measures the cash-making drivers of each trade. <strong>TIR</strong> is the
        simple annualized return (return % ÷ holding days × 365);{' '}
        <strong>XIRR</strong> is the true compound rate. The holding period runs from
        the order date (capital committed) to close. Click a column header to sort —
        shift-click to add tie-breaker columns.
      </p>

      {error && <div className={shared.error}>{error}</div>}
      {loading && !analysis && <p className={shared.empty}>Loading analysis…</p>}

      {analysis && (
        <>
          <CollapsibleSection
            title="Pipeline"
            persistKey="drivers:pipeline"
            summary={
              <>
                <p className={shared.note}>
                  Snapshot of how your active trades sit across plan → ordered → open.
                  Open capital is marked at the current price; plan/ordered use the
                  intended investment.
                </p>
                <PipelineCard pipeline={analysis.pipeline} ccy={analysis.baseCurrency} />
              </>
            }
          />

          <ScopeSection
            title="Realized"
            scope={analysis.realized}
            ccy={analysis.baseCurrency}
            openOrders={
              analysis.pipeline.slices.find((s) => s.label === 'Open')?.tradeCount ?? 0
            }
            defaultExpanded={false}
          />
          <ScopeSection
            title="Unrealized"
            scope={analysis.unrealized}
            ccy={analysis.baseCurrency}
            unrealized
            defaultExpanded={false}
          />
          <OpenSection ccy={analysis.baseCurrency} />
          <OrderedSection ccy={analysis.baseCurrency} />
          <DailySection daily={analysis.daily} ccy={analysis.baseCurrency} />
        </>
      )}
    </section>
  )
})
