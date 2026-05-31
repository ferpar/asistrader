import { useMemo, useState } from 'react'
import type { ScopeBlock, TickerView } from '../../domain/irr/types'
import { computeExpectedOrders } from './expectedOrders'
import { PortfolioCard } from './PortfolioCard'
import { Tabs } from './Tabs'
import { TickerTable } from './TickerTable'
import { Toggle } from './Toggle'
import { TransactionTable } from './TransactionTable'
import shared from './shared.module.css'

const TICKER_VIEWS_REALIZED: { id: TickerView; label: string }[] = [
  { id: 'mixed', label: 'Mixed' },
  { id: 'winners', label: 'Winners' },
  { id: 'losers', label: 'Losers' },
]

const TICKER_VIEWS_UNREALIZED: { id: TickerView; label: string }[] = [
  { id: 'mixed', label: 'Mixed' },
  { id: 'winners', label: 'Winning' },
  { id: 'losers', label: 'Losing' },
]

type SubView = 'ticker' | 'transaction'

const SUB_VIEWS: { id: SubView; label: string }[] = [
  { id: 'ticker', label: 'By ticker' },
  { id: 'transaction', label: 'By transaction' },
]

export function ScopeSection({
  title,
  scope,
  ccy,
  unrealized = false,
  openOrders,
}: {
  title: string
  scope: ScopeBlock
  ccy: string
  /** Switches the winners/losers toggle to present-tense Winning/Losing for
   *  open positions, where the outcome isn't locked in. */
  unrealized?: boolean
  /** Current open-position count. When provided, the summary adds expected
   *  orders/day and expected-orders-today KPIs (Realized section only). */
  openOrders?: number
}) {
  const [tickerView, setTickerView] = useState<TickerView>('mixed')
  const [subView, setSubView] = useState<SubView>('ticker')

  const tickerViews = unrealized ? TICKER_VIEWS_UNREALIZED : TICKER_VIEWS_REALIZED
  const winLossNoun = unrealized ? 'Winning / losing' : 'Winners / losers'

  const portfolioGroup =
    tickerView === 'winners'
      ? scope.portfolioWinners
      : tickerView === 'losers'
        ? scope.portfolioLosers
        : scope.portfolio

  const tickerRows =
    tickerView === 'winners'
      ? scope.byTickerWinners
      : tickerView === 'losers'
        ? scope.byTickerLosers
        : scope.byTicker

  const txnRows = useMemo(() => {
    if (tickerView === 'winners') return scope.transactions.filter((t) => t.isWinner)
    if (tickerView === 'losers') return scope.transactions.filter((t) => t.profitNative < 0)
    return scope.transactions
  }, [scope.transactions, tickerView])

  const expectedExtras = useMemo(() => {
    if (openOrders === undefined) return undefined
    const expected = computeExpectedOrders(scope, openOrders, new Date())
    const mode = expected[tickerView]
    return [
      { label: 'Exp. orders/day', value: mode.daily.toFixed(2) },
      {
        label: 'Exp. orders today',
        value: mode.today === null ? '—' : mode.today.toFixed(2),
      },
    ]
  }, [scope, openOrders, tickerView])

  // Toggle only makes sense once there's at least one trade in the scope.
  const showTickerViewToggle = scope.portfolio !== null

  const emptyMessage =
    tickerView === 'winners'
      ? `No ${title.toLowerCase()} ${unrealized ? 'winning' : 'winner'} trades.`
      : tickerView === 'losers'
        ? `No ${title.toLowerCase()} ${unrealized ? 'losing' : 'loser'} trades.`
        : `No ${title.toLowerCase()} trades yet.`

  return (
    <section className={shared.section}>
      <div className={shared.sectionHeader}>
        <h3 className={`${shared.sectionTitle} ${shared.headerTitle}`}>{title}</h3>
        {showTickerViewToggle && (
          <Toggle options={tickerViews} value={tickerView} onChange={setTickerView} />
        )}
      </div>
      {showTickerViewToggle && (
        <p className={shared.note}>
          {winLossNoun} re-aggregate the summary, each ticker and the trade
          list from only the winning or losing trades — so the two sides can be
          read without diluting each other.
        </p>
      )}
      {portfolioGroup ? (
        <PortfolioCard group={portfolioGroup} ccy={ccy} extras={expectedExtras} />
      ) : (
        <p className={shared.empty}>{emptyMessage}</p>
      )}

      {showTickerViewToggle && (
        <>
          <div className={shared.stickyTabs}>
            <Tabs options={SUB_VIEWS} value={subView} onChange={setSubView} />
          </div>
          {subView === 'ticker' ? (
            <TickerTable rows={tickerRows} ccy={ccy} />
          ) : (
            <TransactionTable rows={txnRows} ccy={ccy} />
          )}
        </>
      )}
    </section>
  )
}
