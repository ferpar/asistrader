import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TickerSearchInput } from '../src/components/TickerSearchInput'
import { ContainerProvider } from '../src/container/ContainerContext'

function renderInput(selectedTicker = 'AAPL') {
  return render(
    <ContainerProvider>
      <TickerSearchInput existingTickers={[]} selectedTicker={selectedTicker} onTickerSelect={() => {}} />
    </ContainerProvider>,
  )
}

describe('TickerSearchInput clear-on-focus', () => {
  it('clears the input on focus so the user can type fresh', () => {
    renderInput('AAPL')
    const input = screen.getByPlaceholderText('Search ticker...') as HTMLInputElement
    expect(input.value).toBe('AAPL')
    fireEvent.focus(input)
    expect(input.value).toBe('')
  })

  it('restores the current selection on blur if left empty', () => {
    renderInput('AAPL')
    const input = screen.getByPlaceholderText('Search ticker...') as HTMLInputElement
    fireEvent.focus(input)
    expect(input.value).toBe('')
    fireEvent.blur(input)
    expect(input.value).toBe('AAPL')
  })

  it('keeps a typed query on blur (does not clobber a real search)', () => {
    renderInput('AAPL')
    const input = screen.getByPlaceholderText('Search ticker...') as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'TSL' } })
    fireEvent.blur(input)
    expect(input.value).toBe('TSL')
  })
})
