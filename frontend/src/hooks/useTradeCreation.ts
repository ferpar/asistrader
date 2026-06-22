import { useState, useEffect, useMemo, useCallback } from 'react'
import { TradeCreateRequest, ExitLevelCreateRequest, OrderType, TimeInEffect, TradeDirection } from '../types/trade'
import type { DraftPreset, DraftResult, Strategy } from '../domain/strategy/types'
import { buildStrategySnapshot } from '../domain/strategy/draftPresets'
import type { Ticker } from '../domain/ticker/types'
import { useTradeValidation } from './useTradeValidation'
import { useTradeStore, useStrategyRepo, useTickerStore, useFundStore, useFxStore } from '../container/ContainerContext'
import { localTodayIso } from '../utils/dateOnly'
import { Decimal } from '../domain/shared/Decimal'
import { deriveOrderType, wouldAutoSettle } from '../domain/trade/orderType'

export interface ExitLevelInput {
  price: string
  units_pct: string
  move_sl_to_breakeven: boolean
}

export function useTradeCreation(initialTicker?: string) {
  const store = useTradeStore()
  const strategyRepo = useStrategyRepo()
  const tickerStore = useTickerStore()
  const fundStore = useFundStore()
  const fxStore = useFxStore()
  const [tickers, setTickers] = useState<Ticker[]>([])
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [loadingTickers, setLoadingTickers] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentPrice, setCurrentPrice] = useState<number | null>(null)
  const [loadingPrice, setLoadingPrice] = useState(false)

  const [formData, setFormData] = useState({
    ticker: '',
    entry_price: '',
    stop_loss: '',
    take_profit: '',
    units: '',
    date_planned: localTodayIso(),
    strategy_id: '',
    auto_detect: false,
    order_type: 'limit' as OrderType,
    time_in_effect: '' as TimeInEffect | '',
    gtd_date: '',
  })

  // Tracks whether the user has manually picked an order type. While false, the
  // order type is auto-derived from direction + entry-vs-current price. Reset on
  // ticker change and form reset (a new instrument is a fresh context).
  const [orderTypeTouched, setOrderTypeTouched] = useState(false)

  // Same pattern for units: while false, units track the recommended size (once
  // entry price + balance + FX are known). Set on manual edit; reset on ticker
  // change, form reset, and when the user clicks the "Suggested" chip.
  const [unitsTouched, setUnitsTouched] = useState(false)

  // --- Automated-strategy draft state ---
  const [draftResult, setDraftResult] = useState<DraftResult | null>(null)
  const [draftLoading, setDraftLoading] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [plrInput, setPlrInput] = useState('1.5')
  const [draftSide, setDraftSide] = useState<'long' | 'short'>('long')
  // Entry order type for the draft. 'limit' buys the dip / sells strength (mean
  // reversion); 'stop' buys the breakout / sells the breakdown (trend
  // continuation). Flips the sign of the entry offset and reshapes the sweep.
  const [draftOrderType, setDraftOrderType] = useState<'limit' | 'stop'>('limit')
  // The preset whose prices were last applied, and the exact strings written, so
  // we can tell on submit whether the user nudged them (followed_faithfully).
  const [appliedPreset, setAppliedPreset] = useState<DraftPreset | null>(null)
  const [appliedPrices, setAppliedPrices] = useState<{ entry: string; sl: string; tp: string } | null>(null)

  const [layeredMode, setLayeredMode] = useState(false)
  const [tpLevels, setTpLevels] = useState<ExitLevelInput[]>([
    { price: '', units_pct: '50', move_sl_to_breakeven: true },
    { price: '', units_pct: '30', move_sl_to_breakeven: false },
    { price: '', units_pct: '20', move_sl_to_breakeven: false },
  ])

  useEffect(() => {
    const loadData = async () => {
      try {
        const [loadedTickers, loadedStrategies] = await Promise.all([
          tickerStore.loadTickers().then(() => tickerStore.tickers$.get()),
          strategyRepo.fetchStrategies(),
        ])
        setTickers(loadedTickers)
        setStrategies(loadedStrategies)
        const defaultSymbol = initialTicker ?? (loadedTickers.length > 0 ? loadedTickers[0].symbol : '')
        if (defaultSymbol) {
          setFormData(prev => ({ ...prev, ticker: defaultSymbol }))
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data')
      } finally {
        setLoadingTickers(false)
      }
    }
    loadData()
  }, [])

  const loadCurrentPrice = useCallback(async (symbol: string) => {
    if (!symbol) {
      setCurrentPrice(null)
      return
    }
    setLoadingPrice(true)
    try {
      const response = await tickerStore.fetchTickerPrice(symbol)
      setCurrentPrice(response.valid ? response.price : null)
    } catch {
      setCurrentPrice(null)
    } finally {
      setLoadingPrice(false)
    }
  }, [tickerStore])

  useEffect(() => {
    loadCurrentPrice(formData.ticker)
  }, [formData.ticker, loadCurrentPrice])

  // Live trade direction, derived from entry vs stop loss (long = SL below
  // entry). Available mid-edit, unlike `validation.direction` which is null
  // until the whole form is valid.
  const direction = useMemo<TradeDirection | null>(() => {
    const entry = parseFloat(formData.entry_price) || 0
    const sl = parseFloat(formData.stop_loss) || 0
    if (entry > 0 && sl > 0 && entry !== sl) return sl < entry ? 'long' : 'short'
    return null
  }, [formData.entry_price, formData.stop_loss])

  // Auto-derive the order type as entry / stop loss / current price come into
  // focus, so a limit/stop order defaults to the side that hasn't triggered
  // yet. Stops once the user picks a type by hand (orderTypeTouched).
  useEffect(() => {
    if (orderTypeTouched || direction === null || currentPrice === null) return
    const entry = parseFloat(formData.entry_price) || 0
    if (entry <= 0) return
    const derived = deriveOrderType(direction, entry, currentPrice)
    if (derived && derived !== formData.order_type) {
      setFormData(prev => ({ ...prev, order_type: derived }))
    }
  }, [orderTypeTouched, direction, currentPrice, formData.entry_price, formData.order_type])

  // Ensure FX rates for the selected ticker's currency AND the user's base
  // are loaded — both legs are needed since FxStore.convert triangulates via
  // USD (rate_to_usd[from] / rate_to_usd[to]). FundStore only loads FX for
  // currencies seen in existing fund events, and the on-login auto-sync only
  // covers currencies of *traded* tickers — so a brand-new currency (e.g.
  // GBp before the first Rolls Royce trade) needs an explicit fetch + sync.
  // `ensureLoaded` is a no-op if rates are already cached.
  useEffect(() => {
    const ticker = tickers.find(t => t.symbol === formData.ticker)
    if (!ticker?.currency) return
    const baseCurrency = fundStore.baseCurrency$.get()
    fxStore.ensureLoaded(ticker.currency)
    if (baseCurrency !== ticker.currency) fxStore.ensureLoaded(baseCurrency)
  }, [formData.ticker, tickers, fxStore, fundStore])

  // Subscribe to FX cache state so the form (wrapped in `observer`) re-renders
  // — and the memos below re-run — once the per-ticker rate finishes loading.
  // `loading$` flips on every load (true→false), which `loaded$` doesn't after
  // the initial hydration.
  const fxLoading = fxStore.loading$.get()
  const fxLoaded = fxStore.loaded$.get()

  const preview = useMemo(() => {
    const entryPrice = parseFloat(formData.entry_price) || 0
    const units = parseInt(formData.units) || 0
    const stopLoss = parseFloat(formData.stop_loss) || 0

    let takeProfit: number

    if (layeredMode) {
      const validTpLevels = tpLevels.filter(l => l.price && l.units_pct)
      if (validTpLevels.length > 0) {
        const totalPct = validTpLevels.reduce((sum, l) => sum + (parseFloat(l.units_pct) || 0), 0)
        takeProfit = validTpLevels.reduce((sum, l) => {
          const price = parseFloat(l.price) || 0
          const pct = parseFloat(l.units_pct) || 0
          return sum + (price * pct)
        }, 0) / (totalPct || 1)
      } else {
        takeProfit = 0
      }
    } else {
      takeProfit = parseFloat(formData.take_profit) || 0
    }

    const amount = entryPrice * units
    const riskAbs = (stopLoss - entryPrice) * units
    const profitAbs = (takeProfit - entryPrice) * units
    const riskPct = amount !== 0 ? riskAbs / amount : 0
    const profitPct = amount !== 0 ? profitAbs / amount : 0
    const ratio = riskAbs !== 0 ? -profitAbs / riskAbs : 0

    // Base-currency conversions for the preview. Null when ticker currency
    // matches base, or when FX rates aren't loaded yet.
    const baseCurrency = fundStore.baseCurrency$.get()
    const tickerCurrency = tickers.find(t => t.symbol === formData.ticker)?.currency ?? baseCurrency
    let amountInBase: number | null = null
    let riskAbsInBase: number | null = null
    let profitAbsInBase: number | null = null
    if (tickerCurrency !== baseCurrency) {
      try {
        const today = new Date()
        amountInBase = fxStore.convert(Decimal.from(amount), tickerCurrency, baseCurrency, today).toNumber()
        riskAbsInBase = fxStore.convert(Decimal.from(riskAbs), tickerCurrency, baseCurrency, today).toNumber()
        profitAbsInBase = fxStore.convert(Decimal.from(profitAbs), tickerCurrency, baseCurrency, today).toNumber()
      } catch {
        // FX not yet loaded — leave nulls; UI hides the secondary line.
      }
    }

    return {
      amount, riskAbs, profitAbs, riskPct, profitPct, ratio,
      amountInBase, riskAbsInBase, profitAbsInBase,
      baseCurrency, tickerCurrency,
    }
  }, [
    formData.entry_price, formData.stop_loss, formData.take_profit, formData.units,
    formData.ticker, layeredMode, tpLevels, tickers, fundStore, fxStore,
    fxLoaded, fxLoading,
  ])

  const exitLevelsForValidation = useMemo((): ExitLevelCreateRequest[] | undefined => {
    if (!layeredMode) return undefined

    const levels: ExitLevelCreateRequest[] = []

    for (const level of tpLevels) {
      if (level.price) {
        levels.push({
          level_type: 'tp',
          price: parseFloat(level.price) || 0,
          units_pct: (parseFloat(level.units_pct) || 0) / 100,
          move_sl_to_breakeven: level.move_sl_to_breakeven,
        })
      }
    }

    const slPrice = parseFloat(formData.stop_loss)
    if (slPrice) {
      levels.push({
        level_type: 'sl',
        price: slPrice,
        units_pct: 1.0,
        move_sl_to_breakeven: false,
      })
    }

    return levels.length > 0 ? levels : undefined
  }, [layeredMode, tpLevels, formData.stop_loss])

  const validationValues = useMemo(() => {
    const stopLoss = parseFloat(formData.stop_loss) || 0

    let takeProfit: number
    if (layeredMode && exitLevelsForValidation && exitLevelsForValidation.length > 0) {
      const tpLevelsArr = exitLevelsForValidation.filter(l => l.level_type === 'tp')
      if (tpLevelsArr.length > 0) {
        const totalPct = tpLevelsArr.reduce((sum, l) => sum + l.units_pct, 0)
        takeProfit = tpLevelsArr.reduce((sum, l) => sum + (l.price * l.units_pct), 0) / (totalPct || 1)
      } else {
        takeProfit = 0
      }
    } else {
      takeProfit = parseFloat(formData.take_profit) || 0
    }

    return {
      entry_price: parseFloat(formData.entry_price) || 0,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      units: parseInt(formData.units) || 0,
      exit_levels: exitLevelsForValidation,
    }
  }, [formData.entry_price, formData.stop_loss, formData.take_profit, formData.units, exitLevelsForValidation, layeredMode])

  const suggestedUnits = useMemo(() => {
    const entryPrice = parseFloat(formData.entry_price) || 0
    if (entryPrice <= 0) return null
    const balance = fundStore.balance$.get()
    if (balance === null) return null
    const maxPerTrade = balance.maxPerTrade
    if (!maxPerTrade.isPositive()) return null
    // entryPrice is in the ticker's currency (e.g. GBp pence); maxPerTrade is in the
    // user's base currency. Convert to the ticker's currency before dividing.
    const baseCurrency = fundStore.baseCurrency$.get()
    const tickerCurrency = tickers.find(t => t.symbol === formData.ticker)?.currency ?? baseCurrency
    let maxPerTradeInTickerCcy: Decimal
    try {
      maxPerTradeInTickerCcy = fxStore.convert(maxPerTrade, baseCurrency, tickerCurrency, new Date())
    } catch {
      return null
    }
    const units = Math.floor(maxPerTradeInTickerCcy.toNumber() / entryPrice)
    return units > 0 ? units : null
  }, [formData.entry_price, formData.ticker, tickers, fundStore, fxStore, fxLoaded, fxLoading])

  // Prefill units with the recommended size as soon as it's known, so the user
  // doesn't have to click the suggestion. Stops once they edit units by hand
  // (unitsTouched); keeps re-syncing while untouched as the entry price — and
  // thus the recommendation — changes (e.g. after applying a strategy preset).
  useEffect(() => {
    if (unitsTouched || suggestedUnits === null) return
    const next = String(suggestedUnits)
    if (formData.units !== next) {
      setFormData(prev => ({ ...prev, units: next }))
    }
  }, [unitsTouched, suggestedUnits, formData.units])

  const applySuggestedUnits = () => {
    if (suggestedUnits !== null) {
      // Re-arm auto-sync: clicking the chip means "follow the recommendation".
      setUnitsTouched(false)
      setFormData(prev => ({ ...prev, units: String(suggestedUnits) }))
    }
  }

  // --- Automated-strategy draft flow ---
  const selectedStrategy = useMemo(
    () => strategies.find(s => String(s.id) === formData.strategy_id) ?? null,
    [strategies, formData.strategy_id],
  )
  const isAutomatedStrategy = !!selectedStrategy?.automated

  const fmtPrice = (n: number) => String(Number(n.toFixed(4)))

  const runDraft = useCallback(async () => {
    if (!selectedStrategy?.automated || !formData.ticker) return
    setDraftLoading(true)
    setDraftError(null)
    try {
      // Locale-safe: accept a decimal comma (e.g. "1,5") as well as a period.
      const plr = parseFloat(plrInput.replace(',', '.'))
      const res = await strategyRepo.draftTrade(selectedStrategy.id, {
        ticker: formData.ticker,
        plr: Number.isFinite(plr) ? plr : null,
        side: draftSide,
        order_type: draftOrderType,
      })
      setDraftResult(res)
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : 'Failed to draft trade')
      setDraftResult(null)
    } finally {
      setDraftLoading(false)
    }
  }, [selectedStrategy, formData.ticker, plrInput, draftSide, draftOrderType, strategyRepo])

  // Auto-draft when an automated strategy is selected (re-runs on ticker/PLR/side
  // change); clear draft state when switching back to a manual strategy.
  useEffect(() => {
    if (isAutomatedStrategy && formData.ticker) {
      runDraft()
    } else {
      setDraftResult(null)
      setAppliedPreset(null)
      setAppliedPrices(null)
    }
  }, [isAutomatedStrategy, formData.ticker, plrInput, draftSide, draftOrderType, runDraft])

  const applyPreset = (p: DraftPreset) => {
    const entry = fmtPrice(p.entry)
    const sl = fmtPrice(p.stopLoss)
    const tp = fmtPrice(p.takeProfit)
    setLayeredMode(false)
    setOrderTypeTouched(false) // let the order type auto-derive from the new entry vs price
    setFormData(prev => ({ ...prev, entry_price: entry, stop_loss: sl, take_profit: tp }))
    setAppliedPreset(p)
    setAppliedPrices({ entry, sl, tp })
  }

  const appliedPresetKind = appliedPreset?.kind ?? null

  const validation = useTradeValidation(validationValues)

  const getFieldError = (field: string) =>
    validation.errors.find(e => e.field === field)?.message ?? null

  // True while the order type is being auto-derived (not yet hand-picked) and
  // the inputs needed to derive it are present.
  const orderTypeAutoDerived = !orderTypeTouched && direction !== null && currentPrice !== null

  // A limit/stop order whose entry is on the wrong side of the current price
  // would fill on the next tick. Surfaced inline and confirmed before submit.
  const autoSettleWarning = useMemo<string | null>(() => {
    const entry = parseFloat(formData.entry_price) || 0
    if (direction === null || currentPrice === null || entry <= 0) return null
    if (formData.order_type !== 'limit' && formData.order_type !== 'stop') return null
    if (!wouldAutoSettle(direction, formData.order_type, entry, currentPrice)) return null
    return `A ${formData.order_type} order at ${entry} would fill immediately — the current price (${currentPrice}) is already on its fill side.`
  }, [direction, currentPrice, formData.entry_price, formData.order_type])

  // Non-blocking concerns surfaced as confirm() prompts before submit. Shared
  // by both the guided and advanced forms so the gating stays identical.
  const submitWarnings = useMemo<string[]>(() => {
    const warnings: string[] = []
    if (preview.ratio > 0 && preview.ratio < 1.5) {
      warnings.push(`Risk/reward ratio is ${preview.ratio.toFixed(2)}. Continue anyway?`)
    }
    if (autoSettleWarning) {
      warnings.push(`${autoSettleWarning} Place it anyway?`)
    }
    return warnings
  }, [preview.ratio, autoSettleWarning])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    if (name === 'order_type') setOrderTypeTouched(true)
    if (name === 'units') setUnitsTouched(true)
    setFormData(prev => ({ ...prev, [name]: value }))
    setError(null)
  }

  const resetForm = () => {
    setFormData({
      ticker: initialTicker ?? (tickers.length > 0 ? tickers[0].symbol : ''),
      entry_price: '',
      stop_loss: '',
      take_profit: '',
      units: '',
      date_planned: localTodayIso(),
      strategy_id: '',
      auto_detect: false,
      order_type: 'limit',
      time_in_effect: '',
      gtd_date: '',
    })
    setOrderTypeTouched(false)
    setUnitsTouched(false)
    setLayeredMode(false)
    setTpLevels([
      { price: '', units_pct: '50', move_sl_to_breakeven: true },
      { price: '', units_pct: '30', move_sl_to_breakeven: false },
      { price: '', units_pct: '20', move_sl_to_breakeven: false },
    ])
    setDraftResult(null)
    setAppliedPreset(null)
    setAppliedPrices(null)
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validation.isValid) {
      setError('Please fix the validation errors')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      let exitLevelsToSend: ExitLevelCreateRequest[]

      if (layeredMode && exitLevelsForValidation && exitLevelsForValidation.length > 0) {
        exitLevelsToSend = exitLevelsForValidation
      } else {
        const stopLoss = parseFloat(formData.stop_loss)
        const takeProfit = parseFloat(formData.take_profit)
        exitLevelsToSend = [
          { level_type: 'sl', price: stopLoss, units_pct: 1.0, move_sl_to_breakeven: false },
          { level_type: 'tp', price: takeProfit, units_pct: 1.0, move_sl_to_breakeven: false },
        ]
      }

      // Automated draft: stamp whether the suggested prices were kept as-is and
      // snapshot the draft-time expectations for realized-vs-expected analysis.
      let followedFaithfully: boolean | null = null
      let strategySnapshot: Record<string, unknown> | null = null
      if (isAutomatedStrategy && appliedPreset && appliedPrices && draftResult) {
        followedFaithfully =
          formData.entry_price === appliedPrices.entry &&
          formData.stop_loss === appliedPrices.sl &&
          !layeredMode &&
          formData.take_profit === appliedPrices.tp
        strategySnapshot = buildStrategySnapshot(
          draftResult,
          appliedPreset,
          parseFloat(plrInput) || draftResult.breakevenWinRate,
          1,
        )
      }

      const request: TradeCreateRequest = {
        ticker: formData.ticker,
        entry_price: parseFloat(formData.entry_price),
        units: parseInt(formData.units),
        date_planned: formData.date_planned,
        strategy_id: formData.strategy_id ? parseInt(formData.strategy_id) : null,
        auto_detect: formData.auto_detect,
        exit_levels: exitLevelsToSend,
        order_type: formData.order_type,
        time_in_effect: formData.time_in_effect ? formData.time_in_effect as TimeInEffect : null,
        gtd_date: formData.time_in_effect === 'gtd' && formData.gtd_date ? formData.gtd_date : null,
        followed_faithfully: followedFaithfully,
        strategy_snapshot: strategySnapshot,
      }
      await store.createTrade(request)
      resetForm()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create trade')
      return false
    } finally {
      setSubmitting(false)
    }
  }

  const addTicker = (newTicker: Ticker) => {
    setTickers(prev => [...prev, newTicker].sort((a, b) => a.symbol.localeCompare(b.symbol)))
  }

  const selectTicker = (symbol: string) => {
    // New instrument = fresh context: resume auto-deriving the order type and
    // re-deriving the recommended units.
    setOrderTypeTouched(false)
    setUnitsTouched(false)
    setFormData(prev => ({ ...prev, ticker: symbol }))
  }

  const setAutoDetect = (checked: boolean) => {
    setFormData(prev => ({ ...prev, auto_detect: checked }))
  }

  return {
    formData,
    layeredMode,
    setLayeredMode,
    tpLevels,
    setTpLevels,
    tickers,
    strategies,
    loadingTickers,
    submitting,
    error,
    currentPrice,
    loadingPrice,
    preview,
    suggestedUnits,
    applySuggestedUnits,
    // Automated-strategy draft flow
    selectedStrategy,
    isAutomatedStrategy,
    draftResult,
    draftLoading,
    draftError,
    plrInput,
    setPlrInput,
    draftSide,
    setDraftSide,
    draftOrderType,
    setDraftOrderType,
    runDraft,
    applyPreset,
    appliedPresetKind,
    validation,
    direction,
    orderTypeAutoDerived,
    autoSettleWarning,
    submitWarnings,
    getFieldError,
    handleChange,
    handleSubmit,
    resetForm,
    addTicker,
    selectTicker,
    setAutoDetect,
  }
}

export type UseTradeCreation = ReturnType<typeof useTradeCreation>
