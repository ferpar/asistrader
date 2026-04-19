import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RadarFilterBar } from '../RadarFilterBar'
import { DEFAULT_VIEW_STATE, type RadarViewState } from '../../../domain/radar/filterSort'

function Harness({
  onChange,
  onReset,
  initial = DEFAULT_VIEW_STATE,
}: {
  onChange?: (v: RadarViewState) => void
  onReset?: () => void
  initial?: RadarViewState
}) {
  const [value, setValue] = useState<RadarViewState>(initial)
  return (
    <RadarFilterBar
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
      onReset={() => {
        setValue(DEFAULT_VIEW_STATE)
        onReset?.()
      }}
    />
  )
}

describe('RadarFilterBar', () => {
  it('updates ticker.structure when a structure pill is clicked', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Bullish' }))
    const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as RadarViewState
    expect(last.ticker.structure).toBe('bullish')
  })

  it('updates trade.status when a status pill is clicked', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as RadarViewState
    expect(last.trade.status).toBe('open')
  })

  it('updates search text', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const search = screen.getByLabelText('Search tickers')
    fireEvent.change(search, { target: { value: 'aapl' } })
    const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as RadarViewState
    expect(last.ticker.search).toBe('aapl')
  })

  it('toggles flat view', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Flat view'))
    const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as RadarViewState
    expect(last.flatView).toBe(true)
  })

  it('enables proximity filter when toggle is checked', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Enable proximity filter'))
    const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as RadarViewState
    expect(last.trade.proximity).not.toBeNull()
    expect(last.trade.proximity?.target).toBe('sl')
    expect(last.trade.proximity?.withinPct).toBe(20)
  })

  it('changes proximity target and percentage', () => {
    const onChange = vi.fn()
    const initial: RadarViewState = {
      ...DEFAULT_VIEW_STATE,
      trade: { ...DEFAULT_VIEW_STATE.trade, proximity: { target: 'sl', withinPct: 20 } },
    }
    render(<Harness onChange={onChange} initial={initial} />)

    fireEvent.change(screen.getByLabelText('Proximity target'), { target: { value: 'tp' } })
    let last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as RadarViewState
    expect(last.trade.proximity?.target).toBe('tp')

    fireEvent.change(screen.getByLabelText('Proximity percentage'), { target: { value: '5' } })
    last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as RadarViewState
    expect(last.trade.proximity?.withinPct).toBe(5)
  })

  it('changes sort key and applies its default direction', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'biggestWinner' } })
    const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as RadarViewState
    expect(last.sort).toEqual({ key: 'biggestWinner', dir: 'desc' })
  })

  it('toggles sort direction', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Toggle sort direction'))
    const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as RadarViewState
    expect(last.sort.dir).toBe('desc')
  })

  it('fires onReset when Reset is clicked', () => {
    const onReset = vi.fn()
    render(<Harness onReset={onReset} />)
    fireEvent.click(screen.getByRole('button', { name: /reset/i }))
    expect(onReset).toHaveBeenCalledTimes(1)
  })
})
