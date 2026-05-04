"""Multi-currency tests for fund_service.

Covers compute_balance, check_trade_allowed, and create_withdrawal when events
or trade amounts are in a currency other than the user's base.
"""

from datetime import date

import pytest
from sqlalchemy.orm import Session

from asistrader.models.db import (
    FxRate,
    Strategy,
    Ticker,
    Trade,
    TradeStatus,
    User,
    UserFundSettings,
)
from asistrader.services.fund_service import (
    FundError,
    check_trade_allowed,
    compute_balance,
    create_deposit,
    create_withdrawal,
    update_base_currency,
)


@pytest.fixture
def fx_eur_at_110(db_session: Session) -> None:
    """Seed an EUR/USD rate of 1.10 on 2026-05-01 (and today, for guards)."""
    db_session.add_all([
        FxRate(currency="EUR", date=date(2026, 5, 1), rate_to_usd=1.10),
        FxRate(currency="EUR", date=date.today(), rate_to_usd=1.10),
    ])
    db_session.commit()


def test_compute_balance_mixed_currencies_base_usd(
    db_session: Session, sample_user: User, fx_eur_at_110: None
) -> None:
    """USD deposit + EUR deposit → equity reported in USD (default base)."""
    create_deposit(db_session, sample_user.id, 1000.0)  # default USD
    create_deposit(
        db_session,
        sample_user.id,
        500.0,
        currency="EUR",
        event_date=date(2026, 5, 1),
    )

    balance = compute_balance(db_session, sample_user.id)
    # 1000 USD + 500 EUR × 1.10 = 1550 USD
    assert balance["equity"] == pytest.approx(1550.0)
    assert balance["base_currency"] == "USD"


def test_compute_balance_base_eur_converts_usd_legs(
    db_session: Session, sample_user: User, fx_eur_at_110: None
) -> None:
    """Switching base to EUR re-renders existing USD events in EUR."""
    create_deposit(db_session, sample_user.id, 1100.0)  # USD
    update_base_currency(db_session, sample_user.id, "EUR")

    balance = compute_balance(db_session, sample_user.id)
    # 1100 USD ÷ 1.10 = 1000 EUR
    assert balance["equity"] == pytest.approx(1000.0)
    assert balance["base_currency"] == "EUR"


def test_check_trade_allowed_converts_eur_trade_to_base(
    db_session: Session, sample_user: User, fx_eur_at_110: None
) -> None:
    """A €1000 trade against $1500 USD funds: should be allowed (€1000 ≈ $1100)."""
    create_deposit(db_session, sample_user.id, 1500.0)  # USD

    # Loosen the per-trade cap so the available check is the gate we exercise.
    settings = UserFundSettings(user_id=sample_user.id, risk_pct=1.0)
    db_session.add(settings)
    db_session.commit()

    # Should not raise: €1000 → $1100 ≤ $1500 available.
    check_trade_allowed(db_session, sample_user.id, 1000.0, trade_currency="EUR")


def test_check_trade_allowed_rejects_when_eur_exceeds_usd_available(
    db_session: Session, sample_user: User, fx_eur_at_110: None
) -> None:
    """A €1500 trade against $1500 USD funds is rejected (€1500 ≈ $1650 > $1500)."""
    create_deposit(db_session, sample_user.id, 1500.0)  # USD
    settings = UserFundSettings(user_id=sample_user.id, risk_pct=1.0)
    db_session.add(settings)
    db_session.commit()

    # With risk_pct=1.0 the max-per-trade and available checks both stop
    # this. Either error is a valid rejection — match the converted amount.
    with pytest.raises(FundError, match="1650"):
        check_trade_allowed(db_session, sample_user.id, 1500.0, trade_currency="EUR")


def test_withdrawal_in_eur_against_usd_balance(
    db_session: Session, sample_user: User, fx_eur_at_110: None
) -> None:
    """Withdraw €500 against $1000 USD — converts to $550, which is allowed."""
    create_deposit(db_session, sample_user.id, 1000.0)  # USD
    event = create_withdrawal(
        db_session, sample_user.id, 500.0, currency="EUR"
    )
    assert event.amount == 500.0
    assert event.currency == "EUR"


def test_withdrawal_in_eur_rejected_when_exceeds_base(
    db_session: Session, sample_user: User, fx_eur_at_110: None
) -> None:
    """€1000 withdrawal against $1000 USD: €1000 → $1100 > $1000 available."""
    create_deposit(db_session, sample_user.id, 1000.0)
    with pytest.raises(FundError, match="Insufficient funds"):
        create_withdrawal(db_session, sample_user.id, 1000.0, currency="EUR")


# ── Safety nets when FX history is missing or incomplete ──


def test_compute_balance_skips_event_with_missing_fx(
    db_session: Session, sample_user: User
) -> None:
    """An EUR event without a corresponding FX rate is skipped (warning logged)
    rather than crashing the balance read. Matches frontend behavior.
    """
    create_deposit(db_session, sample_user.id, 1000.0)  # USD, no FX needed
    create_deposit(
        db_session,
        sample_user.id,
        500.0,
        currency="EUR",
        event_date=date(2024, 1, 15),  # No FX rate seeded for this date
    )

    balance = compute_balance(db_session, sample_user.id)
    # EUR event silently skipped — equity reflects only the USD deposit.
    assert balance["equity"] == pytest.approx(1000.0)


def test_compute_balance_does_not_crash_with_only_eur_and_no_fx(
    db_session: Session, sample_user: User
) -> None:
    """All events EUR but no FX → balance is zero (skipped), not a 500."""
    create_deposit(
        db_session,
        sample_user.id,
        500.0,
        currency="EUR",
        event_date=date(2024, 1, 15),
    )
    balance = compute_balance(db_session, sample_user.id)
    assert balance["equity"] == pytest.approx(0.0)


def test_withdrawal_returns_clean_error_when_fx_missing(
    db_session: Session, sample_user: User
) -> None:
    """EUR withdrawal with no FX history returns a FundError with a clear
    message (mapped to HTTP 400), not a 500."""
    create_deposit(db_session, sample_user.id, 1000.0)
    with pytest.raises(FundError, match="FX rate"):
        create_withdrawal(db_session, sample_user.id, 100.0, currency="EUR")


def test_check_trade_allowed_returns_clean_error_when_fx_missing(
    db_session: Session, sample_user: User
) -> None:
    """Order/open of an EUR trade with no FX → FundError with clear message."""
    from asistrader.services.fund_service import check_trade_allowed

    create_deposit(db_session, sample_user.id, 10000.0)
    settings = UserFundSettings(user_id=sample_user.id, risk_pct=1.0)
    db_session.add(settings)
    db_session.commit()

    with pytest.raises(FundError, match="FX rate"):
        check_trade_allowed(db_session, sample_user.id, 100.0, trade_currency="EUR")
