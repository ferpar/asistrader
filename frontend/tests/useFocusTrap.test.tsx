import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useFocusTrap } from '../src/hooks/useFocusTrap'

function TrapModal() {
  const ref = useFocusTrap<HTMLDivElement>()
  return (
    <div ref={ref} tabIndex={-1} role="dialog">
      <button>first</button>
      <button>middle</button>
      <button>last</button>
    </div>
  )
}

function Wrapper({ open }: { open: boolean }) {
  return (
    <>
      <button>outside</button>
      {open && <TrapModal />}
    </>
  )
}

describe('useFocusTrap', () => {
  it('moves focus to the first focusable element on mount', () => {
    render(<TrapModal />)
    expect(document.activeElement).toBe(screen.getByText('first'))
  })

  it('wraps focus from last to first on Tab', () => {
    render(<TrapModal />)
    const last = screen.getByText('last')
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByText('first'))
  })

  it('wraps focus from first to last on Shift+Tab', () => {
    render(<TrapModal />)
    const first = screen.getByText('first')
    first.focus()
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(screen.getByText('last'))
  })

  it('restores focus to the opener when unmounted', () => {
    const { rerender } = render(<Wrapper open={false} />)
    const outside = screen.getByText('outside')
    outside.focus()
    expect(document.activeElement).toBe(outside)

    rerender(<Wrapper open={true} />)
    expect(document.activeElement).toBe(screen.getByText('first'))

    rerender(<Wrapper open={false} />)
    expect(document.activeElement).toBe(outside)
  })
})
