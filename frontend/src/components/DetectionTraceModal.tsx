import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { getOverlayContainer } from '../overlay/overlayLayers'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useTradeRepo } from '../container/ContainerContext'
import type { DetectionTraceResult } from '../domain/trade/types'
import { DetectionTraceTable } from './DetectionTraceTable'
import styles from './DetectionTraceModal.module.css'

interface Props {
  tradeId: number
  ticker: string
  onClose: () => void
}

/**
 * On-demand "Why was this alert raised?" view. Fetches the live trace for
 * one trade (no what-if overrides) and renders the bar-by-bar table. The
 * full what-if exploration UI lives on the detection-sandbox page.
 */
export function DetectionTraceModal({ tradeId, ticker, onClose }: Props) {
  const repo = useTradeRepo()
  const [result, setResult] = useState<DetectionTraceResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const modalRef = useFocusTrap<HTMLDivElement>()

  useEffect(() => {
    let cancelled = false
    setResult(null)
    setError(null)
    repo.fetchDetectionTrace(tradeId).then(
      r => { if (!cancelled) setResult(r) },
      e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) },
    )
    return () => { cancelled = true }
  }, [repo, tradeId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const content = (
    <div className={styles.overlay} onClick={onClose}>
      <div ref={modalRef} className={styles.modal} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" tabIndex={-1}>
        <div className={styles.header}>
          <h3>Detection trace — trade #{tradeId}</h3>
          <a
            className={styles.yahooLink}
            href={`https://finance.yahoo.com/chart/${encodeURIComponent(ticker)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {ticker} on Yahoo Finance ↗
          </a>
          <button className={styles.close} onClick={onClose}>&times;</button>
        </div>
        <div className={styles.body}>
          {error && <div className={styles.error}>Error: {error}</div>}
          {!error && !result && <div className={styles.loading}>Loading…</div>}
          {result && (
            <>
              <div className={styles.summary}>
                <span><strong>Detector:</strong> {result.detectorKind}</span>
                <span><strong>Side:</strong> {result.trace.side}</span>
                <span><strong>Margin:</strong> {result.trace.margin.toString()}</span>
                {result.trace.scanFrom && (
                  <span>
                    <strong>Scan:</strong> {result.trace.scanFrom} → {result.trace.scanTo}
                    {' '}({result.trace.barsScanned} bars)
                  </span>
                )}
              </div>
              <DetectionTraceTable trace={result.trace} />
              <div className={styles.verdict}>{result.trace.verdict}</div>
            </>
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(content, getOverlayContainer('modal'))
}
