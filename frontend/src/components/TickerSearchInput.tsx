import { useState, useEffect, useRef, useCallback } from 'react'
import { searchTickers, createTicker } from '../api/tickers'
import { Ticker, TickerSuggestion } from '../types/trade'

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
      const response = await searchTickers(query)
      setSuggestions(response.suggestions)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
      setSuggestions([])
    } finally {
      setLoading(false)
    }
  }, [])

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
      const response = await createTicker({ symbol: suggestion.symbol })
      setInputValue(response.ticker.symbol)
      onTickerSelect(response.ticker.symbol)
      onTickerCreated?.(response.ticker)
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
    <div className="ticker-search-container" ref={containerRef}>
      <input
        type="text"
        className="ticker-search-input"
        value={inputValue}
        onChange={handleInputChange}
        onFocus={handleInputFocus}
        placeholder="Search ticker..."
        autoComplete="off"
      />
      {showDropdown && (
        <div className="ticker-dropdown">
          {error && <div className="ticker-dropdown-error">{error}</div>}

          {showExisting && (
            <div className="ticker-dropdown-section">
              <div className="ticker-dropdown-header">Your Tickers</div>
              {filteredExisting.map((ticker) => (
                <div
                  key={ticker.symbol}
                  className="ticker-dropdown-item"
                  onClick={() => handleExistingSelect(ticker.symbol)}
                >
                  <span className="ticker-symbol">{ticker.symbol}</span>
                  {ticker.name && (
                    <span className="ticker-name">{ticker.name}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {showNew && (
            <div className="ticker-dropdown-section">
              <div className="ticker-dropdown-header">Add New</div>
              {suggestions.map((suggestion) => (
                <div
                  key={suggestion.symbol}
                  className={`ticker-dropdown-item ${creating === suggestion.symbol ? 'creating' : ''}`}
                  onClick={() =>
                    creating !== suggestion.symbol && handleNewSelect(suggestion)
                  }
                >
                  <div className="ticker-dropdown-item-main">
                    <span className="ticker-symbol">{suggestion.symbol}</span>
                    <span className="add-badge">
                      {creating === suggestion.symbol ? 'Adding...' : '+ Add'}
                    </span>
                  </div>
                  <div className="ticker-dropdown-item-details">
                    {suggestion.name && (
                      <span className="ticker-name">{suggestion.name}</span>
                    )}
                    {suggestion.exchange && (
                      <span className="ticker-exchange">{suggestion.exchange}</span>
                    )}
                    {suggestion.type && (
                      <span className="ticker-type">{suggestion.type}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {loading && (
            <div className="ticker-dropdown-loading">Searching...</div>
          )}

          {!loading && !error && !showExisting && !showNew && inputValue.length >= 1 && (
            <div className="ticker-dropdown-empty">No tickers found</div>
          )}
        </div>
      )}
    </div>
  )
}
