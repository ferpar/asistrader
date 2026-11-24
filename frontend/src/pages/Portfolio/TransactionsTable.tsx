import { useState } from 'react'
import { useTopN } from '../../hooks/useTopN'
import { ShowMore } from '../../components/table/ShowMore'
import type { Portfolio, PortfolioTransaction, TransactionInput } from '../../domain/portfolio/types'
import { TransactionForm } from './TransactionForm'
import { fmtDate, fmtPrice, fmtUnits } from './format'
import styles from './Portfolio.module.css'

/** Rows shown before "Show all", as on the Trades table. */
export const TRANSACTION_ROW_LIMIT = 25

interface TransactionsTableProps {
  portfolio: Portfolio
  /** In date order, oldest first, as the store holds them. */
  transactions: PortfolioTransaction[]
  heldTickers: string[]
  onUpdate: (transactionId: number, input: TransactionInput) => Promise<void>
  onDelete: (transaction: PortfolioTransaction) => void
}

/** The Portfolio's Transactions, newest first, editable in place. Only the
 *  newest {@link TRANSACTION_ROW_LIMIT} are shown until the user asks for all. */
export function TransactionsTable({ portfolio, transactions, heldTickers, onUpdate, onDelete }: TransactionsTableProps) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const newestFirst = [...transactions].reverse()
  const top = useTopN(newestFirst, TRANSACTION_ROW_LIMIT)

  if (transactions.length === 0) return <p className={styles.empty}>No Transactions yet.</p>

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Date</th>
            <th>Kind</th>
            <th>Ticker</th>
            <th className={styles.num}>Units</th>
            <th className={styles.num}>Price</th>
            <th className={styles.num}>Fees</th>
            <th className={styles.num}>FX rate</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {top.visible.map((tx) =>
            editingId === tx.id ? (
              <tr key={tx.id}>
                <td colSpan={8}>
                  <TransactionForm
                    portfolio={portfolio}
                    heldTickers={heldTickers}
                    initial={tx}
                    onSubmit={async (input) => {
                      await onUpdate(tx.id, input)
                      setEditingId(null)
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                </td>
              </tr>
            ) : (
              <tr key={tx.id}>
                <td>{fmtDate(tx.date)}</td>
                <td>{tx.kind}</td>
                <td>{tx.ticker}</td>
                <td className={styles.num}>{fmtUnits(tx.units)}</td>
                <td className={styles.num}>{fmtPrice(tx.price)}</td>
                <td className={styles.num}>{fmtPrice(tx.fees)}</td>
                <td className={styles.num}>{tx.fxRate === null ? 'stored' : fmtPrice(tx.fxRate)}</td>
                <td className={styles.num}>
                  <button
                    type="button"
                    className={`${styles.iconButton} ${styles.editButton}`}
                    aria-label={`Edit Transaction ${tx.id}`}
                    onClick={() => setEditingId(tx.id)}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={`Delete Transaction ${tx.id}`}
                    onClick={() => onDelete(tx)}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
      {top.canExpand && <ShowMore expanded={top.expanded} total={top.total} onToggle={top.toggle} />}
    </div>
  )
}
