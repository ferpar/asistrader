import { useTradeStore } from '../container/ContainerContext'
import type { EntryAlert, SLTPAlert } from '../domain/trade/types'

export function useTradeAlerts() {
  const store = useTradeStore()

  const entryAlerts = store.entryAlerts$.get()
  const sltpAlerts = store.sltpAlerts$.get()
  const detecting = store.detecting$.get()
  const lastResult = store.lastDetectionResult$.get()

  const activeEntryAlerts = entryAlerts.filter(a => !a.dismissed)
  const activeSltpAlerts = sltpAlerts.filter(a => !a.dismissed)
  const dismissedEntryAlerts = entryAlerts.filter(a => a.dismissed)
  const dismissedSltpAlerts = sltpAlerts.filter(a => a.dismissed)

  const hasAlerts = activeEntryAlerts.length > 0 || activeSltpAlerts.length > 0
  const hasDismissed = dismissedEntryAlerts.length > 0 || dismissedSltpAlerts.length > 0

  const handleDetect = async () => {
    await store.detectTradeHits()
  }

  const dismiss = (alert: EntryAlert | SLTPAlert) => store.dismissAlert(alert)
  const restore = (alert: EntryAlert | SLTPAlert) => store.restoreAlert(alert)
  const dismissAll = () => store.dismissAllAlerts()

  const getEntryAlertClass = (alert: EntryAlert): string => {
    return alert.autoOpened ? 'alertEntryOpened' : 'alertEntry'
  }

  const getSltpAlertClass = (alert: SLTPAlert): string => {
    if (alert.autoClosed) return 'alertAutoClosed'
    if (alert.hitType === 'both') return 'alertConflict'
    if (alert.hitType === 'sl') return 'alertSl'
    return 'alertTp'
  }

  const getEntryAlertIcon = (alert: EntryAlert): string => {
    return alert.autoOpened ? '✓' : '→'
  }

  const getSltpAlertIcon = (alert: SLTPAlert): string => {
    if (alert.autoClosed) return '✓'
    if (alert.hitType === 'both') return '⚠'
    if (alert.hitType === 'sl') return '✕'
    return '✓'
  }

  return {
    entryAlerts,
    sltpAlerts,
    activeEntryAlerts,
    activeSltpAlerts,
    dismissedEntryAlerts,
    dismissedSltpAlerts,
    detecting,
    lastResult,
    hasAlerts,
    hasDismissed,
    handleDetect,
    dismiss,
    restore,
    dismissAll,
    getEntryAlertClass,
    getSltpAlertClass,
    getEntryAlertIcon,
    getSltpAlertIcon,
  }
}
