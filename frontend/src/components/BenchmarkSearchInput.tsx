import { useState, useEffect, useRef, useCallback } from 'react'
import { useBenchmarkStore } from '../container/ContainerContext'
import type { Benchmark } from '../domain/benchmark/types'
import type { TickerSuggestion } from '../types/ticker'
import styles from './TickerSearchInput.module.css'

interface BenchmarkSearchInputProps {
  existingBenchmarks: Benchmark[]
  onBenchmarkSelect: (symbol: string) => void
  onBenchmarkCreated?: (benchmark: Benchmark) => void
}

export function BenchmarkSearchInput({
  existingBenchmarks,
  onBenchmarkSelect,
  onBenchmarkCreated,
}: BenchmarkSearchInputProps) {
  const benchmarkStore = useBenchmarkStore()
  const [inputValue, setInputValue] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<TickerSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  const filteredExisting = existingBenchmarks.filter(
    (b) =>
      b.symbol.toLowerCase().includes(inputValue.toLowerCase()) ||
      (b.name && b.name.toLowerCase().includes(inputValue.toLowerCase()))
  )

  const searchYahoo = useCallback(async (query: string) => {
    if (query.length < 1) {
      setSuggestions([])
      return
    }

    setLoading(true)
    setError(null)
    try {
      const results = await benchmarkStore.searchBenchmarks(query)
      setSuggestions(results)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
      setSuggestions([])
    } finally {
      setLoading(false)
    }
  }, [benchmarkStore])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setInputValue(value)
    setIsOpen(true)
    setError(null)

    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }
    debounceRef.current = setTimeout(() => {
      searchYahoo(value)
    }, 300)
  }

  const handleInputFocus = () => {
    setIsOpen(true)
    if (inputValue.length >= 1) {
      searchYahoo(inputValue)
    }
  }

  const handleExistingSelect = (symbol: string) => {
    setInputValue('')
    onBenchmarkSelect(symbol)
    setIsOpen(false)
  }

  const handleNewSelect = async (suggestion: TickerSuggestion) => {
    setCreating(suggestion.symbol)
    setError(null)
    try {
      const benchmark = await benchmarkStore.createBenchmark({ symbol: suggestion.symbol })
      setInputValue('')
      onBenchmarkSelect(benchmark.symbol)
      onBenchmarkCreated?.(benchmark)
      setIsOpen(false)
      setSuggestions((prev) => prev.filter((s) => s.symbol !== suggestion.symbol))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create benchmark')
    } finally {
      setCreating(null)
    }
  }

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [])

  const showExisting = filteredExisting.length > 0
  const showNew = suggestions.length > 0
  const showDropdown = isOpen && (showExisting || showNew || loading || error)

  return (
    <div className={styles.tickerSearchContainer} ref={containerRef}>
      <input
        type="text"
        className={styles.tickerSearchInput}
        value={inputValue}
        onChange={handleInputChange}
        onFocus={handleInputFocus}
        placeholder="Search index (e.g. S&P 500, ^GSPC)..."
        autoComplete="off"
      />
      {showDropdown && (
        <div className={styles.tickerDropdown}>
          {error && <div className={styles.tickerDropdownError}>{error}</div>}

          {showExisting && (
            <div className={styles.tickerDropdownSection}>
              <div className={styles.tickerDropdownHeader}>Your Benchmarks</div>
              {filteredExisting.map((benchmark) => (
                <div
                  key={benchmark.symbol}
                  className={styles.tickerDropdownItem}
                  onClick={() => handleExistingSelect(benchmark.symbol)}
                >
                  <span className={styles.tickerSymbol}>{benchmark.symbol}</span>
                  {benchmark.name && (
                    <span className={styles.tickerName}>{benchmark.name}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {showNew && (
            <div className={styles.tickerDropdownSection}>
              <div className={styles.tickerDropdownHeader}>Add Index</div>
              {suggestions.map((suggestion) => (
                <div
                  key={suggestion.symbol}
                  className={`${styles.tickerDropdownItem} ${creating === suggestion.symbol ? styles.creating : ''}`}
                  onClick={() =>
                    creating !== suggestion.symbol && handleNewSelect(suggestion)
                  }
                >
                  <div className={styles.tickerDropdownItemMain}>
                    <span className={styles.tickerSymbol}>{suggestion.symbol}</span>
                    <span className={styles.addBadge}>
                      {creating === suggestion.symbol ? 'Adding...' : '+ Add'}
                    </span>
                  </div>
                  <div className={styles.tickerDropdownItemDetails}>
                    {suggestion.name && (
                      <span className={styles.tickerName}>{suggestion.name}</span>
                    )}
                    {suggestion.exchange && (
                      <span className={styles.tickerExchange}>{suggestion.exchange}</span>
                    )}
                    {suggestion.type && (
                      <span className={styles.tickerType}>{suggestion.type}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {loading && (
            <div className={styles.tickerDropdownLoading}>Searching...</div>
          )}

          {!loading && !error && !showExisting && !showNew && inputValue.length >= 1 && (
            <div className={styles.tickerDropdownEmpty}>No indexes found</div>
          )}
        </div>
      )}
    </div>
  )
}
