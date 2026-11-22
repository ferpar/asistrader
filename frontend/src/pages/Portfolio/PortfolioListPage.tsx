import { useEffect, useState, type FormEvent } from 'react'
import { observer } from '@legendapp/state/react'
import { useFundStore, usePortfolioStore, useRouterStore } from '../../container/ContainerContext'
import styles from './Portfolio.module.css'

/** The user's Portfolios, with a form to create one. */
export const PortfolioListPage = observer(function PortfolioListPage() {
  const store = usePortfolioStore()
  const fundStore = useFundStore()
  const router = useRouterStore()
  const baseCurrency = fundStore.baseCurrency$.get()

  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    store.loadPortfolios()
  }, [store])

  const portfolios = store.portfolios$.get()
  const loading = store.loading$.get()
  const error = store.error$.get()

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setFormError(null)
    try {
      const created = await store.createPortfolio(name.trim(), (currency || baseCurrency).toUpperCase())
      setName('')
      setCurrency('')
      router.navigate(`/portfolio/portfolios/${created.id}`)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create Portfolio')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <h2>Portfolios</h2>
      </header>

      <form className={styles.inlineForm} onSubmit={handleCreate}>
        <input
          aria-label="Portfolio name"
          placeholder="New Portfolio name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          aria-label="Currency"
          className={styles.currencyInput}
          placeholder={baseCurrency}
          maxLength={3}
          value={currency}
          onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          title="Fixed after creation"
        />
        <button type="submit" className={styles.primary} disabled={saving || !name.trim()}>
          Create
        </button>
      </form>
      <p className={styles.hint}>The currency can't be changed after the Portfolio is created.</p>
      {formError && <p className={styles.error}>{formError}</p>}

      {error && <p className={styles.error}>{error}</p>}
      {loading && portfolios.length === 0 ? (
        <p className={styles.empty}>Loading…</p>
      ) : portfolios.length === 0 ? (
        <p className={styles.empty}>No Portfolios yet.</p>
      ) : (
        <ul className={styles.cardList}>
          {portfolios.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className={styles.card}
                onClick={() => router.navigate(`/portfolio/portfolios/${p.id}`)}
              >
                <span className={styles.cardName}>{p.name}</span>
                <span className={styles.muted}>{p.currency}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
})
