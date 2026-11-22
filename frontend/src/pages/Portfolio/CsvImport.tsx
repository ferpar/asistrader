import { useRef, useState, type ChangeEvent } from 'react'
import type { ImportResult, ImportRowResult } from '../../domain/portfolio/types'
import styles from './Portfolio.module.css'

interface CsvImportProps {
  onImport: (csv: string) => Promise<ImportResult>
}

const FORMAT_HINT =
  'Header row with date, ticker, units, price, fees and optional fx_rate and kind ' +
  '(buy, the default, or sell). Separator , or ; — dates YYYY-MM-DD or DD/MM/YYYY — ' +
  'decimal point or comma. Rows may be in any order: they are checked in date order.'

/**
 * Import Buys and Sells from a CSV file. The file is read in the browser and
 * sent as text. The import is all or nothing: if any row fails (an oversell
 * included), nothing is recorded and every failing row is listed, so fix them
 * and import the whole file again.
 */
export function CsvImport({ onImport }: CsvImportProps) {
  const input = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImporting(true)
    setError(null)
    setResult(null)
    try {
      setResult(await onImport(await file.text()))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import Transactions')
    } finally {
      setImporting(false)
    }
  }

  const failures =
    result?.rows.filter(
      (r): r is Extract<ImportRowResult, { status: 'error' }> => r.status === 'error',
    ) ?? []

  return (
    <div className={styles.csvImport}>
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv,text/plain"
        hidden
        onChange={handleFile}
      />
      <button type="button" disabled={importing} onClick={() => input.current?.click()}>
        {importing ? 'Importing…' : 'Import CSV'}
      </button>
      <span className={styles.hint}>{FORMAT_HINT}</span>
      {error && <p className={styles.error}>{error}</p>}
      {result && (
        <div className={styles.importResult} role="status">
          <p>
            {result.failed === 0
              ? `${result.created} imported.`
              : `Nothing imported: ${result.failed} row${result.failed === 1 ? '' : 's'} failed. ` +
                'Fix them and import the whole file again.'}
            <button type="button" className={styles.link} onClick={() => setResult(null)}>
              Dismiss
            </button>
          </p>
          {failures.length > 0 && (
            <ul className={styles.importErrors}>
              {failures.map((r) => (
                <li key={r.row}>
                  Row {r.row}: {r.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
