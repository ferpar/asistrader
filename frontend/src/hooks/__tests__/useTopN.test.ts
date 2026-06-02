import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTopN } from '../useTopN'

const rows = Array.from({ length: 20 }, (_, i) => i)

describe('useTopN', () => {
  it('caps to the limit and reports the hidden count', () => {
    const { result } = renderHook(() => useTopN(rows, 12))
    expect(result.current.visible).toHaveLength(12)
    expect(result.current.canExpand).toBe(true)
    expect(result.current.hidden).toBe(8)
    expect(result.current.total).toBe(20)
  })

  it('expands to the full list and collapses back', () => {
    const { result } = renderHook(() => useTopN(rows, 12))
    act(() => result.current.toggle())
    expect(result.current.visible).toHaveLength(20)
    expect(result.current.hidden).toBe(0)
    act(() => result.current.toggle())
    expect(result.current.visible).toHaveLength(12)
  })

  it('does not offer expansion when rows fit within the limit', () => {
    const { result } = renderHook(() => useTopN(rows.slice(0, 5), 12))
    expect(result.current.visible).toHaveLength(5)
    expect(result.current.canExpand).toBe(false)
  })
})
