/** Currencies supported by the v1 multi-currency UI. */
export const SUPPORTED_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CHF',
  'AUD',
  'CAD',
  'SEK',
] as const

export type SupportedCurrency = typeof SUPPORTED_CURRENCIES[number]
