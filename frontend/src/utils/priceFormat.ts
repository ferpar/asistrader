export function formatPrice(
  value: number,
  currency: string | null | undefined,
  priceHint: number | null | undefined,
): string {
  const digits = priceHint ?? 2

  // GBp (British pence) isn't a valid ISO currency for Intl.NumberFormat.
  if (currency === 'GBp' || currency === 'GBX') {
    return `${value.toFixed(digits)} GBp`
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency ?? 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}
