import { describe, it, expect } from 'vitest'
import { buildAlertMessage } from '../alertMessage'
import { Decimal } from '../../domain/shared/Decimal'
import type { EntryAlert, SLTPAlert, LayeredAlert } from '../../domain/trade/types'

const entry = (over: Partial<EntryAlert> = {}): EntryAlert => ({
  tradeId: 1,
  ticker: 'AAPL',
  hitType: 'entry',
  hitDate: '2025-01-15',
  entryPrice: Decimal.from(150),
  autoDetect: false,
  autoOpened: false,
  currency: 'USD',
  priceHint: 2,
  alertKind: 'entry',
  levelKey: 'entry',
  dismissed: false,
  hitKind: 'intraday',
  barOpen: null,
  prevClose: null,
  ...over,
})

const sltp = (over: Partial<SLTPAlert> = {}): SLTPAlert => ({
  tradeId: 2,
  ticker: 'MSFT',
  hitType: 'sl',
  hitDate: '2025-01-15',
  hitPrice: Decimal.from(140),
  autoDetect: false,
  autoClosed: false,
  currency: 'USD',
  priceHint: 2,
  alertKind: 'sltp',
  levelKey: 'sl',
  dismissed: false,
  hitKind: 'intraday',
  barOpen: null,
  prevClose: null,
  alsoWouldHaveHit: [],
  ...over,
})

const layered = (over: Partial<LayeredAlert> = {}): LayeredAlert => ({
  tradeId: 3,
  ticker: 'VOD.L',
  levelType: 'tp',
  levelIndex: 1,
  hitDate: '2025-01-15',
  hitPrice: Decimal.from(95),
  unitsClosed: 50,
  remainingUnits: 50,
  autoDetect: false,
  autoProcessed: false,
  currency: 'GBp',
  priceHint: 2,
  alertKind: 'layered',
  levelKey: 'tp:1',
  dismissed: false,
  hitKind: 'intraday',
  barOpen: null,
  prevClose: null,
  alsoWouldHaveHit: [],
  ...over,
})

describe('buildAlertMessage', () => {
  describe('entry alerts', () => {
    it('omits price when auto-opened', () => {
      expect(buildAlertMessage(entry({ autoOpened: true }))).toBe(
        'AAPL: Entry hit on 2025-01-15. Trade auto-opened.',
      )
    })

    it('shows the entry price for manual review', () => {
      expect(buildAlertMessage(entry())).toBe(
        'AAPL: Entry hit on 2025-01-15 at $150.00. Review to open.',
      )
    })
  })

  describe('sltp alerts', () => {
    it('labels stop-loss hits', () => {
      expect(buildAlertMessage(sltp())).toBe(
        'MSFT: Stop Loss hit on 2025-01-15 at $140.00. Consider closing manually.',
      )
    })

    it('labels take-profit hits', () => {
      expect(buildAlertMessage(sltp({ hitType: 'tp' }))).toContain('Take Profit hit')
    })

    it('reports auto-closed trades', () => {
      expect(buildAlertMessage(sltp({ autoClosed: true }))).toBe(
        'MSFT: Stop Loss hit on 2025-01-15. Trade auto-closed at $140.00.',
      )
    })

    it('flags same-day SL/TP conflicts without a price', () => {
      expect(buildAlertMessage(sltp({ hitType: 'both' }))).toBe(
        'MSFT: Both SL and TP hit on 2025-01-15. Manual resolution required.',
      )
    })
  })

  describe('layered alerts', () => {
    it('reports a partial close with units and price', () => {
      expect(buildAlertMessage(layered())).toBe(
        'VOD.L: Take Profit 1 hit on 2025-01-15. Closed 50 units at 95.00 GBp.',
      )
    })

    it('reports a full close when no units remain', () => {
      expect(buildAlertMessage(layered({ remainingUnits: 0 }))).toBe(
        'VOD.L: Take Profit 1 hit on 2025-01-15. Trade fully closed.',
      )
    })
  })

  describe('hit kind suffixes', () => {
    it('gap fills include the open and prev close prices', () => {
      const msg = buildAlertMessage(
        sltp({ hitKind: 'gap', hitPrice: Decimal.from(98), barOpen: Decimal.from(98), prevClose: Decimal.from(100) }),
      )
      expect(msg).toContain('(gap from $100.00 to $98.00)')
    })

    it('gap-on-entry hits are flagged with the open price', () => {
      const msg = buildAlertMessage(
        sltp({ hitKind: 'gap_on_entry', hitPrice: Decimal.from(90), barOpen: Decimal.from(90), prevClose: null }),
      )
      expect(msg).toContain('(gap on entry day, open $90.00)')
    })

    it('unverifiable hits say so explicitly', () => {
      const msg = buildAlertMessage(sltp({ hitKind: 'unverifiable' }))
      expect(msg).toContain('unverifiable')
    })

    it('lists also-would-have-hit when the loser was annotated', () => {
      const msg = buildAlertMessage(sltp({ alsoWouldHaveHit: ['tp'] }))
      expect(msg).toContain('TP would have also hit')
    })
  })

  describe('currency formatting', () => {
    it('formats prices in the ticker currency, not always dollars', () => {
      const jpy = buildAlertMessage(
        sltp({ ticker: '7203.T', currency: 'JPY', priceHint: 0, hitPrice: Decimal.from(2500) }),
      )
      expect(jpy).toContain('¥2,500')
      expect(jpy).not.toContain('$')
    })

    it('renders GBp pence with the GBp suffix', () => {
      expect(buildAlertMessage(layered())).toContain('95.00 GBp')
    })
  })
})
