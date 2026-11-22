# AsisTrader

AsisTrader tracks a trader's operations through their lifecycle and measures instruments, groups of instruments and holdings so the trader can decide where capital should go.

## Holdings

**Portfolio**:
A named collection of the user's long-term Holdings, tracked and measured as one over time. Separate from Trades. A user may have several.
_Avoid_: Account, book

**Transaction**:
A dated Buy or Sell of an instrument within a Portfolio. The Portfolio's history is the replay of its Transactions.
_Avoid_: Trade, operation, order

**Holding**:
The units of one instrument a Portfolio owns on a given day, as left by its Transactions.
_Avoid_: Position (reserved for Trades), stake

**Portfolio Value**:
The market value of a Portfolio's Holdings on a given day, expressed in the Portfolio's currency. Excludes cash.
_Avoid_: Saldo, balance, equity

**Invested**:
The total cost of a Portfolio's Holdings on a given day.
_Avoid_: Inversión, capital

**Lot**:
The units bought in one Buy, with their date and cost (fees included). Sells consume the oldest Lots first.
_Avoid_: Tranche, batch

**Split**:
A Transaction that multiplies the units of every Lot of an instrument without changing their cost.

**Unrealized Gain**:
Portfolio Value minus Invested, in absolute terms or relative to Invested.
_Avoid_: Plusvalía, P&L (when meaning the portfolio-level figure)

**Realized Gain**:
The accumulated result of Sells: proceeds net of fees minus the cost of the Lots they consumed.

**Total Gain**:
Unrealized Gain plus Realized Gain.

**Weighted Days Open**:
The average age of a Portfolio's remaining Lots, each weighted by its cost.
_Avoid_: Días promedio, average aging

**Simple TIR**:
Relative Unrealized Gain annualised linearly over Weighted Days Open. Kept for continuity with the user's spreadsheet; XIRR is the accurate figure.
_Avoid_: TIR anualizada (when meaning XIRR)

**Asset Class**:
How a Holding is grouped for reporting: Domestic Stock, International Stock or ETF. Domestic means listed in the user's Home Market.
_Avoid_: Category, type (alone)

**Home Market**:
The country a user considers domestic when classifying stocks.

**Performance Index**:
A Portfolio's daily returns with the effect of Buys and Sells removed, chained from 100. It is what gets measured and compared against Baskets and benchmarks.
_Avoid_: Equity curve, NAV

## Measurement

**Basket**:
A named group of instruments measured as a single unit, to compare against other Baskets when deciding where to rotate capital. Either **Curated** (made by us, visible to all, read-only) or **Personal** (made and seen by one user).
_Avoid_: Family, group, watchlist, theme

**Basket Index**:
The single price series that represents a Basket: its members' daily returns averaged with equal weight, chained from 100.

**Momentum Score**:
A weighted blend of an instrument's 1-month, 3-month, 6-month and 1-year price returns (0.35 / 0.30 / 0.20 / 0.15).

**Rotation**:
Moving capital from one Basket to another based on how they measure. The app measures and ranks; the user decides and acts.
