"""Smoke tests for `asistrader.cli.detect`.

These don't exercise the SessionLocal/DATABASE_URL path — they wire the
in-memory test session into `main()` directly. The CLI's database wiring is
a thin call to `SessionLocal()` and gets exercised manually in dev.
"""

import json
from datetime import date

import pytest
from sqlalchemy.orm import Session

from asistrader.cli.detect import main
from asistrader.models.db import ExitLevelType, MarketData, Ticker, Trade


def _add_bar(
    db: Session, ticker: Ticker, bar_date: date,
    *, open: float, high: float, low: float, close: float,
) -> None:
    db.add(MarketData(
        ticker=ticker.symbol, date=bar_date,
        open=open, high=high, low=low, close=close, volume=1_000_000.0,
    ))
    db.commit()


class TestDetectCli:
    def test_trade_not_found_returns_2(
        self, db_session: Session, capsys: pytest.CaptureFixture[str]
    ) -> None:
        rc = main(["99999"], session=db_session)
        assert rc == 2
        err = capsys.readouterr().err
        assert "not found" in err

    def test_sltp_hit_renders_table_and_verdict(
        self,
        db_session: Session,
        sample_trade: Trade,
        sample_ticker: Ticker,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        # sample_trade: long, SL=95, TP=115, date_actual=2025-01-16.
        _add_bar(
            db_session, sample_ticker, date(2025, 1, 17),
            open=100, high=101, low=90, close=95,
        )

        rc = main([str(sample_trade.id)], session=db_session)
        assert rc == 0
        out = capsys.readouterr().out
        assert f"Trade #{sample_trade.id}" in out
        assert "detector=sltp" in out
        assert "2025-01-17" in out
        # Pierced SL with no gap should render '✓'.
        assert "✓" in out
        assert "SL hit on 2025-01-17" in out

    def test_json_output_is_parseable(
        self,
        db_session: Session,
        sample_trade: Trade,
        sample_ticker: Ticker,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        _add_bar(
            db_session, sample_ticker, date(2025, 1, 17),
            open=100, high=101, low=90, close=95,
        )

        rc = main([str(sample_trade.id), "--json"], session=db_session)
        assert rc == 0
        payload = json.loads(capsys.readouterr().out)
        assert payload["kind"] == "sltp"
        assert payload["trade_id"] == sample_trade.id
        assert len(payload["bars"]) == 1
        bar = payload["bars"][0]
        assert bar["date"] == "2025-01-17"
        assert bar["decision"] == "hit"
        assert bar["chosen_keys"] == ["sl"]

    def test_layered_trade_routes_to_layered_detector(
        self,
        db_session: Session,
        sample_layered_long_trade: Trade,
        sample_ticker: Ticker,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        _add_bar(
            db_session, sample_ticker, date(2025, 1, 17),
            open=100, high=125, low=99, close=124,
        )
        rc = main([str(sample_layered_long_trade.id)], session=db_session)
        assert rc == 0
        out = capsys.readouterr().out
        assert "detector=layered" in out
        # Layered scans expose multiple level columns (sl:1, tp:1, ...).
        assert "tp:1" in out and "tp:2" in out

    def test_margin_override(
        self,
        db_session: Session,
        sample_trade: Trade,
        sample_ticker: Ticker,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        # Bar that grazes SL=95 at low=94.7 — with default 0.5% margin this
        # is NOT a hit (threshold 94.525). With --margin 0 it IS.
        _add_bar(
            db_session, sample_ticker, date(2025, 1, 17),
            open=100, high=101, low=94.7, close=95,
        )

        rc = main([str(sample_trade.id), "--margin", "0"], session=db_session)
        assert rc == 0
        out = capsys.readouterr().out
        assert "SL hit on 2025-01-17" in out
        assert "margin=0" in out


class TestDetectCliWhatIf:
    """`--sl`, `--tp`, `--entry`, `--opened`, `--planned` mutate in-session
    only — the DB row must be unchanged after the CLI returns."""

    def test_sl_what_if_changes_verdict_without_persisting(
        self,
        db_session: Session,
        sample_trade: Trade,
        sample_ticker: Ticker,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        # Bar that does NOT touch SL=95 but WOULD touch SL=98.
        _add_bar(
            db_session, sample_ticker, date(2025, 1, 17),
            open=100, high=101, low=97, close=99,
        )

        # Live verdict: no hit
        rc = main([str(sample_trade.id)], session=db_session)
        assert rc == 0
        assert "no hit" in capsys.readouterr().out

        # What-if SL=98 -> hit
        rc = main(
            [str(sample_trade.id), "--sl", "98"], session=db_session,
        )
        assert rc == 0
        out = capsys.readouterr().out
        assert "WHAT-IF" in out
        assert "SL hit on 2025-01-17" in out

        # DB unchanged: reload the row and confirm SL price is still 95.
        db_session.expire_all()
        reloaded = db_session.get(Trade, sample_trade.id)
        sl = next(
            l for l in reloaded.exit_levels if l.level_type == ExitLevelType.SL
        )
        assert sl.price == 95.0

    def test_opened_what_if_shifts_scan_window(
        self,
        db_session: Session,
        sample_trade: Trade,
        sample_ticker: Ticker,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        # Bar on 2025-01-17 with intraday SL pierce (open above SL at 100,
        # low dips to 90). With live date_actual=2025-01-16 this is a clean
        # INTRADAY hit on the next bar.
        _add_bar(
            db_session, sample_ticker, date(2025, 1, 17),
            open=100, high=101, low=90, close=92,
        )

        # Shift date_actual to 2025-01-17: the bar is now the open day; the
        # intraday touch becomes UNVERIFIABLE (we can't tell pre/post entry).
        rc = main(
            [str(sample_trade.id), "--opened", "2025-01-17"],
            session=db_session,
        )
        assert rc == 0
        out = capsys.readouterr().out
        assert "WHAT-IF" in out
        assert "opened=2025-01-17" in out
        assert "unverifiable" in out

        # DB still has original date_actual.
        db_session.expire_all()
        reloaded = db_session.get(Trade, sample_trade.id)
        assert reloaded.date_actual == date(2025, 1, 16)

    def test_what_if_sl_rejected_when_multiple_sls(
        self,
        db_session: Session,
        sample_layered_long_trade: Trade,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        # sample_layered_long_trade has one SL but multiple TPs; --tp on it
        # should fail with a clear error.
        rc = main(
            [str(sample_layered_long_trade.id), "--tp", "200"],
            session=db_session,
        )
        assert rc == 2
        err = capsys.readouterr().err
        assert "needs exactly one TP level" in err
