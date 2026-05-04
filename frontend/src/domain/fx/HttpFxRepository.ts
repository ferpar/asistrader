import { Decimal } from '../shared/Decimal'
import { buildHeaders } from '../shared/httpHelpers'
import { parseDateOnly, toLocalDateIso } from '../../utils/dateOnly'
import type { FxRatesResponseDTO } from '../../types/fx'
import type { IFxRepository } from './IFxRepository'
import type { FxRate } from './types'

export class HttpFxRepository implements IFxRepository {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => string | null,
  ) {}

  async getHistory(
    currencies: string[],
    fromDate?: Date,
    toDate?: Date,
  ): Promise<Record<string, FxRate[]>> {
    const params = new URLSearchParams()
    params.set('currencies', currencies.join(','))
    if (fromDate) params.set('from', toLocalDateIso(fromDate))
    if (toDate) params.set('to', toLocalDateIso(toDate))

    const response = await fetch(`${this.baseUrl}/api/fx/rates?${params}`, {
      headers: buildHeaders(this.getToken),
    })
    if (!response.ok) throw new Error(`Failed to fetch FX rates: ${response.statusText}`)

    const data: FxRatesResponseDTO = await response.json()
    const out: Record<string, FxRate[]> = {}
    for (const [currency, rows] of Object.entries(data.rates)) {
      out[currency] = rows.map((r) => ({
        currency: r.currency,
        date: parseDateOnly(r.date),
        rateToUsd: Decimal.from(r.rate_to_usd),
      }))
    }
    return out
  }
}
