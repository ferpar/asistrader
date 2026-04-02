import { useEffect } from 'react'
import { observer } from '@legendapp/state/react'
import { useFundStore } from '../container/ContainerContext'
import { BalanceCard } from '../components/fund/BalanceCard'
import { DepositWithdrawForm } from '../components/fund/DepositWithdrawForm'
import { FundFilters } from '../components/fund/FundFilters'
import { RiskSettings } from '../components/fund/RiskSettings'
import { FundEventTable } from '../components/fund/FundEventTable'

export const FundDashboard = observer(function FundDashboard() {
  const store = useFundStore()
  const error = store.error$.get()

  useEffect(() => {
    store.loadEvents()
    store.loadRiskPct()
  }, [store])

  return (
    <section>
      <h2>Fund Management</h2>
      {error && <div style={{ color: 'var(--color-error)', marginBottom: 16 }}>{error}</div>}
      <BalanceCard />
      <RiskSettings />
      <DepositWithdrawForm />
      <FundFilters />
      <FundEventTable />
    </section>
  )
})
