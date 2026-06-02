import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CollapsibleSection } from '../CollapsibleSection'

describe('CollapsibleSection', () => {
  beforeEach(() => localStorage.clear())

  it('keeps the summary visible while folding the body', () => {
    render(
      <CollapsibleSection title="Realized" persistKey="t1" defaultExpanded={false}
        summary={<div>SUMMARY</div>}>
        <div>BODY</div>
      </CollapsibleSection>,
    )
    // Summary always shown; body absent until first expand.
    expect(screen.getByText('SUMMARY')).toBeTruthy()
    expect(screen.queryByText('BODY')).toBeNull()

    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText('BODY')).toBeTruthy()
    expect(screen.getByText('SUMMARY')).toBeTruthy()
  })

  it('persists the open/closed state across remounts', () => {
    const { unmount } = render(
      <CollapsibleSection title="S" persistKey="t2" defaultExpanded={false}>
        <div>BODY</div>
      </CollapsibleSection>,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('BODY')).toBeTruthy()
    unmount()

    render(
      <CollapsibleSection title="S" persistKey="t2" defaultExpanded={false}>
        <div>BODY</div>
      </CollapsibleSection>,
    )
    // Remembered as expanded.
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('BODY')).toBeTruthy()
  })

  it('shows the row count and disables the toggle when there is no body', () => {
    render(<CollapsibleSection title="Pipeline" persistKey="t3" count={5} summary={<div>CARD</div>} />)
    expect(screen.getByText('5')).toBeTruthy()
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true)
  })
})
