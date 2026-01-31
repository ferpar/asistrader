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
        entryAlerts: [{ tradeId: 1, ticker: 'AAPL', hitType: 'entry' as const, hitDate: '2025-01-15', entryPrice: Decimal.from(150), paperTrade: true, autoOpened: true, message: 'auto opened' }],
        sltpAlerts: [{ tradeId: 2, ticker: 'MSFT', hitType: 'sl' as const, hitDate: '2025-01-15', hitPrice: Decimal.from(140), paperTrade: true, autoClosed: true, message: 'auto closed' }],
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
    it('dismisses entry alert by trade id', async () => {
      const store = createStore()
      store.entryAlerts$.set([
        { tradeId: 1, ticker: 'AAPL', hitType: 'entry', hitDate: '2025-01-15', entryPrice: Decimal.from(150), paperTrade: false, autoOpened: false, message: 'hit' },
        { tradeId: 2, ticker: 'MSFT', hitType: 'entry', hitDate: '2025-01-15', entryPrice: Decimal.from(300), paperTrade: false, autoOpened: false, message: 'hit' },
      ])

      store.dismissEntryAlert(1)

      expect(store.entryAlerts$.get()).toHaveLength(1)
      expect(store.entryAlerts$.get()[0].tradeId).toBe(2)
    })

    it('dismisses sltp alert by trade id', async () => {
      const store = createStore()
      store.sltpAlerts$.set([
        { tradeId: 1, ticker: 'AAPL', hitType: 'sl', hitDate: '2025-01-15', hitPrice: Decimal.from(140), paperTrade: false, autoClosed: false, message: 'hit' },
      ])

      store.dismissSltpAlert(1)

      expect(store.sltpAlerts$.get()).toHaveLength(0)
    })

    it('dismisses all alerts', async () => {
      const store = createStore()
      store.entryAlerts$.set([
        { tradeId: 1, ticker: 'AAPL', hitType: 'entry', hitDate: '2025-01-15', entryPrice: Decimal.from(150), paperTrade: false, autoOpened: false, message: 'hit' },
      ])
      store.sltpAlerts$.set([
        { tradeId: 2, ticker: 'MSFT', hitType: 'sl', hitDate: '2025-01-15', hitPrice: Decimal.from(140), paperTrade: false, autoClosed: false, message: 'hit' },
      ])
      store.lastDetectionResult$.set({ autoOpenedCount: 1, autoClosedCount: 0, partialCloseCount: 0, conflictCount: 0 })

      store.dismissAllAlerts()

      expect(store.entryAlerts$.get()).toHaveLength(0)
      expect(store.sltpAlerts$.get()).toHaveLength(0)
      expect(store.lastDetectionResult$.get()).toBeNull()
    })
  })
})
