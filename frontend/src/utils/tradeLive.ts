import type { LiveMetrics } from '../domain/trade/types'

export function getPositionNum(metrics: LiveMetrics | undefined): number | null {
  if (!metrics) return null
  const tp = metrics.distanceToTP?.toNumber() ?? null
  const sl = metrics.distanceToSL?.toNumber() ?? null
  if (tp === null || sl === null) return null
  return tp >= 0 ? tp : -sl
}
