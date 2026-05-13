import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PriceInput } from '../PriceInput'

function Harness({
  priceHint,
  onChange,
  onBlur,
  initial = '',
  name = 'price',
}: {
  priceHint: number | null | undefined
  onChange?: (value: string) => void
  onBlur?: () => void
  initial?: string
  name?: string
}) {
  const [value, setValue] = useState(initial)
  return (
    <PriceInput
      name={name}
      value={value}
      priceHint={priceHint}
      onChange={(e) => {
        setValue(e.target.value)
        onChange?.(e.target.value)
      }}
      onBlur={onBlur}
      placeholder="price"
    />
  )
}

describe('PriceInput', () => {
  it('uses type=text to avoid locale-aware number parsing', () => {
    render(<Harness priceHint={2} />)
    expect(screen.getByPlaceholderText('price')).toHaveAttribute('type', 'text')
  })

  it('sets inputmode=decimal for mobile numeric keypad', () => {
    render(<Harness priceHint={2} />)
    expect(screen.getByPlaceholderText('price')).toHaveAttribute('inputmode', 'decimal')
  })

  it('emits dot-decimal unchanged', () => {
    const onChange = vi.fn()
    render(<Harness priceHint={4} onChange={onChange} />)
    const input = screen.getByPlaceholderText('price')
    fireEvent.change(input, { target: { value: '1.154' } })
    expect(onChange).toHaveBeenLastCalledWith('1.154')
  })

  it('normalizes comma decimal to dot (Spanish-typed value)', () => {
    const onChange = vi.fn()
    render(<Harness priceHint={4} onChange={onChange} />)
    const input = screen.getByPlaceholderText('price')
    fireEvent.change(input, { target: { value: '1,154' } })
    expect(onChange).toHaveBeenLastCalledWith('1.154')
  })

  it('strips English thousand separators when both separators appear', () => {
    const onChange = vi.fn()
    render(<Harness priceHint={2} onChange={onChange} />)
    const input = screen.getByPlaceholderText('price')
    fireEvent.change(input, { target: { value: '1,234.56' } })
    expect(onChange).toHaveBeenLastCalledWith('1234.56')
  })

  it('strips Spanish thousand separators when both separators appear', () => {
    const onChange = vi.fn()
    render(<Harness priceHint={2} onChange={onChange} />)
    const input = screen.getByPlaceholderText('price')
    fireEvent.change(input, { target: { value: '1.234,56' } })
    expect(onChange).toHaveBeenLastCalledWith('1234.56')
  })

  it('strips junk characters', () => {
    const onChange = vi.fn()
    render(<Harness priceHint={2} onChange={onChange} />)
    const input = screen.getByPlaceholderText('price')
    fireEvent.change(input, { target: { value: ' €1.50 ' } })
    expect(onChange).toHaveBeenLastCalledWith('1.50')
  })

  it('snaps display to canonical dot form on blur', () => {
    render(<Harness priceHint={2} />)
    const input = screen.getByPlaceholderText('price') as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '1,50' } })
    fireEvent.blur(input)
    expect(input.value).toBe('1.50')
  })

  it('shows precision hint while focused with excess decimals', () => {
    render(<Harness priceHint={2} initial="123.4567" />)
    const input = screen.getByPlaceholderText('price')
    fireEvent.focus(input)
    expect(screen.getByText(/Will round to 2 decimals/)).toBeInTheDocument()
  })

  it('hides precision hint when not focused', () => {
    render(<Harness priceHint={2} initial="123.4567" />)
    expect(screen.queryByText(/Will round/)).not.toBeInTheDocument()
  })

  it('does not show hint when value fits priceHint', () => {
    render(<Harness priceHint={2} initial="123.45" />)
    const input = screen.getByPlaceholderText('price')
    fireEvent.focus(input)
    expect(screen.queryByText(/Will round/)).not.toBeInTheDocument()
  })

  it('rounds value on blur when decimals exceed priceHint', () => {
    const onChange = vi.fn()
    render(<Harness priceHint={2} initial="123.4567" onChange={onChange} />)
    const input = screen.getByPlaceholderText('price') as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.blur(input)
    expect(onChange).toHaveBeenLastCalledWith('123.46')
    expect(input.value).toBe('123.46')
  })

  it('does not modify empty value on blur', () => {
    const onChange = vi.fn()
    render(<Harness priceHint={2} initial="" onChange={onChange} />)
    const input = screen.getByPlaceholderText('price')
    fireEvent.focus(input)
    fireEvent.blur(input)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('leaves value untouched if it already fits priceHint', () => {
    const onChange = vi.fn()
    render(<Harness priceHint={2} initial="10.50" onChange={onChange} />)
    const input = screen.getByPlaceholderText('price')
    fireEvent.focus(input)
    fireEvent.blur(input)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('still fires onBlur after rounding', () => {
    const onBlur = vi.fn()
    render(<Harness priceHint={2} initial="1.234" onBlur={onBlur} />)
    const input = screen.getByPlaceholderText('price')
    fireEvent.focus(input)
    fireEvent.blur(input)
    expect(onBlur).toHaveBeenCalledTimes(1)
  })
})
