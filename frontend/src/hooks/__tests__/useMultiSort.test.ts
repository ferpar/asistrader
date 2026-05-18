import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMultiSort, sortRows, type SortTerm } from '../useMultiSort'

type Row = { ticker: string; profit: number; days: number | null }

const ROWS: Row[] = [
  { ticker: 'BBB', profit: 100, days: 10 },
  { ticker: 'AAA', profit: 100, days: 5 },
  { ticker: 'AAA', profit: -50, days: null },
  { ticker: 'CCC', profit: 25, days: 20 },
]

const getValue = (r: Row, key: keyof Row) => r[key]

describe('sortRows', () => {
  it('returns a copy unchanged when there are no sort terms', () => {
    const out = sortRows(ROWS, [], getValue)
    expect(out).toEqual(ROWS)
    expect(out).not.toBe(ROWS)
  })

  it('sorts ascending and descending by a single column', () => {
    const asc = sortRows(ROWS, [{ key: 'profit', dir: 'asc' }], getValue)
    expect(asc.map((r) => r.profit)).toEqual([-50, 25, 100, 100])
    const desc = sortRows(ROWS, [{ key: 'profit', dir: 'desc' }], getValue)
    expect(desc.map((r) => r.profit)).toEqual([100, 100, 25, -50])
  })

  it('applies later terms as tie-breakers', () => {
    const terms: SortTerm<keyof Row>[] = [
      { key: 'profit', dir: 'desc' },
      { key: 'ticker', dir: 'asc' },
    ]
    const out = sortRows(ROWS, terms, getValue)
    // Both 100-profit rows come first, broken by ticker AAA < BBB.
    expect(out.map((r) => r.ticker)).toEqual(['AAA', 'BBB', 'CCC', 'AAA'])
  })

  it('sorts null values last regardless of direction', () => {
    const asc = sortRows(ROWS, [{ key: 'days', dir: 'asc' }], getValue)
    expect(asc[asc.length - 1].days).toBeNull()
    const desc = sortRows(ROWS, [{ key: 'days', dir: 'desc' }], getValue)
    expect(desc[desc.length - 1].days).toBeNull()
  })

  it('is stable for rows equal under every term', () => {
    const out = sortRows(ROWS, [{ key: 'profit', dir: 'desc' }], getValue)
    // The two 100-profit rows keep their original order (BBB before AAA).
    expect(out.slice(0, 2).map((r) => r.ticker)).toEqual(['BBB', 'AAA'])
  })
})

describe('useMultiSort', () => {
  it('cycles a column asc -> desc -> off on plain clicks', () => {
    const { result } = renderHook(() => useMultiSort<keyof Row>())
    act(() => result.current.toggle('profit', false))
    expect(result.current.terms).toEqual([{ key: 'profit', dir: 'asc' }])
    act(() => result.current.toggle('profit', false))
    expect(result.current.terms).toEqual([{ key: 'profit', dir: 'desc' }])
    act(() => result.current.toggle('profit', false))
    expect(result.current.terms).toEqual([])
  })

  it('replaces the sort when a different column is plain-clicked', () => {
    const { result } = renderHook(() =>
      useMultiSort<keyof Row>([{ key: 'profit', dir: 'asc' }]),
    )
    act(() => result.current.toggle('ticker', false))
    expect(result.current.terms).toEqual([{ key: 'ticker', dir: 'asc' }])
  })

  it('shift-click adds tie-breaker columns and exposes their priority', () => {
    const { result } = renderHook(() => useMultiSort<keyof Row>())
    act(() => result.current.toggle('profit', false))
    act(() => result.current.toggle('ticker', true))
    expect(result.current.terms).toEqual([
      { key: 'profit', dir: 'asc' },
      { key: 'ticker', dir: 'asc' },
    ])
    expect(result.current.priorityOf('profit')).toBe(1)
    expect(result.current.priorityOf('ticker')).toBe(2)
    expect(result.current.dirOf('ticker')).toBe('asc')
  })

  it('shift-click cycles a column out of the chain without disturbing the rest', () => {
    const { result } = renderHook(() => useMultiSort<keyof Row>())
    act(() => result.current.toggle('profit', false))
    act(() => result.current.toggle('ticker', true))
    act(() => result.current.toggle('ticker', true)) // asc -> desc
    expect(result.current.dirOf('ticker')).toBe('desc')
    act(() => result.current.toggle('ticker', true)) // desc -> removed
    expect(result.current.terms).toEqual([{ key: 'profit', dir: 'asc' }])
    expect(result.current.priorityOf('ticker')).toBe(0)
  })
})
