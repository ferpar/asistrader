import { useState, useEffect, useRef, useCallback } from 'react'
import { useTickerStore } from '../container/ContainerContext'
import type { Ticker } from '../domain/ticker/types'
import type { TickerSuggestion } from '../types/ticker'
import styles from './TickerSearchInput.module.css'

interface TickerSearchInputProps {
  existingTickers: Ticker[]
  selectedTicker: string
  onTickerSelect: (symbol: string) => void
  onTickerCreated?: (ticker: Ticker) => void
}

export function TickerSearchInput({
  existingTickers,
  selectedTicker,
  onTickerSelect,
  onTickerCreated,
}: TickerSearchInputProps) {
  const tickerStore = useTickerStore()
  const [inputValue, setInputValue] = useState(selectedTicker)
  const [isOpen, setIsOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<TickerSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  // Update input value when selectedTicker changes externally
  useEffect(() => {
    setInputValue(selectedTicker)
  }, [selectedTicker])

  // Filter existing tickers based on input
  const filteredExisting = existingTickers.filter(
    (t) =>
      t.symbol.toLowerCase().includes(inputValue.toLowerCase()) ||
      (t.name && t.name.toLowerCase().includes(inputValue.toLowerCase()))
  )

  // Debounced search
  const searchYahoo = useCallback(async (query: string) => {
    if (query.length < 1) {
      setSuggestions([])
      return
    }

    setLoading(true)
    setError(null)
    try {
      const suggestions = await tickerStore.searchTickers(query)
      setSuggestions(suggestions)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
      setSuggestions([])
    } finally {
      setLoading(false)
    }
  }, [tickerStore])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setInputValue(value)
    setIsOpen(true)
    setError(null)

    // Debounce the Yahoo search
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
    setInputValue(symbol)
    onTickerSelect(symbol)
    setIsOpen(false)
  }

  const handleNewSelect = async (suggestion: TickerSuggestion) => {
    setCreating(suggestion.symbol)
    setError(null)
    try {
      const ticker = await tickerStore.createTicker({ symbol: suggestion.symbol })
      setInputValue(ticker.symbol)
      onTickerSelect(ticker.symbol)
      onTickerCreated?.(ticker)
      setIsOpen(false)
      // Remove from suggestions since it's now in existing tickers
      setSuggestions((prev) => prev.filter((s) => s.symbol !== suggestion.symbol))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create ticker')
    } finally {
      setCreating(null)
    }
  }

  // Click outside to close
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

  // Cleanup debounce on unmount
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
        placeholder="Search ticker..."
        autoComplete="off"
      />
      {showDropdown && (
        <div className={styles.tickerDropdown}>
          {error && <div className={styles.tickerDropdownError}>{error}</div>}

          {showExisting && (
            <div className={styles.tickerDropdownSection}>
              <div className={styles.tickerDropdownHeader}>Your Tickers</div>
              {filteredExisting.map((ticker) => (
                <div
                  key={ticker.symbol}
                  className={styles.tickerDropdownItem}
                  onClick={() => handleExistingSelect(ticker.symbol)}
                >
                  <span className={styles.tickerSymbol}>{ticker.symbol}</span>
                  {ticker.name && (
                    <span className={styles.tickerName}>{ticker.name}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {showNew && (
            <div className={styles.tickerDropdownSection}>
              <div className={styles.tickerDropdownHeader}>Add New</div>
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
            <div className={styles.tickerDropdownEmpty}>No tickers found</div>
          )}
        </div>
      )}
    </div>
  )
}
