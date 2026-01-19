# AsisTrader - Feature Roadmap

## Overview

This document maps functionality from the original Excel workbook to planned application features.

---

## Excel Functionality Analysis

### Sheets Inventory

| Sheet | Purpose | Data Rows |
|-------|---------|-----------|
| Trading Ops | Main trade tracker with all calculations | 134 |
| Input | Daily price data entry (7-day rolling) | 95 |
| Swing_Trading_TradingView | Ticker metadata from TradingView | 82 |
| Swing_82_PE_SL_TP | Strategy configuration per ticker | 58 |
| Ranking Semanal | Weekly watchlist with recommendations | 62 |
| Plan | Filtered view: planned trades | 49 |
| Open | Filtered view: active positions | 31 |
| Close +/- | Filtered views: wins and losses | 38 each |
| Close dating +/- | Timeline analysis of closed trades | ~25 each |
| Incoming | Price data pipeline | 89 |

---

## Feature Mapping

### 1. Trade Management

| Excel Feature | Location | App Feature | Priority | Status |
|---------------|----------|-------------|----------|--------|
| Trade entry (Ticker, PE, SL, TP, Units) | Trading Ops cols A-M | Trade creation form | High | ✅ Done |
| Status tracking (Plan/Open/Close) | Trading Ops col F | Trade.status field | High | ✅ Done |
| Date tracking (planned, actual, exit) | Trading Ops cols E,H,N,T | Trade date fields | High | ✅ Done |
| Exit type (SL hit / TP hit) | Trading Ops cols N,T | Trade.exit_type | High | ✅ Done |
| Trade numbering on close | Trading Ops col A | Trade.number | Medium | ✅ Done |

### 2. Calculations (Auto-computed)

| Excel Feature | Formula Example | App Feature | Priority | Status |
|---------------|-----------------|-------------|----------|--------|
| Amount | `=PE * Units` | Trade.amount (computed) | High | ✅ Done |
| Risk Absolute | `=(SL - PE) * Units` | Trade.risk_abs | High | ✅ Done |
| Risk % | `=Risk_Abs / Amount` | Trade.risk_pct | High | ✅ Done |
| Profit Absolute | `=(TP - PE) * Units` | Trade.profit_abs | High | ✅ Done |
| Profit % | `=Profit_Abs / Amount` | Trade.profit_pct | High | ✅ Done |
| Reward/Risk Ratio | `=-Profit_Abs / Risk_Abs` | Trade.ratio | High | ✅ Done |
| Days in trade | `=TODAY() - date_actual` | Trade.days_open | Medium | ⬜ Todo |
| Delta to planned | `=date_actual - date_plan` | Trade.entry_delta | Low | ⬜ Todo |

### 3. Live Monitoring (Requires Market Data)

| Excel Feature | Formula Example | App Feature | Priority | Status |
|---------------|-----------------|-------------|----------|--------|
| Latest Quote | Manual input / VLOOKUP | MarketData.close | High | ✅ Done |
| Distance to PE | `=Latest / PE - 1` | Computed property | Medium | ⬜ Todo |
| Distance to SL | `=Latest / SL - 1` | Computed property | Medium | ⬜ Todo |
| Distance to TP | `=Latest / TP - 1` | Computed property | Medium | ⬜ Todo |
| TP/SL ratio from current | `=-Dist_TP / Dist_SL` | Computed property | Low | ⬜ Todo |

### 4. Ticker Intelligence

| Excel Feature | Location | App Feature | Priority | Status |
|---------------|----------|-------------|----------|--------|
| Add new tickers | Manual entry | Yahoo Finance search + yfinance validation | High | ✅ Done |
| Current price lookup | Manual / VLOOKUP | yfinance price API | High | ✅ Done |
| Success probability | Swing_82 col C | Ticker.probability | High | ✅ Done |
| Bias (Long/Short) | Swing_82 col D | Ticker.bias | Medium | ✅ Done |
| Time horizon | Swing_82 col E | Ticker.horizon | Medium | ✅ Done |
| Beta classification | Swing_82 col F | Ticker.beta | Medium | ✅ Done |
| Recommended strategy | Swing_82 col G | Ticker.strategy_id | High | ✅ Done |
| PE/SL/TP methodology | Swing_82 cols H-J | Strategy entity | High | ✅ Done |
| Market phase | Swing_82 col K | Ticker.market_phase | Low | ⬜ Todo |

### 5. Strategy System

| Excel Feature | Location | App Feature | Priority | Status |
|---------------|----------|-------------|----------|--------|
| Strategy name | Swing_82 col G | Strategy.name | High | ✅ Done |
| Entry method type | Swing_82 col H | Strategy.pe_method | High | ✅ Done |
| Stop-loss method type | Swing_82 col I | Strategy.sl_method | High | ✅ Done |
| Take-profit method type | Swing_82 col J | Strategy.tp_method | High | ✅ Done |
| Strategy per trade | (implicit) | Trade.strategy_id | High | ✅ Done |

### 6. Weekly Ranking / Watchlist

| Excel Feature | Location | App Feature | Priority | Status |
|---------------|----------|-------------|----------|--------|
| Ranked ticker list | Ranking Semanal | Watchlist entity | Medium | ⬜ Todo |
| Price range recommendations | Ranking cols E-G | WatchlistItem.pe_range, etc. | Medium | ⬜ Todo |
| Commentary | Ranking col H | WatchlistItem.notes | Low | ⬜ Todo |

### 7. Market Data

| Excel Feature | Location | App Feature | Priority | Status |
|---------------|----------|-------------|----------|--------|
| Daily price input | Input sheet | MarketData entity | High | ✅ Done |
| 7-day rolling prices | Input cols B-H | MarketData records | Medium | ✅ Done |
| Min/Max calculations | Input cols I-J | Computed from MarketData | Low | ⬜ Todo |
| Price data pipeline | Incoming sheet | yfinance integration | Medium | ✅ Done |

### 8. Filtered Views

| Excel Feature | Sheet(s) | App Feature | Priority | Status |
|---------------|----------|-------------|----------|--------|
| Plan view | Plan | Filter: status=plan | High | ✅ Done |
| Open positions | Open | Filter: status=open | High | ✅ Done |
| All closed | Close All | Filter: status=close | High | ✅ Done |
| Winners only | Close + | Filter: status=close, exit_type=tp | Medium | ⬜ Todo |
| Losers only | Close - | Filter: status=close, exit_type=sl | Medium | ⬜ Todo |
| Timeline analysis | Close dating +/- | Trades with date grouping | Low | ⬜ Todo |

### 9. Validation & Error Prevention

| Excel Feature | How it worked | App Feature | Priority | Status |
|---------------|---------------|-------------|----------|--------|
| Ticker lookup | VLOOKUP to master list | Searchable dropdown with Yahoo suggestions | High | ✅ Done |
| Probability lookup | VLOOKUP(ticker, Probabilidad) | Auto-populated from Ticker | High | ⬜ Todo |
| Trend lookup | VLOOKUP(ticker, DataTrend) | Auto-populated from Ticker | Medium | ⬜ Todo |
| Conditional formatting | Cell colors by status | CSS classes by status | Medium | ⬜ Todo |
| Required field validation | (manual) | Form validation | High | ⬜ Todo |

---

## Implementation Phases

### Phase 1: Walking Skeleton ✅
- [x] Basic Trade entity with status
- [x] List trades endpoint
- [x] TradeTable component
- [x] Docker setup (PostgreSQL, FastAPI, React)
- [x] Seed data

### Phase 2: Core Trade Management
- [x] Add Strategy entity
- [x] Extend Ticker with bias, horizon, beta, strategy_id
- [x] Add remaining calculated properties (risk_pct, profit_pct, ratio)
- [x] Filtered views in UI (All, Plan, Open, Close tabs)
- [x] Trade creation form with validation
- [x] Ticker search with Yahoo Finance suggestions
- [x] Add new tickers via search (validates with yfinance)
- [x] Current price display when selecting ticker
- [ ] Trade status transitions (plan → open → close)

### Phase 3: Market Data Integration
- [x] MarketData entity
- [x] yfinance integration (fetch, store, extend)
- [x] Bulk fetch/extend for all tickers
- [x] Market Data Sync UI (date picker, sync button, results display)
- [ ] Manual price input form
- [ ] Live monitoring calculations (distance to SL/TP)

### Phase 4: Strategy System
- [ ] Strategy CRUD
- [ ] Assign strategy to trades
- [ ] Strategy recommendation on Ticker
- [ ] Compare actual vs recommended performance

### Phase 5: Analytics & Reporting
- [ ] Win/loss statistics
- [ ] Performance by strategy
- [ ] Performance by ticker
- [ ] Timeline analysis
- [ ] Export functionality

### Phase 6: Advanced Features (Future)
- [ ] Watchlist / Weekly ranking
- [ ] Position sizing calculator
- [ ] AI-assisted trade suggestions
- [ ] Real-time price updates (WebSockets)
- [ ] Mobile-friendly UI

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Implemented |
| 🟡 | Partial |
| ⬜ | Todo |
