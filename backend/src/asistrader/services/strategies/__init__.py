"""Automated trading strategies: backtest sweeps that draft trades.

See docs/automated-strategies.md for the design. The first engine,
``historical_expected_days``, runs a triple-barrier historical sweep to
recommend a holding/target horizon (D2) for a ticker.
"""
