/**
 * Single overlay root for all portaled UI (tooltips, modals), kept out of the
 * app's stacking-context races.
 *
 * The root lives AFTER #root in the DOM (see index.html) and is
 * `isolation: isolate`, so its whole subtree forms one stacking context that
 * paints above the app regardless of any app-level z-index. Two sublayers order
 * tooltips above modals — a tooltip opened from within a modal still shows on
 * top.
 *
 * The nodes are declared in index.html for the real app, but we also
 * ensure-create them here so portals work under jsdom (tests) and survive any
 * markup drift. All helpers are idempotent (keyed by id), so they're safe under
 * React StrictMode's double-invocation.
 */
export type OverlayLayer = 'modal' | 'tooltip'

const ROOT_ID = 'overlay-root'

const LAYER_IDS: Record<OverlayLayer, string> = {
  modal: 'overlay-modals',
  tooltip: 'overlay-tooltips',
}

/** Tooltips (2) stack above modals (1) within the isolated overlay root. */
const LAYER_Z: Record<OverlayLayer, number> = {
  modal: 1,
  tooltip: 2,
}

function ensureRoot(): HTMLElement {
  let root = document.getElementById(ROOT_ID)
  if (!root) {
    root = document.createElement('div')
    root.id = ROOT_ID
    root.style.isolation = 'isolate'
    document.body.appendChild(root)
  }
  return root
}

/** The DOM node a portal of `layer` should target. Created on first use. */
export function getOverlayContainer(layer: OverlayLayer): HTMLElement {
  const id = LAYER_IDS[layer]
  let el = document.getElementById(id)
  if (!el) {
    el = document.createElement('div')
    el.id = id
    el.style.position = 'relative'
    el.style.zIndex = String(LAYER_Z[layer])
    ensureRoot().appendChild(el)
  }
  return el
}

// Ensure both layers exist as soon as this module is imported, so render-time
// portal targets are plain lookups (no DOM mutation during render) — and so the
// layers are present under jsdom where index.html markup isn't loaded.
if (typeof document !== 'undefined' && document.body) {
  getOverlayContainer('modal')
  getOverlayContainer('tooltip')
}
