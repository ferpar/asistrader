# AsisTrader - Domain Model

## Overview

AsisTrader is a trading operations management system designed to track positions through their lifecycle while maintaining auditability and flexibility in strategy selection.

## Core Principles

- **Minimal Input Error**: Validation rules, dropdowns from master data, auto-calculations
- **Auditability**: Track what strategy was actually used, event history, calculation traces
- **Encapsulation**: Business logic in well-defined classes/services, not scattered formulas
- **Flexibility**: Strategies are pluggable; recommendations vs actual usage are separate

---

## Entity Relationships

```
┌─────────────────┐
│    Strategy     │
│ ─────────────── │
│ name            │
│ pe_method       │
│ sl_method       │
│ tp_method       │
└────────┬────────┘
         │
    ┌────┴─────────────────────┐
    │ recommended              │ actual (locked)
    ▼                          ▼
┌─────────────────┐       ┌─────────────────┐
│     Ticker      │       │      Trade      │
│ ─────────────── │       │ ─────────────── │
│ symbol (PK)     │       │ id (PK)         │
│ name            │       │ ticker (FK)     │
│ probability     │       │ strategy (FK)   │
│ bias            │       │ status          │
│ horizon         │       │ entry/sl/tp     │
│ beta            │       │ units, amount   │
│ strategy (FK)   │───┐   │ dates           │
└────────┬────────┘   │   └─────────────────┘
         │            │
         │ 1:N        └─── Ticker.strategy = recommendation
         ▼                 Trade.strategy = what was actually used
┌─────────────────┐
│   MarketData    │
│ ─────────────── │
│ ticker (FK)     │
│ date            │
│ open            │
│ high            │
│ low             │
│ close           │
└─────────────────┘
```

---

## Entities

### Strategy

Defines *how* to trade - the methodology for entry, stop-loss, and take-profit.

| Field | Type | Description |
|-------|------|-------------|
| id | int | Primary key |
| name | string | e.g., "Swing_82", "Breakout", "Pullback" |
| pe_method | string | Entry methodology (e.g., "technical_confirmation", "breakout") |
| sl_method | string | Stop-loss methodology (e.g., "below_support", "atr_based") |
| tp_method | string | Take-profit methodology (e.g., "1.5R", "trailing", "resistance") |
| description | text | Human-readable explanation |

### Ticker

A tradeable instrument with associated metadata and a recommended strategy.

| Field | Type | Description |
|-------|------|-------------|
| symbol | string (PK) | e.g., "NVDA", "ASML" |
| name | string | Company name |
| probability | float | AI/analysis success probability (0-1) |
| bias | enum | "long", "short", "neutral" |
| horizon | string | Time horizon (e.g., "2-6 weeks") |
| beta | enum | "low", "medium", "high" |
| strategy_id | FK | Recommended strategy for this ticker |

### MarketData

Daily price data for a ticker.

| Field | Type | Description |
|-------|------|-------------|
| id | int | Primary key |
| ticker | FK | Reference to Ticker |
| date | date | Trading date |
| open | float | Opening price |
| high | float | High price |
| low | float | Low price |
| close | float | Closing price |

### Trade

A position tracked through its lifecycle (Plan → Open → Close).

| Field | Type | Description |
|-------|------|-------------|
| id | int | Primary key |
| number | int | Trade number (assigned on close) |
| ticker | FK | Reference to Ticker |
| strategy_id | FK | Strategy actually used (locked at creation) |
| status | enum | "plan", "open", "close" |
| amount | float | Total capital allocated |
| units | int | Number of shares/contracts |
| entry_price | float | Planned/actual entry price |
| stop_loss | float | Stop-loss price |
| take_profit | float | Take-profit price |
| date_planned | date | When trade was planned |
| date_actual | date | When position was opened |
| exit_date | date | When position was closed |
| exit_type | enum | "sl" (stop-loss) or "tp" (take-profit) |
| exit_price | float | Actual exit price |

#### Calculated Properties

| Property | Formula | Description |
|----------|---------|-------------|
| risk_abs | (stop_loss - entry_price) * units | Absolute risk in currency |
| risk_pct | risk_abs / amount | Risk as percentage of capital |
| profit_abs | (take_profit - entry_price) * units | Potential profit in currency |
| profit_pct | profit_abs / amount | Profit as percentage of capital |
| ratio | profit_abs / abs(risk_abs) | Reward-to-risk ratio |
| distance_to_sl | (current_price / stop_loss) - 1 | How far price is from SL |
| distance_to_tp | (current_price / take_profit) - 1 | How far price is from TP |

---

## Trade Lifecycle

```
┌─────────┐     execute()     ┌─────────┐     close()      ┌─────────┐
│  PLAN   │ ────────────────▶ │  OPEN   │ ───────────────▶ │  CLOSE  │
└─────────┘                   └─────────┘                  └─────────┘
                                   │
 Intent to enter               Position active            Realized P&L
 - Set PE/SL/TP                - Capital at risk          - Win or Loss
 - Choose strategy             - Monitor vs SL/TP         - Locked record
```

### Status Transitions

| From | To | Trigger | Fields Set |
|------|----|---------|------------|
| plan | open | User executes | date_actual |
| open | close | Price hits SL/TP or manual | exit_date, exit_type, exit_price, number |

---

## Filtered Views (UI)

Instead of separate tables, we filter the Trade entity:

| View | Filter | Purpose |
|------|--------|---------|
| Pipeline | status = "plan" | Upcoming trade ideas |
| Positions | status = "open" | Active risk monitoring |
| History | status = "close" | Performance analysis |
| Winners | status = "close" AND exit_type = "tp" | Successful trades |
| Losers | status = "close" AND exit_type = "sl" | Failed trades |

---

## Services (Business Logic)

### PositionSizer
```python
def calculate_units(amount: float, entry: float, stop_loss: float, risk_pct: float) -> int:
    """Determine position size based on risk tolerance."""
```

### RiskCalculator
```python
def calculate_risk(trade: Trade) -> RiskMetrics:
    """Compute risk_abs, risk_pct, ratio, etc."""
```

### SignalGenerator
```python
def apply_strategy(ticker: Ticker, strategy: Strategy, market_data: MarketData) -> TradeSignal:
    """Generate PE/SL/TP based on strategy rules and current market data."""
```

---

## Next Steps

1. **Extend data model**: Add Strategy entity and relationships
2. **Add MarketData**: Table + import from external source
3. **Strategy service**: Encapsulate PE/SL/TP calculation logic
4. **Trade transitions**: API endpoints for execute() and close()
5. **Filtered views**: Frontend components for each status view
