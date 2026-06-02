import { describe, it, expect } from 'vitest'
import { getOverlayContainer } from '../overlayLayers'

describe('getOverlayContainer', () => {
  it('returns the modal and tooltip layer nodes by id', () => {
    expect(getOverlayContainer('modal').id).toBe('overlay-modals')
    expect(getOverlayContainer('tooltip').id).toBe('overlay-tooltips')
  })

  it('nests both layers under a single isolated overlay root', () => {
    const root = document.getElementById('overlay-root')!
    expect(root).not.toBeNull()
    expect(root.style.isolation).toBe('isolate')
    expect(getOverlayContainer('modal').parentElement).toBe(root)
    expect(getOverlayContainer('tooltip').parentElement).toBe(root)
  })

  it('orders tooltips above modals', () => {
    const modalZ = Number(getOverlayContainer('modal').style.zIndex)
    const tooltipZ = Number(getOverlayContainer('tooltip').style.zIndex)
    expect(tooltipZ).toBeGreaterThan(modalZ)
  })

  it('is idempotent — repeated calls reuse the same node', () => {
    expect(getOverlayContainer('modal')).toBe(getOverlayContainer('modal'))
    expect(document.querySelectorAll('#overlay-modals').length).toBe(1)
  })
})
