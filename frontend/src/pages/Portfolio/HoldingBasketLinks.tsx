import type { MouseEvent } from 'react'
import { useRouterStore } from '../../container/ContainerContext'
import type { HoldingBasket } from '../../domain/portfolio/types'
import type { Path } from '../../domain/router/RouterStore'
import styles from './Portfolio.module.css'

/**
 * The visible Baskets a Holding belongs to, each a link to its Basket detail
 * page. Real anchors, so a modified click still opens a new tab; a plain
 * click navigates in-app.
 */
export function HoldingBasketLinks({ baskets }: { baskets: HoldingBasket[] }) {
  const router = useRouterStore()
  if (baskets.length === 0) return <span className={styles.muted}>—</span>

  const open = (event: MouseEvent<HTMLAnchorElement>, path: Path) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    router.navigate(path)
  }

  return (
    <span className={styles.basketLinks}>
      {baskets.map((b) => {
        const path: Path = `/portfolio/baskets/${b.id}`
        return (
          <a
            key={b.id}
            href={path}
            className={styles.basketLink}
            title={b.kind === 'curated' ? 'Curated Basket' : 'Personal Basket'}
            onClick={(e) => open(e, path)}
          >
            {b.name}
          </a>
        )
      })}
    </span>
  )
}
