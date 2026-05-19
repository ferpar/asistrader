import { useMemo, useState } from 'react'
import { useTradeStore } from '../container/ContainerContext'
import type { AnyAlert, EntryAlert, SLTPAlert, LayeredAlert } from '../domain/trade/types'

export type AlertSortMode = 'date' | 'ticker'

/** Stable identity for an alert, used for React keys and sorting tiebreaks. */
export function alertKey(alert: AnyAlert): string {
  return `${alert.alertKind}:${alert.tradeId}:${alert.hitDate}:${alert.levelKey}`
}

function sortAlerts<T extends AnyAlert>(alerts: T[], mode: AlertSortMode): T[] {
  return [...alerts].sort((a, b) => {
    if (mode === 'ticker') {
      const byTicker = a.ticker.localeCompare(b.ticker)
      if (byTicker !== 0) return byTicker
      return b.hitDate.localeCompare(a.hitDate)
    }
    // 'date': newest hit first
    const byDate = b.hitDate.localeCompare(a.hitDate)
    if (byDate !== 0) return byDate
    return a.ticker.localeCompare(b.ticker)
  })
}

export function useTradeAlerts() {
  const store = useTradeStore()

  const entryAlerts = store.entryAlerts$.get()
  const sltpAlerts = store.sltpAlerts$.get()
  const layeredAlerts = store.layeredAlerts$.get()
  const detecting = store.detecting$.get()
  const lastResult = store.lastDetectionResult$.get()

  const [sortMode, setSortMode] = useState<AlertSortMode>('date')

  /** Alerts split into the five display categories, sorted by the current mode. */
  const categories = useMemo(() => {
    const split = (dismissed: boolean) => {
      const active = (a: AnyAlert) => a.dismissed === dismissed
      return {
        pe: sortAlerts(entryAlerts.filter(active), sortMode),
        sl: sortAlerts(
          sltpAlerts.filter(a => active(a) && a.hitType === 'sl'),
          sortMode,
        ),
        tp: sortAlerts(
          sltpAlerts.filter(a => active(a) && a.hitType === 'tp'),
          sortMode,
        ),
        conflict: sortAlerts(
          sltpAlerts.filter(a => active(a) && a.hitType === 'both'),
          sortMode,
        ),
        layered: sortAlerts(layeredAlerts.filter(active), sortMode),
      }
    }
    return { active: split(false), dismissed: split(true) }
  }, [entryAlerts, sltpAlerts, layeredAlerts, sortMode])

  const count = (c: typeof categories.active) =>
    c.pe.length + c.sl.length + c.tp.length + c.conflict.length + c.layered.length

  const activeCount = count(categories.active)
  const dismissedCount = count(categories.dismissed)

  const handleDetect = async () => {
    await store.detectTradeHits()
  }

  const dismiss = (alert: AnyAlert) => store.dismissAlert(alert)
  const restore = (alert: AnyAlert) => store.restoreAlert(alert)
  const dismissAll = () => store.dismissAllAlerts()

  const getEntryAlertClass = (alert: EntryAlert): string =>
    alert.autoOpened ? 'alertEntryOpened' : 'alertEntry'

  const getSltpAlertClass = (alert: SLTPAlert): string => {
    if (alert.autoClosed) return 'alertAutoClosed'
    if (alert.hitType === 'both') return 'alertConflict'
    if (alert.hitType === 'sl') return 'alertSl'
    return 'alertTp'
  }

  const getLayeredAlertClass = (alert: LayeredAlert): string => {
    if (alert.autoProcessed) return 'alertAutoClosed'
    return alert.levelType === 'sl' ? 'alertSl' : 'alertTp'
  }

  const getEntryAlertIcon = (alert: EntryAlert): string => (alert.autoOpened ? '✓' : '→')

  const getSltpAlertIcon = (alert: SLTPAlert): string => {
    if (alert.autoClosed) return '✓'
    if (alert.hitType === 'both') return '⚠'
    if (alert.hitType === 'sl') return '✕'
    return '✓'
  }

  const getLayeredAlertIcon = (alert: LayeredAlert): string =>
    alert.levelType === 'sl' ? '✕' : '✓'

  return {
    categories,
    activeCount,
    dismissedCount,
    hasAlerts: activeCount > 0,
    hasDismissed: dismissedCount > 0,
    sortMode,
    setSortMode,
    detecting,
    lastResult,
    handleDetect,
    dismiss,
    restore,
    dismissAll,
    getEntryAlertClass,
    getSltpAlertClass,
    getLayeredAlertClass,
    getEntryAlertIcon,
    getSltpAlertIcon,
    getLayeredAlertIcon,
  }
}
