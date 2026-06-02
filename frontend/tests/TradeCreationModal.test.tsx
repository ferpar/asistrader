import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { TradeCreationModal } from '../src/components/TradeCreationModal'
import { ContainerProvider } from '../src/container/ContainerContext'

// The container's HTTP repos have no backend in jsdom, so the ticker load
// rejects and settles (loadingTickers -> false) with an empty ticker list.
function renderModal() {
  return render(
    <ContainerProvider>
      <TradeCreationModal onClose={() => {}} />
    </ContainerProvider>,
  )
}

describe('TradeCreationModal', () => {
  it('opens in guided mode with the step list', async () => {
    renderModal()
    // Wizard steps render once the (failing, networkless) load settles.
    expect(await screen.findByText('Instrument')).toBeInTheDocument()
    for (const label of ['Levels', 'Size', 'Review']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('disables Next until an instrument is chosen', async () => {
    renderModal()
    const next = (await screen.findByRole('button', { name: 'Next' })) as HTMLButtonElement
    expect(next.disabled).toBe(true)
  })

  it('switching to advanced reveals the order type, defaulting to limit with no None option', async () => {
    renderModal()
    fireEvent.click(await screen.findByRole('tab', { name: 'Advanced' }))
    const orderType = (await screen.findByLabelText(/Order Type/)) as HTMLSelectElement
    expect(orderType.value).toBe('limit')
    expect(Array.from(orderType.options).map((o) => o.value)).toEqual(['limit', 'stop', 'market'])
  })

  it('shows the preview card in the guided wizard from the first step', async () => {
    renderModal()
    // Preview card is rendered below the steps, visible on every step.
    expect(await screen.findByText('Instrument')).toBeInTheDocument()
    for (const label of ['Amount:', 'Risk:', 'Profit:', 'Ratio:', 'Direction:']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('keeps both mode tabs available in the header', async () => {
    renderModal()
    const header = (await screen.findByRole('tablist'))
    expect(within(header).getByRole('tab', { name: 'Guided' })).toBeInTheDocument()
    expect(within(header).getByRole('tab', { name: 'Advanced' })).toBeInTheDocument()
  })
})
