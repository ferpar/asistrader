#!/usr/bin/env python3
"""Seed the database with sample trading data.

Usage:
    python scripts/seed_data.py

Or with a custom database URL:
    DATABASE_URL=postgresql://... python scripts/seed_data.py
"""

import os
import sys
from datetime import date

# Add backend src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend", "src"))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from asistrader.models.db import Base, Bias, Strategy, Ticker, Trade, TradeStatus

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://asistrader:asistrader@localhost:5432/asistrader",
)


def seed_database():
    """Seed the database with sample data."""
    engine = create_engine(DATABASE_URL)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    # Create tables if they don't exist
    Base.metadata.create_all(bind=engine)

    session = SessionLocal()

    try:
        # Check if data already exists
        existing_tickers = session.query(Ticker).count()
        if existing_tickers > 0:
            print("Database already has data. Skipping seed.")
            return

        # Create sample strategies
        strategies = [
            Strategy(
                name="Swing_82",
                pe_method="Breakout above resistance with volume confirmation",
                sl_method="Below recent swing low",
                tp_method="2R target",
                description="Swing trading strategy with 82% historical win rate",
            ),
            Strategy(
                name="Pullback",
                pe_method="Entry on pullback to 20 EMA in uptrend",
                sl_method="Below pullback low",
                tp_method="Previous high or 1.5R",
                description="Trend continuation pullback strategy",
            ),
            Strategy(
                name="Breakout",
                pe_method="Break of consolidation range with volume",
                sl_method="Below consolidation low",
                tp_method="Measured move equal to range height",
                description="Range breakout momentum strategy",
            ),
        ]

        session.add_all(strategies)
        session.commit()
        print(f"Created {len(strategies)} strategies")

        # Get strategy IDs for reference
        swing_strategy = session.query(Strategy).filter_by(name="Swing_82").first()
        pullback_strategy = session.query(Strategy).filter_by(name="Pullback").first()
        breakout_strategy = session.query(Strategy).filter_by(name="Breakout").first()

        # Create sample tickers
        tickers = [
            Ticker(
                symbol="ASML",
                name="ASML Holding N.V.",
                probability=0.75,
                trend_mean_growth=0.12,
                trend_std_deviation=0.05,
                bias=Bias.LONG,
                horizon="swing",
                strategy_id=swing_strategy.id,
            ),
            Ticker(
                symbol="NVDA",
                name="NVIDIA Corporation",
                probability=0.82,
                trend_mean_growth=0.18,
                trend_std_deviation=0.08,
                bias=Bias.LONG,
                horizon="swing",
                strategy_id=breakout_strategy.id,
            ),
            Ticker(
                symbol="MSFT",
                name="Microsoft Corporation",
                probability=0.70,
                trend_mean_growth=0.10,
                trend_std_deviation=0.04,
                bias=Bias.LONG,
                horizon="position",
                strategy_id=pullback_strategy.id,
            ),
            Ticker(
                symbol="AAPL",
                name="Apple Inc.",
                probability=0.68,
                trend_mean_growth=0.08,
                trend_std_deviation=0.03,
                bias=Bias.NEUTRAL,
                horizon="swing",
            ),
            Ticker(
                symbol="GOOGL",
                name="Alphabet Inc.",
                probability=0.72,
                trend_mean_growth=0.11,
                trend_std_deviation=0.05,
                bias=Bias.LONG,
                horizon="swing",
                strategy_id=swing_strategy.id,
            ),
        ]

        session.add_all(tickers)
        session.commit()
        print(f"Created {len(tickers)} tickers")

        # Create sample trades
        trades = [
            Trade(
                number=1,
                ticker="ASML",
                status=TradeStatus.CLOSE,
                amount=5000.0,
                units=7,
                entry_price=714.28,
                stop_loss=680.0,
                take_profit=800.0,
                date_planned=date(2025, 1, 5),
                date_actual=date(2025, 1, 6),
                exit_date=date(2025, 1, 15),
                exit_type="tp",
                exit_price=795.0,
                strategy_id=swing_strategy.id,
            ),
            Trade(
                number=2,
                ticker="NVDA",
                status=TradeStatus.OPEN,
                amount=3000.0,
                units=25,
                entry_price=120.0,
                stop_loss=110.0,
                take_profit=145.0,
                date_planned=date(2025, 1, 10),
                date_actual=date(2025, 1, 11),
                strategy_id=breakout_strategy.id,
            ),
            Trade(
                number=3,
                ticker="MSFT",
                status=TradeStatus.OPEN,
                amount=4000.0,
                units=10,
                entry_price=400.0,
                stop_loss=380.0,
                take_profit=450.0,
                date_planned=date(2025, 1, 12),
                date_actual=date(2025, 1, 12),
                strategy_id=pullback_strategy.id,
            ),
            Trade(
                ticker="AAPL",
                status=TradeStatus.PLAN,
                amount=2500.0,
                units=12,
                entry_price=208.33,
                stop_loss=195.0,
                take_profit=235.0,
                date_planned=date(2025, 1, 20),
            ),
            Trade(
                ticker="GOOGL",
                status=TradeStatus.PLAN,
                amount=3500.0,
                units=20,
                entry_price=175.0,
                stop_loss=165.0,
                take_profit=200.0,
                date_planned=date(2025, 1, 22),
                strategy_id=swing_strategy.id,
            ),
            Trade(
                number=4,
                ticker="NVDA",
                status=TradeStatus.CLOSE,
                amount=2000.0,
                units=18,
                entry_price=111.11,
                stop_loss=100.0,
                take_profit=130.0,
                date_planned=date(2024, 12, 15),
                date_actual=date(2024, 12, 16),
                exit_date=date(2024, 12, 28),
                exit_type="sl",
                exit_price=101.0,
                strategy_id=breakout_strategy.id,
            ),
            # Additional trades for better demonstration
            Trade(
                number=5,
                ticker="AAPL",
                status=TradeStatus.OPEN,
                amount=3000.0,
                units=15,
                entry_price=200.0,
                stop_loss=190.0,
                take_profit=225.0,
                date_planned=date(2025, 1, 15),
                date_actual=date(2025, 1, 16),
            ),
            Trade(
                number=6,
                ticker="GOOGL",
                status=TradeStatus.CLOSE,
                amount=4000.0,
                units=22,
                entry_price=181.82,
                stop_loss=170.0,
                take_profit=210.0,
                date_planned=date(2024, 11, 20),
                date_actual=date(2024, 11, 21),
                exit_date=date(2024, 12, 5),
                exit_type="tp",
                exit_price=208.0,
                strategy_id=swing_strategy.id,
            ),
            Trade(
                ticker="MSFT",
                status=TradeStatus.PLAN,
                amount=5000.0,
                units=12,
                entry_price=416.67,
                stop_loss=400.0,
                take_profit=460.0,
                date_planned=date(2025, 1, 25),
                strategy_id=pullback_strategy.id,
            ),
            Trade(
                number=7,
                ticker="ASML",
                status=TradeStatus.OPEN,
                amount=6000.0,
                units=8,
                entry_price=750.0,
                stop_loss=720.0,
                take_profit=820.0,
                date_planned=date(2025, 1, 18),
                date_actual=date(2025, 1, 19),
                strategy_id=swing_strategy.id,
            ),
            Trade(
                number=8,
                ticker="NVDA",
                status=TradeStatus.CLOSE,
                amount=4500.0,
                units=35,
                entry_price=128.57,
                stop_loss=120.0,
                take_profit=150.0,
                date_planned=date(2024, 10, 1),
                date_actual=date(2024, 10, 2),
                exit_date=date(2024, 10, 20),
                exit_type="tp",
                exit_price=148.0,
                strategy_id=breakout_strategy.id,
            ),
            Trade(
                ticker="AAPL",
                status=TradeStatus.PLAN,
                amount=2000.0,
                units=10,
                entry_price=200.0,
                stop_loss=185.0,
                take_profit=230.0,
                date_planned=date(2025, 2, 1),
            ),
        ]

        session.add_all(trades)
        session.commit()
        print(f"Created {len(trades)} trades")

        print("Database seeded successfully!")

    except Exception as e:
        session.rollback()
        print(f"Error seeding database: {e}")
        raise
    finally:
        session.close()


if __name__ == "__main__":
    seed_database()
