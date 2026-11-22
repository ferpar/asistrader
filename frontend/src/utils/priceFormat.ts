/** GBp/GBX: British pence, which Intl.NumberFormat doesn't know as a currency. */
export function isPence(currency: string | null | undefined): boolean {
  return currency === 'GBp' || currency === 'GBX'
}

export function formatPrice(
  value: number,
  currency: string | null | undefined,
  priceHint: number | null | undefined,
): string {
  const digits = priceHint ?? 2

  // GBp (British pence) isn't a valid ISO currency for Intl.NumberFormat.
  if (isPence(currency)) {
    return `${value.toFixed(digits)} GBp`
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency ?? 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}
