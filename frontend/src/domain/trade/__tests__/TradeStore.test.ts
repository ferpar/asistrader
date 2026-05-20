import { describe, it, expect, vi } from 'vitest'
import { Decimal } from '../../shared/Decimal'
import { TradeStore } from '../TradeStore'
import { createStubTradeRepository } from '../testing/stubs'
import { buildTrade } from '../testing/fixtures'
import type { DetectionResponse } from '../ITradeRepository'

function createStore(overrides?: Parameters<typeof createStubTradeRepository>[0]) {
  return new TradeStore(createStubTradeRepository(overrides))
}

describe('TradeStore', () => {
  describe('loadTrades', () => {
    it('loads trades from repository', async () => {
      const trades = [buildTrade({ id: 1 }), buildTrade({ id: 2, ticker: 'MSFT' })]
      const store = createStore({ fetchTrades: async () => trades })

      await store.loadTrades()

      expect(store.trades$.get()).toEqual(trades)
      expect(store.loading$.get()).toBe(false)
      expect(store.error$.get()).toBeNull()
    })

    it('sets error on fetch failure', async () => {
      const store = createStore({
        fetchTrades: async () => { throw new Error('Network error') },
      })

      await store.loadTrades()

      expect(store.trades$.get()).toEqual([])
      expect(store.error$.get()).toBe('Network error')
      expect(store.loading$.get()).toBe(false)
    })

    it('clears previous error on successful load', async () => {
      let shouldFail = true
      const trades = [buildTrade()]
      const store = createStore({
        fetchTrades: async () => {
          if (shouldFail) throw new Error('fail')
          return trades
        },
      })

      await store.loadTrades()
      expect(store.error$.get()).toBe('fail')

      shouldFail = false
      await store.loadTrades()
      expect(store.error$.get()).toBeNull()
      expect(store.trades$.get()).toEqual(trades)
    })
  })

  describe('filtering', () => {
    const trades = [
      buildTrade({ id: 1, status: 'open', exitType: null }),
      buildTrade({ id: 2, status: 'plan', exitType: null }),
      buildTrade({ id: 3, status: 'close', exitType: 'tp' }),
      buildTrade({ id: 4, status: 'close', exitType: 'sl' }),
      buildTrade({ id: 5, status: 'open', exitType: null }),
    ]

    function storeWithTrades() {
      const store = createStore({ fetchTrades: async () => trades })
      return store
    }

    it('returns all trades by default', async () => {
      const store = storeWithTrades()
      await store.loadTrades()
      expect(store.filteredTrades$.get()).toHaveLength(5)
    })

    it('filters by open', async () => {
      const store = storeWithTrades()
      await store.loadTrades()
      store.setFilter('open')
      expect(store.filteredTrades$.get()).toHaveLength(2)
      expect(store.filteredTrades$.get().every(t => t.status === 'open')).toBe(true)
    })

    it('filters by plan', async () => {
      const store = storeWithTrades()
      await store.loadTrades()
      store.setFilter('plan')
      expect(store.filteredTrades$.get()).toHaveLength(1)
    })

    it('filters by close', async () => {
      const store = storeWithTrades()
      await store.loadTrades()
      store.setFilter('close')
      expect(store.filteredTrades$.get()).toHaveLength(2)
    })

    it('filters winners', async () => {
      const store = storeWithTrades()
      await store.loadTrades()
      store.setFilter('winners')
      const filtered = store.filteredTrades$.get()
      expect(filtered).toHaveLength(1)
      expect(filtered[0].exitType).toBe('tp')
    })

    it('filters losers', async () => {
      const store = storeWithTrades()
      await store.loadTrades()
      store.setFilter('losers')
      const filtered = store.filteredTrades$.get()
      expect(filtered).toHaveLength(1)
      expect(filtered[0].exitType).toBe('sl')
    })
  })

  describe('activeTrades$', () => {
    it('computes active trades (open + plan only)', async () => {
      const trades = [
        buildTrade({ id: 1, status: 'open' }),
        buildTrade({ id: 2, status: 'plan' }),
        buildTrade({ id: 3, status: 'close' }),
      ]
      const store = createStore({ fetchTrades: async () => trades })
      await store.loadTrades()

      const active = store.activeTrades$.get()
      expect(active).toHaveLength(2)
      expect(active.map(t => t.id)).toEqual([1, 2])
    })
  })

  describe('createTrade', () => {
    it('calls repo and reloads', async () => {
      const created = buildTrade({ id: 99 })
      const fetchTrades = vi.fn().mockResolvedValue([created])
      const createTradeFn = vi.fn().mockResolvedValue(created)

      const store = createStore({ fetchTrades, createTrade: createTradeFn })

      await store.createTrade({ ticker: 'AAPL', entry_price: 150, units: 10, date_planned: '2025-01-01' })

      expect(createTradeFn).toHaveBeenCalledOnce()
      expect(fetchTrades).toHaveBeenCalled()
      expect(store.trades$.get()).toEqual([created])
    })
  })

  describe('updateTrade', () => {
    it('calls repo and reloads', async () => {
      const updated = buildTrade({ id: 1, entryPrice: Decimal.from(200) })
      const fetchTrades = vi.fn().mockResolvedValue([updated])
      const updateTradeFn = vi.fn().mockResolvedValue(updated)

      const store = createStore({ fetchTrades, updateTrade: updateTradeFn })

      await store.updateTrade(1, { entry_price: 200 })

      expect(updateTradeFn).toHaveBeenCalledWith(1, { entry_price: 200 })
      expect(fetchTrades).toHaveBeenCalled()
    })
  })

  describe('detectTradeHits', () => {
    it('sets alerts and reloads on auto-actions', async () => {
      const detectionResult: DetectionResponse = {
        entryAlerts: [{ tradeId: 1, ticker: 'AAPL', hitType: 'entry' as const, hitDate: '2025-01-15', entryPrice: Decimal.from(150), autoDetect: true, autoOpened: true, currency: 'USD', priceHint: 2, alertKind: 'entry', levelKey: 'entry', dismissed: false, hitKind: 'intraday', barOpen: null, prevClose: null }],
        sltpAlerts: [{ tradeId: 2, ticker: 'MSFT', hitType: 'sl' as const, hitDate: '2025-01-15', hitPrice: Decimal.from(140), autoDetect: true, autoClosed: true, currency: 'USD', priceHint: 2, alertKind: 'sltp', levelKey: 'sl', dismissed: false, hitKind: 'intraday', barOpen: null, prevClose: null, alsoWouldHaveHit: [] }],
        layeredAlerts: [],
        result: {
          autoOpenedCount: 1,
          autoClosedCount: 1,
          partialCloseCount: 0,
          conflictCount: 0,
        },
      }
      const fetchTrades = vi.fn().mockResolvedValue([])
      const store = createStore({
        fetchTrades,
        detectTradeHits: async () => detectionResult,
      })

      await store.detectTradeHits()

      expect(store.entryAlerts$.get()).toHaveLength(1)
      expect(store.sltpAlerts$.get()).toHaveLength(1)
      expect(store.lastDetectionResult$.get()).toEqual({
        autoOpenedCount: 1,
        autoClosedCount: 1,
        partialCloseCount: 0,
        conflictCount: 0,
      })
      // Should reload because autoOpenedCount > 0
      expect(fetchTrades).toHaveBeenCalled()
    })

    it('does not reload when no auto-actions', async () => {
      const detectionResult: DetectionResponse = {
        entryAlerts: [],
        sltpAlerts: [],
        layeredAlerts: [],
        result: {
          autoOpenedCount: 0,
          autoClosedCount: 0,
          partialCloseCount: 0,
          conflictCount: 0,
        },
      }
      const fetchTrades = vi.fn().mockResolvedValue([])
      const store = createStore({
        fetchTrades,
        detectTradeHits: async () => detectionResult,
      })

      await store.detectTradeHits()

      expect(fetchTrades).not.toHaveBeenCalled()
    })
  })

  describe('dismiss alerts', () => {
    const entryAlert = (tradeId: number) => ({
      tradeId, ticker: 'AAPL', hitType: 'entry' as const, hitDate: '2025-01-15',
      entryPrice: Decimal.from(150), autoDetect: false, autoOpened: false,
      currency: 'USD', priceHint: 2, alertKind: 'entry', levelKey: 'entry', dismissed: false,
      hitKind: 'intraday' as const, barOpen: null, prevClose: null,
    })
    const sltpAlert = (tradeId: number) => ({
      tradeId, ticker: 'MSFT', hitType: 'sl' as const, hitDate: '2025-01-15',
      hitPrice: Decimal.from(140), autoDetect: false, autoClosed: false,
      currency: 'USD', priceHint: 2, alertKind: 'sltp', levelKey: 'sl', dismissed: false,
      hitKind: 'intraday' as const, barOpen: null, prevClose: null, alsoWouldHaveHit: [],
    })

    it('flags an entry alert dismissed and persists it via the repo', async () => {
      const dismissAlert = vi.fn().mockResolvedValue(undefined)
      const store = createStore({ dismissAlert })
      store.entryAlerts$.set([entryAlert(1), entryAlert(2)])

      await store.dismissAlert(store.entryAlerts$.get()[0])

      expect(dismissAlert).toHaveBeenCalledWith({
        tradeId: 1, hitDate: '2025-01-15', alertKind: 'entry', levelKey: 'entry',
      })
      // Both alerts remain in the list; only the matching one is flagged.
      expect(store.entryAlerts$.get().map(a => a.dismissed)).toEqual([true, false])
    })

    it('flags an sltp alert dismissed', async () => {
      const store = createStore()
      store.sltpAlerts$.set([sltpAlert(1)])

      await store.dismissAlert(store.sltpAlerts$.get()[0])

      expect(store.sltpAlerts$.get()[0].dismissed).toBe(true)
    })

    it('restores a dismissed alert and persists it via the repo', async () => {
      const restoreAlert = vi.fn().mockResolvedValue(undefined)
      const store = createStore({ restoreAlert })
      store.sltpAlerts$.set([{ ...sltpAlert(1), dismissed: true }])

      await store.restoreAlert(store.sltpAlerts$.get()[0])

      expect(restoreAlert).toHaveBeenCalledWith({
        tradeId: 1, hitDate: '2025-01-15', alertKind: 'sltp', levelKey: 'sl',
      })
      expect(store.sltpAlerts$.get()[0].dismissed).toBe(false)
    })

    it('dismisses every active alert', async () => {
      const dismissAlert = vi.fn().mockResolvedValue(undefined)
      const store = createStore({ dismissAlert })
      store.entryAlerts$.set([entryAlert(1)])
      store.sltpAlerts$.set([sltpAlert(2)])

      await store.dismissAllAlerts()

      expect(dismissAlert).toHaveBeenCalledTimes(2)
      expect(store.entryAlerts$.get()[0].dismissed).toBe(true)
      expect(store.sltpAlerts$.get()[0].dismissed).toBe(true)
    })
  })
})
