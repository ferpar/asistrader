import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TradeCreationForm } from '../src/components/TradeCreationForm'
import { ContainerProvider } from '../src/container/ContainerContext'

function renderForm() {
  return render(
    <ContainerProvider>
      <TradeCreationForm onClose={() => {}} />
    </ContainerProvider>,
  )
}

describe('TradeCreationForm order type', () => {
  it('defaults the order type to limit', async () => {
    renderForm()
    // The dropdowns only render once the (failing, networkless) ticker load settles.
    const orderType = (await screen.findByLabelText('Order Type')) as HTMLSelectElement
    expect(orderType.value).toBe('limit')
  })

  it('does not offer a "None" order type option', async () => {
    renderForm()
    const orderType = (await screen.findByLabelText('Order Type')) as HTMLSelectElement
    const optionValues = Array.from(orderType.options).map((o) => o.value)
    expect(optionValues).toEqual(['limit', 'stop', 'market'])
    expect(optionValues).not.toContain('')
  })
})
