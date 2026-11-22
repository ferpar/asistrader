import { useEffect, useState } from 'react'
import { observer } from '@legendapp/state/react'
import { useBasketStore, useRouterStore } from '../../container/ContainerContext'
import { BasketRankingTable } from './BasketRankingTable'
import { BasketNameDialog } from './BasketNameDialog'
import { BasketMembersDialog } from './BasketMembersDialog'
import styles from './Baskets.module.css'

interface BasketsPageProps {
  /** The Basket to show, or null for the Basket ranking. */
  basketId: string | null
}

/** The Baskets ranking, or (placeholder for now) one Basket's detail page. */
export function BasketsPage({ basketId }: BasketsPageProps) {
  if (basketId !== null) {
    return (
      <section>
        <h2>Basket {basketId}</h2>
        <p>Coming soon.</p>
      </section>
    )
  }
  return <BasketRanking />
}

/** Which Basket dialog is open on the ranking page, if any. */
type Dialog =
  | { type: 'create' }
  | { type: 'rename'; id: number; name: string }
  | { type: 'copy'; id: number; name: string }
  | { type: 'members'; id: number }

const BasketRanking = observer(function BasketRanking() {
  const basketStore = useBasketStore()
  const routerStore = useRouterStore()
  const rows = basketStore.rows$.get()
  const loading = basketStore.loading$.get()
  const error = basketStore.error$.get()
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    basketStore.loadRanking()
  }, [basketStore])

  const closeDialog = () => setDialog(null)
  // New Baskets and member changes move the indexes: re-measure.
  const closeAndReload = () => {
    setDialog(null)
    basketStore.loadRanking()
  }

  const handleDelete = async (id: number, name: string) => {
    if (!window.confirm(`Delete the Basket "${name}"? Its tickers stay in AsisTrader.`)) return
    setActionError(null)
    try {
      await basketStore.deleteBasket(id)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete Basket')
    }
  }

  return (
    <section>
      <div className={styles.header}>
        <h2>Baskets</h2>
        {loading && <span className={styles.hint}>Loading…</span>}
        <button type="button" className={styles.newButton} onClick={() => setDialog({ type: 'create' })}>
          New Basket
        </button>
      </div>
      <p className={styles.hint}>
        Each Basket is measured on its equal-weighted Basket Index (adjusted closes, chained from 100), the same way the
        radar measures tickers. Benchmarks are shown for reference.
      </p>
      {error && <p className={styles.error}>{error}</p>}
      {actionError && <p className={styles.error}>{actionError}</p>}
      <BasketRankingTable
        rows={rows}
        onOpen={(id) => routerStore.navigate(`/portfolio/baskets/${id}`)}
        renderActions={(row) =>
          row.kind === 'curated' ? (
            <button type="button" onClick={() => setDialog({ type: 'copy', id: row.id, name: row.name })}>
              Copy
            </button>
          ) : (
            <>
              <button type="button" onClick={() => setDialog({ type: 'members', id: row.id })}>
                Members
              </button>
              <button type="button" onClick={() => setDialog({ type: 'rename', id: row.id, name: row.name })}>
                Rename
              </button>
              <button type="button" className={styles.danger} onClick={() => handleDelete(row.id, row.name)}>
                Delete
              </button>
            </>
          )
        }
      />

      {dialog?.type === 'create' && (
        <BasketNameDialog
          title="New Personal Basket"
          submitLabel="Create"
          hint="Only you can see your Personal Baskets. Add members next."
          onClose={closeDialog}
          onSubmit={async (name) => {
            const basket = await basketStore.createBasket(name)
            setDialog({ type: 'members', id: basket.id })
          }}
        />
      )}
      {dialog?.type === 'rename' && (
        <BasketNameDialog
          title="Rename Basket"
          submitLabel="Rename"
          initialName={dialog.name}
          onClose={closeDialog}
          onSubmit={async (name) => {
            await basketStore.renameBasket(dialog.id, name)
            closeDialog()
          }}
        />
      )}
      {dialog?.type === 'copy' && (
        <BasketNameDialog
          title={`Copy ${dialog.name}`}
          submitLabel="Copy"
          initialName={`${dialog.name} (copy)`}
          hint="Creates a Personal Basket with the same members, which you can then edit."
          onClose={closeDialog}
          onSubmit={async (name) => {
            await basketStore.copyBasket(dialog.id, name)
            closeAndReload()
          }}
        />
      )}
      {dialog?.type === 'members' && <BasketMembersDialog basketId={dialog.id} onClose={closeAndReload} />}
    </section>
  )
})
