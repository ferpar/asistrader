import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PasswordInput } from '../PasswordInput'

function setUp(props: Parameters<typeof PasswordInput>[0] = {}) {
  render(<label>Password<PasswordInput value="secret" onChange={() => {}} {...props} /></label>)
  return screen.getByDisplayValue('secret')
}

describe('PasswordInput', () => {
  it('hides the text by default', () => {
    expect(setUp()).toHaveAttribute('type', 'password')
  })

  it('toggles between showing and hiding the text', () => {
    const input = setUp()

    fireEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(input).toHaveAttribute('type', 'text')

    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(input).toHaveAttribute('type', 'password')
  })

  it('does not submit the surrounding form', () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
    render(<form onSubmit={onSubmit}><PasswordInput value="" onChange={() => {}} /></form>)

    fireEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('disables the toggle along with the input', () => {
    setUp({ disabled: true })
    expect(screen.getByRole('button', { name: 'Show password' })).toBeDisabled()
  })
})
