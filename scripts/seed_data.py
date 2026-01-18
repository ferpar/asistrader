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

from asistrader.models.db import Base, Ticker, Trade, TradeStatus

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

        # Create sample tickers
        tickers = [
            Ticker(
                symbol="ASML",
                name="ASML Holding N.V.",
                ai_success_probability=0.75,
                trend_mean_growth=0.12,
                trend_std_deviation=0.05,
            ),
            Ticker(
                symbol="NVDA",
                name="NVIDIA Corporation",
                ai_success_probability=0.82,
                trend_mean_growth=0.18,
                trend_std_deviation=0.08,
            ),
            Ticker(
                symbol="MSFT",
                name="Microsoft Corporation",
                ai_success_probability=0.70,
                trend_mean_growth=0.10,
                trend_std_deviation=0.04,
            ),
            Ticker(
                symbol="AAPL",
                name="Apple Inc.",
                ai_success_probability=0.68,
                trend_mean_growth=0.08,
                trend_std_deviation=0.03,
            ),
            Ticker(
                symbol="GOOGL",
                name="Alphabet Inc.",
                ai_success_probability=0.72,
                trend_mean_growth=0.11,
                trend_std_deviation=0.05,
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
