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
  it('derives step from priceHint', () => {
    render(<Harness priceHint={2} />)
    expect(screen.getByPlaceholderText('price')).toHaveAttribute('step', '0.01')
  })

  it('uses fine-grained step for high priceHint', () => {
    render(<Harness priceHint={4} />)
    expect(screen.getByPlaceholderText('price')).toHaveAttribute('step', '0.0001')
  })

  it('falls back to step 0.01 when priceHint is null', () => {
    render(<Harness priceHint={null} />)
    expect(screen.getByPlaceholderText('price')).toHaveAttribute('step', '0.01')
  })

  it('uses step 1 when priceHint is 0', () => {
    render(<Harness priceHint={0} />)
    expect(screen.getByPlaceholderText('price')).toHaveAttribute('step', '1')
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
