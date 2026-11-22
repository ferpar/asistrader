# A Portfolio has its own Transactions, separate from Trades

The user's long-term holdings have no stop loss or take profit, are added to over time, and can hold fractional units, while a Trade is a swing-trading lifecycle built around mandatory exit levels. We decided a Portfolio records its own Buy/Sell Transactions and derives its Holdings from them, sharing only tickers, market data, FX rates and the measurement code with the rest of AsisTrader. Trades and Portfolios never reference each other.

## Considered Options

- **A Portfolio groups existing Trades**: no double entry, but Trades require SL/TP, and holdings would trigger SL/TP detection and pollute risk, IRR and screening statistics built for swing trades.
- **Trades with optional exits, flagged as holdings**: every Trade consumer would need to learn to skip them, a broad and fragile change.
