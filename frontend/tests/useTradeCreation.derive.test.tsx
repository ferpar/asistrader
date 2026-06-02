import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// Mock the DI container so we control the current price the hook fetches.
const CURRENT_PRICE = 100
vi.mock('../src/container/ContainerContext', () => ({
  useTradeStore: () => ({ createTrade: vi.fn() }),
  useStrategyRepo: () => ({ fetchStrategies: async () => [] }),
  useTickerStore: () => ({
    loadTickers: async () => {},
    tickers$: { get: () => [{ symbol: 'AAA', currency: 'USD', priceHint: 2 }] },
    fetchTickerPrice: async () => ({ valid: true, price: CURRENT_PRICE, currency: 'USD' }),
  }),
  useFundStore: () => ({
    balance$: { get: () => null },
    baseCurrency$: { get: () => 'USD' },
  }),
  useFxStore: () => ({
    ensureLoaded: () => {},
    loading$: { get: () => false },
    loaded$: { get: () => true },
    convert: (d: unknown) => d,
  }),
}))

import { useTradeCreation } from '../src/hooks/useTradeCreation'

function change(result: { current: ReturnType<typeof useTradeCreation> }, name: string, value: string) {
  act(() => {
    result.current.handleChange({ target: { name, value } } as never)
  })
}

describe('useTradeCreation order-type derivation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('auto-derives stop for a long entry above the current price', async () => {
    const { result } = renderHook(() => useTradeCreation())
    await waitFor(() => expect(result.current.currentPrice).toBe(CURRENT_PRICE))

    // Long (SL below entry), entry above current -> must rise -> stop.
    change(result, 'entry_price', '110')
    change(result, 'stop_loss', '100')

    await waitFor(() => expect(result.current.formData.order_type).toBe('stop'))
    expect(result.current.direction).toBe('long')
    expect(result.current.orderTypeAutoDerived).toBe(true)
  })

  it('auto-derives limit for a long entry below the current price', async () => {
    const { result } = renderHook(() => useTradeCreation())
    await waitFor(() => expect(result.current.currentPrice).toBe(CURRENT_PRICE))

    change(result, 'entry_price', '90')
    change(result, 'stop_loss', '80')

    await waitFor(() => expect(result.current.formData.order_type).toBe('limit'))
  })

  it('stops deriving once the user picks a type, and warns it would auto-settle', async () => {
    const { result } = renderHook(() => useTradeCreation())
    await waitFor(() => expect(result.current.currentPrice).toBe(CURRENT_PRICE))

    change(result, 'entry_price', '110') // long, would derive 'stop'
    change(result, 'stop_loss', '100')
    await waitFor(() => expect(result.current.formData.order_type).toBe('stop'))

    // Manually override to limit — a long limit above current fills immediately.
    change(result, 'order_type', 'limit')

    await waitFor(() => expect(result.current.formData.order_type).toBe('limit'))
    expect(result.current.orderTypeAutoDerived).toBe(false)
    expect(result.current.autoSettleWarning).toMatch(/fill immediately/)
    expect(result.current.submitWarnings.some((w) => /Place it anyway/.test(w))).toBe(true)
  })

  it('resumes deriving after a ticker change', async () => {
    const { result } = renderHook(() => useTradeCreation())
    await waitFor(() => expect(result.current.currentPrice).toBe(CURRENT_PRICE))

    change(result, 'entry_price', '110')
    change(result, 'stop_loss', '100')
    await waitFor(() => expect(result.current.formData.order_type).toBe('stop'))
    change(result, 'order_type', 'limit')
    expect(result.current.orderTypeAutoDerived).toBe(false)

    act(() => result.current.selectTicker('AAA'))
    expect(result.current.orderTypeAutoDerived).toBe(true)
    await waitFor(() => expect(result.current.formData.order_type).toBe('stop'))
  })
})
