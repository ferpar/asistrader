import { useTradeStore } from '../container/ContainerContext'
import type { EntryAlert, SLTPAlert } from '../domain/trade/types'

export function useTradeAlerts() {
  const store = useTradeStore()

  const entryAlerts = store.entryAlerts$.get()
  const sltpAlerts = store.sltpAlerts$.get()
  const detecting = store.detecting$.get()
  const lastResult = store.lastDetectionResult$.get()
  const hasAlerts = entryAlerts.length > 0 || sltpAlerts.length > 0

  const handleDetect = async () => {
    await store.detectTradeHits()
  }

  const dismissEntry = (tradeId: number) => store.dismissEntryAlert(tradeId)
  const dismissSltp = (tradeId: number) => store.dismissSltpAlert(tradeId)
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
    return alert.autoOpened ? 'check' : 'arrow-right'
  }

  const getSltpAlertIcon = (alert: SLTPAlert): string => {
    if (alert.autoClosed) return 'check'
    if (alert.hitType === 'both') return 'warning'
    if (alert.hitType === 'sl') return 'X'
    return 'check'
  }

  return {
    entryAlerts,
    sltpAlerts,
    detecting,
    lastResult,
    hasAlerts,
    handleDetect,
    dismissEntry,
    dismissSltp,
    dismissAll,
    getEntryAlertClass,
    getSltpAlertClass,
    getEntryAlertIcon,
    getSltpAlertIcon,
  }
}
