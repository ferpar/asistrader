import { describe, it, expect } from 'vitest'
import { Decimal } from '../Decimal'

describe('Decimal', () => {
  describe('construction', () => {
    it('constructs from number', () => {
      const d = new Decimal(42)
      expect(d.toNumber()).toBe(42)
    })

    it('constructs from string', () => {
      const d = new Decimal('3.14')
      expect(d.toNumber()).toBe(3.14)
    })

    it('constructs from Decimal', () => {
      const a = new Decimal(99)
      const b = new Decimal(a)
      expect(b.toNumber()).toBe(99)
    })

    it('static from()', () => {
      expect(Decimal.from(5).toNumber()).toBe(5)
      expect(Decimal.from('2.5').toNumber()).toBe(2.5)
      expect(Decimal.from(Decimal.from(7)).toNumber()).toBe(7)
    })

    it('static zero()', () => {
      expect(Decimal.zero().toNumber()).toBe(0)
      expect(Decimal.zero().isZero()).toBe(true)
    })
  })

  describe('arithmetic', () => {
    it('plus', () => {
      expect(Decimal.from(1).plus(Decimal.from(2)).toNumber()).toBe(3)
    })

    it('minus', () => {
      expect(Decimal.from(5).minus(Decimal.from(3)).toNumber()).toBe(2)
    })

    it('times', () => {
      expect(Decimal.from(4).times(Decimal.from(3)).toNumber()).toBe(12)
    })

    it('div', () => {
      expect(Decimal.from(10).div(Decimal.from(4)).toNumber()).toBe(2.5)
    })

    it('abs', () => {
      expect(Decimal.from(-5).abs().toNumber()).toBe(5)
      expect(Decimal.from(5).abs().toNumber()).toBe(5)
    })

    it('neg', () => {
      expect(Decimal.from(5).neg().toNumber()).toBe(-5)
      expect(Decimal.from(-3).neg().toNumber()).toBe(3)
    })

    it('sqrt', () => {
      expect(Decimal.from(9).sqrt().toNumber()).toBe(3)
    })

    it('pow', () => {
      expect(Decimal.from(2).pow(3).toNumber()).toBe(8)
    })

    it('handles 0.1 + 0.2 = 0.3 precisely', () => {
      const result = Decimal.from(0.1).plus(Decimal.from(0.2))
      expect(result.eq(Decimal.from(0.3))).toBe(true)
      expect(result.toNumber()).toBe(0.3)
    })

    it('returns new instance (immutable)', () => {
      const a = Decimal.from(5)
      const b = a.plus(Decimal.from(1))
      expect(a.toNumber()).toBe(5)
      expect(b.toNumber()).toBe(6)
    })
  })

  describe('comparisons', () => {
    it('eq', () => {
      expect(Decimal.from(5).eq(Decimal.from(5))).toBe(true)
      expect(Decimal.from(5).eq(Decimal.from(4))).toBe(false)
    })

    it('gt / gte', () => {
      expect(Decimal.from(5).gt(Decimal.from(4))).toBe(true)
      expect(Decimal.from(5).gt(Decimal.from(5))).toBe(false)
      expect(Decimal.from(5).gte(Decimal.from(5))).toBe(true)
    })

    it('lt / lte', () => {
      expect(Decimal.from(3).lt(Decimal.from(4))).toBe(true)
      expect(Decimal.from(3).lt(Decimal.from(3))).toBe(false)
      expect(Decimal.from(3).lte(Decimal.from(3))).toBe(true)
    })

    it('isZero', () => {
      expect(Decimal.from(0).isZero()).toBe(true)
      expect(Decimal.from(1).isZero()).toBe(false)
    })

    it('isPositive / isNegative', () => {
      expect(Decimal.from(5).isPositive()).toBe(true)
      expect(Decimal.from(-5).isPositive()).toBe(false)
      expect(Decimal.from(-5).isNegative()).toBe(true)
      expect(Decimal.from(5).isNegative()).toBe(false)
      expect(Decimal.from(0).isPositive()).toBe(false)
      expect(Decimal.from(0).isNegative()).toBe(false)
    })
  })

  describe('conversions', () => {
    it('toNumber', () => {
      expect(Decimal.from(3.14).toNumber()).toBe(3.14)
    })

    it('toFixed', () => {
      expect(Decimal.from(3.14159).toFixed(2)).toBe('3.14')
      expect(Decimal.from(3).toFixed(2)).toBe('3.00')
    })

    it('toString', () => {
      expect(Decimal.from(42).toString()).toBe('42')
      expect(Decimal.from('3.14').toString()).toBe('3.14')
    })
  })

  describe('edge cases', () => {
    it('zero arithmetic', () => {
      expect(Decimal.zero().plus(Decimal.from(5)).toNumber()).toBe(5)
      expect(Decimal.from(5).minus(Decimal.from(5)).isZero()).toBe(true)
      expect(Decimal.zero().times(Decimal.from(100)).isZero()).toBe(true)
    })

    it('negative results', () => {
      expect(Decimal.from(3).minus(Decimal.from(5)).toNumber()).toBe(-2)
      expect(Decimal.from(3).minus(Decimal.from(5)).isNegative()).toBe(true)
    })
  })
})
