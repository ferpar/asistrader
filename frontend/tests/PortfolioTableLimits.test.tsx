import { describe, it, expect } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { Decimal } from '../src/domain/shared/Decimal'
import { ContainerProvider } from '../src/container/ContainerContext'
import { buildTickerIndicators } from '../src/domain/radar/indicatorBuild'
import type { Portfolio, PortfolioTransaction } from '../src/domain/portfolio/types'
import type { BasketMember, RankingRow } from '../src/domain/basket/types'
import { TransactionsTable, TRANSACTION_ROW_LIMIT } from '../src/pages/Portfolio/TransactionsTable'
import { BasketRankingTable, RANKING_ROW_LIMIT } from '../src/pages/Baskets/BasketRankingTable'
import { BasketMembersTable, MEMBER_ROW_LIMIT } from '../src/pages/Baskets/BasketMembersTable'

const bodyRows = () => within(screen.getAllByRole('rowgroup')[1]).getAllByRole('row')

const portfolio: Portfolio = {
  id: 1,
  name: 'Core',
  currency: 'EUR',
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
}

/** `count` Buys of T1..Tn on consecutive days, oldest first as the store holds them. */
function transactions(count: number): PortfolioTransaction[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    kind: 'buy' as const,
    date: new Date(Date.UTC(2025, 0, 1 + i)),
    ticker: `T${i + 1}`,
    units: Decimal.from(1),
    price: Decimal.from(10),
    fees: Decimal.from(0),
    fxRate: null,
  }))
}

function renderTransactions(count: number) {
  render(
    <ContainerProvider>
      <TransactionsTable
        portfolio={portfolio}
        transactions={transactions(count)}
        heldTickers={[]}
        onUpdate={async () => {}}
        onDelete={() => {}}
      />
    </ContainerProvider>,
  )
}

describe('Transactions table', () => {
  it('shows only the newest Transactions until "Show all" is pressed', () => {
    renderTransactions(30)

    const rows = bodyRows()
    expect(rows).toHaveLength(TRANSACTION_ROW_LIMIT)
    expect(within(rows[0]).getByText('T30')).toBeInTheDocument()
    expect(screen.queryByText('T5')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show all 30' }))
    expect(bodyRows()).toHaveLength(30)
    expect(screen.getByText('T1')).toBeInTheDocument()
  })

  it('has no "Show all" when every Transaction fits', () => {
    renderTransactions(TRANSACTION_ROW_LIMIT)
    expect(bodyRows()).toHaveLength(TRANSACTION_ROW_LIMIT)
    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument()
  })
})

describe('Basket ranking table', () => {
  it('shows the top rows until "Show all" is pressed', () => {
    const rows: RankingRow[] = Array.from({ length: 30 }, (_, i) => ({
      kind: 'curated',
      id: i + 1,
      name: `Basket ${i + 1}`,
      memberCount: 3,
      indicators: buildTickerIndicators(`B${i + 1}`, [], null),
    }))
    render(<BasketRankingTable rows={rows} onOpen={() => {}} />)

    expect(bodyRows()).toHaveLength(RANKING_ROW_LIMIT)
    fireEvent.click(screen.getByRole('button', { name: 'Show all 30' }))
    expect(bodyRows()).toHaveLength(30)
  })
})

describe('Basket members table', () => {
  it('shows the top members until "Show all" is pressed', () => {
    const members: BasketMember[] = Array.from({ length: 20 }, (_, i) => ({
      symbol: `M${i + 1}`,
      name: null,
      heldIn: [],
    }))
    render(
      <ContainerProvider>
        <BasketMembersTable members={members} onOpenPortfolio={() => {}} />
      </ContainerProvider>,
    )

    expect(bodyRows()).toHaveLength(MEMBER_ROW_LIMIT)
    fireEvent.click(screen.getByRole('button', { name: 'Show all 20' }))
    expect(bodyRows()).toHaveLength(20)
  })
})
