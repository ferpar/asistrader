"""Trade detection service for auto-open and auto-close functionality."""

from dataclasses import dataclass
from datetime import date

from sqlalchemy.orm import Session

from asistrader.models.db import (
    AlertDismissal,
    AlertKind,
    ExitLevel,
    ExitLevelStatus,
    ExitLevelType,
    ExitType,
    MarketData,
    OrderType,
    Trade,
    TradeStatus,
)
from asistrader.models.schemas import EntryAlert, EntryHitType, SLTPAlert, SLTPHitType, LayeredAlert
from asistrader.services.sltp_detection_trace import BarEval, LevelCheck, ScanTrace


# Kill switch: flip to True to re-enable automatic trade open/close.
# While False, alerts still fire but auto_open_trade / auto_close_trade
# side effects are skipped.
AUTO_TRADE_ENABLED = False

# Default confirmation buffer: a candle must penetrate an SL/TP/entry level
# by this fraction before a hit is confirmed. This suppresses grazes within
# the noise band between data sources (Yahoo vs. TradingView), trading away
# some genuine near-touches for fewer false positives. The per-user setting
# (user_fund_settings.detection_margin_pct) overrides this; the constant is
# the fallback for callers/tests that don't supply a margin.
DETECTION_MARGIN_PCT = 0.005


@dataclass
class SLTPHit:
    """Represents an SL/TP hit detection result."""

    hit_type: SLTPHitType
    hit_date: date
    hit_price: float


@dataclass
class EntryHit:
    """Represents an entry price hit detection result."""

    hit_date: date
    entry_price: float


@dataclass
class LayeredLevelHit:
    """Represents a layered exit level hit detection result."""

    level: ExitLevel
    hit_date: date
    units_to_close: int


def is_long_trade(trade: Trade) -> bool:
    """
    Determine if a trade is a long position.

    Long: SL < entry price (protecting against price drop)
    Short: SL > entry price (protecting against price rise)
    """
    return trade.stop_loss < trade.entry_price


def check_sltp_hit_for_day(
    trade: Trade, market_day: MarketData, margin: float = DETECTION_MARGIN_PCT
) -> SLTPHitType | None:
    """
    Check if SL or TP was hit on a specific market day.

    A `margin` confirmation buffer requires the candle to penetrate the level
    by that fraction before the hit counts (see DETECTION_MARGIN_PCT).

    For long positions:
      - SL hit if low <= stop_loss * (1 - margin)
      - TP hit if high >= take_profit * (1 + margin)

    For short positions:
      - SL hit if high >= stop_loss * (1 + margin)
      - TP hit if low <= take_profit * (1 - margin)

    Returns:
      - SLTPHitType.SL if only SL hit
      - SLTPHitType.TP if only TP hit
      - SLTPHitType.BOTH if both hit on the same day
      - None if neither hit
    """
    if market_day.low is None or market_day.high is None:
        return None

    long = is_long_trade(trade)

    if long:
        sl_hit = market_day.low <= trade.stop_loss * (1 - margin)
        tp_hit = market_day.high >= trade.take_profit * (1 + margin)
    else:
        sl_hit = market_day.high >= trade.stop_loss * (1 + margin)
        tp_hit = market_day.low <= trade.take_profit * (1 - margin)

    if sl_hit and tp_hit:
        return SLTPHitType.BOTH
    elif sl_hit:
        return SLTPHitType.SL
    elif tp_hit:
        return SLTPHitType.TP
    return None


def detect_sltp_hit(
    db: Session, trade: Trade, margin: float = DETECTION_MARGIN_PCT
) -> SLTPHit | None:
    """
    Scan market data strictly after trade's date_actual to find first SL/TP hit.

    The open day itself is skipped: with daily candles we can't tell at what
    point of the day the position was opened, so a same-day low/high may
    have occurred before the entry.

    Returns the first hit found, or None if no hit detected.
    """
    hit, _ = detect_sltp_hit_with_trace(db, trade, margin)
    return hit


def detect_sltp_hit_with_trace(
    db: Session, trade: Trade, margin: float = DETECTION_MARGIN_PCT
) -> tuple[SLTPHit | None, ScanTrace]:
    """
    Same as `detect_sltp_hit` but also returns a `ScanTrace` recording each
    bar that was evaluated, what the SL/TP thresholds were on that bar, which
    side(s) were pierced, and how the decision was made. The hit return value
    is byte-for-byte identical to `detect_sltp_hit` — the trace is purely
    additive diagnostics for the CLI and tests.
    """
    side = "long" if is_long_trade(trade) else "short"
    trace = ScanTrace(
        kind="sltp",
        trade_id=trade.id,
        side=side,
        margin=margin,
        scan_from=None,
        scan_to=None,
        bars_scanned=0,
        bars=[],
        verdict="",
    )

    if trade.status != TradeStatus.OPEN or trade.date_actual is None:
        trace.verdict = "skipped: trade is not OPEN or has no date_actual"
        return None, trace

    market_data = (
        db.query(MarketData)
        .filter(
            MarketData.ticker == trade.ticker,
            MarketData.date > trade.date_actual,
        )
        .order_by(MarketData.date)
        .all()
    )

    # Look up the most recent bar at or before the scan lower bound so the
    # first scanned bar has a meaningful prev_close for gap detection.
    prev_close = _prev_close_before(db, trade.ticker, trade.date_actual)

    sl_price = trade.stop_loss
    tp_price = trade.take_profit
    long = side == "long"
    sl_threshold = sl_price * (1 - margin) if long else sl_price * (1 + margin)
    tp_threshold = tp_price * (1 + margin) if long else tp_price * (1 - margin)

    hit: SLTPHit | None = None

    for day in market_data:
        trace.bars_scanned += 1
        trace.scan_to = day.date
        if trace.scan_from is None:
            trace.scan_from = day.date

        if day.low is None or day.high is None:
            trace.bars.append(BarEval(
                date=day.date, open=day.open, high=day.high, low=day.low,
                close=day.close, prev_close=prev_close, checks=[],
                decision="no_data", reason="missing_ohlc",
            ))
            prev_close = day.close
            continue

        if long:
            sl_pierced = day.low <= sl_threshold
            tp_pierced = day.high >= tp_threshold
            sl_gap = day.open is not None and day.open <= sl_threshold and (
                prev_close is None or prev_close > sl_threshold
            )
            tp_gap = day.open is not None and day.open >= tp_threshold and (
                prev_close is None or prev_close < tp_threshold
            )
        else:
            sl_pierced = day.high >= sl_threshold
            tp_pierced = day.low <= tp_threshold
            sl_gap = day.open is not None and day.open >= sl_threshold and (
                prev_close is None or prev_close < sl_threshold
            )
            tp_gap = day.open is not None and day.open <= tp_threshold and (
                prev_close is None or prev_close > tp_threshold
            )

        checks = [
            LevelCheck(
                key="sl", kind="sl", side=side,
                price=sl_price, threshold=sl_threshold,
                pierced=sl_pierced, gap=sl_gap,
            ),
            LevelCheck(
                key="tp", kind="tp", side=side,
                price=tp_price, threshold=tp_threshold,
                pierced=tp_pierced, gap=tp_gap,
            ),
        ]

        if sl_pierced and tp_pierced:
            hit = SLTPHit(hit_type=SLTPHitType.BOTH, hit_date=day.date, hit_price=sl_price)
            trace.bars.append(BarEval(
                date=day.date, open=day.open, high=day.high, low=day.low,
                close=day.close, prev_close=prev_close, checks=checks,
                decision="both_hit", chosen_keys=["sl", "tp"], reason="both_pierced",
            ))
            break
        if sl_pierced:
            hit = SLTPHit(hit_type=SLTPHitType.SL, hit_date=day.date, hit_price=sl_price)
            trace.bars.append(BarEval(
                date=day.date, open=day.open, high=day.high, low=day.low,
                close=day.close, prev_close=prev_close, checks=checks,
                decision="hit", chosen_keys=["sl"],
                reason="gap_open_past_level" if sl_gap else "intraday_touch",
            ))
            break
        if tp_pierced:
            hit = SLTPHit(hit_type=SLTPHitType.TP, hit_date=day.date, hit_price=tp_price)
            trace.bars.append(BarEval(
                date=day.date, open=day.open, high=day.high, low=day.low,
                close=day.close, prev_close=prev_close, checks=checks,
                decision="hit", chosen_keys=["tp"],
                reason="gap_open_past_level" if tp_gap else "intraday_touch",
            ))
            break

        trace.bars.append(BarEval(
            date=day.date, open=day.open, high=day.high, low=day.low,
            close=day.close, prev_close=prev_close, checks=checks,
            decision="skip",
        ))
        prev_close = day.close

    if hit is None:
        trace.verdict = f"no hit across {trace.bars_scanned} bars"
    elif hit.hit_type == SLTPHitType.BOTH:
        trace.verdict = f"BOTH SL and TP pierced on {hit.hit_date} (conflict)"
    else:
        trace.verdict = (
            f"{hit.hit_type.value.upper()} hit on {hit.hit_date} at {hit.hit_price:g}"
        )

    return hit, trace


def _prev_close_before(db: Session, ticker: str, on_or_before: date) -> float | None:
    """Most recent market_data close at or before `on_or_before` for this ticker.

    Used to seed the prev_close for the first scanned bar so we can flag a
    bar as a gap (open past the threshold from where it closed last session).
    """
    row = (
        db.query(MarketData)
        .filter(MarketData.ticker == ticker, MarketData.date <= on_or_before)
        .order_by(MarketData.date.desc())
        .first()
    )
    return row.close if row is not None else None


def auto_close_trade(
    db: Session, trade: Trade, hit: SLTPHit
) -> None:
    """
    Auto-close a trade with the SL/TP hit information.

    Only called for trades with auto_detect=True.
    Sets exit_type, exit_price, exit_date, and status=CLOSE.
    """
    if hit.hit_type == SLTPHitType.BOTH:
        # Conflict - don't auto-close
        return

    trade.exit_type = ExitType.SL if hit.hit_type == SLTPHitType.SL else ExitType.TP
    trade.exit_price = hit.hit_price
    trade.exit_date = hit.hit_date
    trade.status = TradeStatus.CLOSE
    db.commit()

    # Fund integration
    from asistrader.services.fund_service import handle_trade_close

    handle_trade_close(db, trade)


def entry_fills_on_rise(trade: Trade) -> bool:
    """
    Which side of the entry price the candle must penetrate to fill the order.

    A limit order fills when the market moves toward it favorably; a stop
    order fills on the opposite move (a breakout/breakdown through the level).
    Combined with direction:

        long  + limit -> fall to entry  (low <= entry)
        long  + stop  -> rise to entry  (high >= entry)
        short + limit -> rise to entry  (high >= entry)
        short + stop  -> fall to entry  (low <= entry)

    `order_type` of None or MARKET defaults to limit semantics, preserving the
    original detection behavior for trades created before order_type was
    persisted.
    """
    is_stop = trade.order_type == OrderType.STOP
    return is_long_trade(trade) == is_stop


def check_entry_hit_for_day(
    trade: Trade, market_day: MarketData, margin: float = DETECTION_MARGIN_PCT
) -> bool:
    """
    Check if entry price was hit on a specific market day.

    A `margin` confirmation buffer requires the candle to penetrate the entry
    price by that fraction before the hit counts (see DETECTION_MARGIN_PCT).
    The side of penetration depends on direction *and* order type — see
    `entry_fills_on_rise` for the truth table.

    Returns True if entry was hit, False otherwise.
    """
    if market_day.low is None or market_day.high is None:
        return False

    if entry_fills_on_rise(trade):
        return market_day.high >= trade.entry_price * (1 + margin)
    return market_day.low <= trade.entry_price * (1 - margin)


def detect_entry_hit(
    db: Session, trade: Trade, margin: float = DETECTION_MARGIN_PCT
) -> EntryHit | None:
    """
    Scan market data strictly after trade's date_planned to find first entry hit.

    The order day itself is skipped: with daily candles we can't tell at what
    point of the day the order was placed, so a same-day touch of the entry
    price may have occurred before the order was live.

    Only checks ORDERED trades (orders placed with a broker, waiting to be filled).

    Returns the first hit found, or None if no hit detected.
    """
    hit, _ = detect_entry_hit_with_trace(db, trade, margin)
    return hit


def detect_entry_hit_with_trace(
    db: Session, trade: Trade, margin: float = DETECTION_MARGIN_PCT
) -> tuple[EntryHit | None, ScanTrace]:
    """
    Same as `detect_entry_hit` but also returns a `ScanTrace`. The hit return
    value matches `detect_entry_hit` exactly; the trace is additive.
    """
    side = "long" if is_long_trade(trade) else "short"
    fills_on_rise = entry_fills_on_rise(trade)
    trace = ScanTrace(
        kind="entry",
        trade_id=trade.id,
        side=side,
        margin=margin,
        scan_from=None,
        scan_to=None,
        bars_scanned=0,
        bars=[],
        verdict="",
        extras={"fills_on_rise": fills_on_rise},
    )

    if trade.status != TradeStatus.ORDERED or trade.date_planned is None:
        trace.verdict = "skipped: trade is not ORDERED or has no date_planned"
        return None, trace

    market_data = (
        db.query(MarketData)
        .filter(
            MarketData.ticker == trade.ticker,
            MarketData.date > trade.date_planned,
        )
        .order_by(MarketData.date)
        .all()
    )

    prev_close = _prev_close_before(db, trade.ticker, trade.date_planned)

    entry_price = trade.entry_price
    threshold = (
        entry_price * (1 + margin) if fills_on_rise else entry_price * (1 - margin)
    )

    hit: EntryHit | None = None

    for day in market_data:
        trace.bars_scanned += 1
        trace.scan_to = day.date
        if trace.scan_from is None:
            trace.scan_from = day.date

        if day.low is None or day.high is None:
            trace.bars.append(BarEval(
                date=day.date, open=day.open, high=day.high, low=day.low,
                close=day.close, prev_close=prev_close, checks=[],
                decision="no_data", reason="missing_ohlc",
            ))
            prev_close = day.close
            continue

        if fills_on_rise:
            pierced = day.high >= threshold
            gap = day.open is not None and day.open >= threshold and (
                prev_close is None or prev_close < threshold
            )
        else:
            pierced = day.low <= threshold
            gap = day.open is not None and day.open <= threshold and (
                prev_close is None or prev_close > threshold
            )

        check = LevelCheck(
            key="entry", kind="entry", side=side,
            price=entry_price, threshold=threshold,
            pierced=pierced, gap=gap,
        )

        if pierced:
            hit = EntryHit(hit_date=day.date, entry_price=entry_price)
            trace.bars.append(BarEval(
                date=day.date, open=day.open, high=day.high, low=day.low,
                close=day.close, prev_close=prev_close, checks=[check],
                decision="hit", chosen_keys=["entry"],
                reason="gap_open_past_level" if gap else "intraday_touch",
            ))
            break

        trace.bars.append(BarEval(
            date=day.date, open=day.open, high=day.high, low=day.low,
            close=day.close, prev_close=prev_close, checks=[check],
            decision="skip",
        ))
        prev_close = day.close

    if hit is None:
        trace.verdict = f"no entry hit across {trace.bars_scanned} bars"
    else:
        trace.verdict = f"ENTRY hit on {hit.hit_date} at {hit.entry_price:g}"

    return hit, trace


def auto_open_trade(db: Session, trade: Trade, hit: EntryHit) -> None:
    """
    Auto-open an ordered trade via update_trade so fund hooks fire normally.

    Called for trades with auto_detect=True when entry price is hit.
    """
    from asistrader.services.trade_service import update_trade

    update_trade(db, trade.id, status=TradeStatus.OPEN, date_actual=hit.hit_date)


def process_ordered_trades(
    db: Session, user_id: int, margin: float = DETECTION_MARGIN_PCT
) -> tuple[list[EntryAlert], int]:
    """
    Process all ORDERED trades for a user to detect entry price hits.

    For auto_detect=True trades: auto-open when entry price is hit.
    For auto_detect=False trades: create alert only.

    Returns a tuple of:
      - entry_alerts: list of EntryAlert objects
      - auto_opened_count: number of trades auto-opened
    """
    ordered_trades = (
        db.query(Trade)
        .filter(
            Trade.user_id == user_id,
            Trade.status == TradeStatus.ORDERED,
        )
        .all()
    )

    entry_alerts: list[EntryAlert] = []
    auto_opened_count = 0

    for trade in ordered_trades:
        hit = detect_entry_hit(db, trade, margin)
        if not hit:
            continue

        auto_opened = False

        if AUTO_TRADE_ENABLED and trade.auto_detect:
            auto_open_trade(db, trade, hit)
            auto_opened = True
            auto_opened_count += 1

        entry_alerts.append(
            EntryAlert(
                trade_id=trade.id,
                ticker=trade.ticker,
                hit_type=EntryHitType.ENTRY,
                hit_date=hit.hit_date,
                entry_price=hit.entry_price,
                auto_detect=trade.auto_detect,
                auto_opened=auto_opened,
                currency=trade.ticker_rel.currency if trade.ticker_rel else None,
                price_hint=trade.ticker_rel.price_hint if trade.ticker_rel else None,
            )
        )

    return entry_alerts, auto_opened_count


def check_layered_level_hit(
    trade: Trade,
    level: ExitLevel,
    market_day: MarketData,
    margin: float = DETECTION_MARGIN_PCT,
) -> bool:
    """
    Check if a layered exit level was hit on a specific market day.

    A `margin` confirmation buffer requires the candle to penetrate the level
    by that fraction before the hit counts (see DETECTION_MARGIN_PCT).

    For long positions:
      - SL hit if low <= SL price * (1 - margin)
      - TP hit if high >= TP price * (1 + margin)

    For short positions:
      - SL hit if high >= SL price * (1 + margin)
      - TP hit if low <= TP price * (1 - margin)

    Returns True if the level was hit.
    """
    if market_day.low is None or market_day.high is None:
        return False

    long = is_long_trade(trade)

    if level.level_type == ExitLevelType.SL:
        if long:
            return market_day.low <= level.price * (1 - margin)
        else:
            return market_day.high >= level.price * (1 + margin)
    else:  # TP
        if long:
            return market_day.high >= level.price * (1 + margin)
        else:
            return market_day.low <= level.price * (1 - margin)


def detect_layered_hits(
    db: Session,
    trade: Trade,
    margin: float = DETECTION_MARGIN_PCT,
) -> list[LayeredLevelHit]:
    """
    Detect all exit level hits for a trade.

    Scans market data from trade's date_actual and checks all pending levels.
    Returns all levels that were hit (can be multiple on the same day).

    All trades have exit_levels now, so this works for both simple and layered trades.

    Args:
        db: Database session
        trade: Trade to check
        margin: Confirmation buffer fraction (see DETECTION_MARGIN_PCT)

    Returns:
        List of LayeredLevelHit objects for all hit levels
    """
    hits, _ = detect_layered_hits_with_trace(db, trade, margin)
    return hits


def detect_layered_hits_with_trace(
    db: Session,
    trade: Trade,
    margin: float = DETECTION_MARGIN_PCT,
) -> tuple[list[LayeredLevelHit], ScanTrace]:
    """
    Same as `detect_layered_hits` but also returns a `ScanTrace`.

    Each bar's `checks` list contains one `LevelCheck` per pending level that
    was evaluated on that bar (in `(level_type, order_index)` order). The
    bar's `chosen_keys` lists every level that fired on that bar, since
    layered scans can match multiple levels in a single day.
    """
    side = "long" if is_long_trade(trade) else "short"
    long = side == "long"
    trace = ScanTrace(
        kind="layered",
        trade_id=trade.id,
        side=side,
        margin=margin,
        scan_from=None,
        scan_to=None,
        bars_scanned=0,
        bars=[],
        verdict="",
    )

    if trade.status != TradeStatus.OPEN or trade.date_actual is None:
        trace.verdict = "skipped: trade is not OPEN or has no date_actual"
        return [], trace

    pending_levels = [
        l for l in trade.exit_levels if l.status == ExitLevelStatus.PENDING
    ]
    if not pending_levels:
        trace.verdict = "skipped: no pending exit levels"
        return [], trace

    market_data = (
        db.query(MarketData)
        .filter(
            MarketData.ticker == trade.ticker,
            MarketData.date > trade.date_actual,
        )
        .order_by(MarketData.date)
        .all()
    )

    prev_close = _prev_close_before(db, trade.ticker, trade.date_actual)

    hits: list[LayeredLevelHit] = []
    remaining_units = trade.remaining_units or trade.units
    fired_level_ids: set[int] = set()

    def _key(level: ExitLevel) -> str:
        return f"{level.level_type.value}:{level.order_index}"

    for day in market_data:
        trace.bars_scanned += 1
        trace.scan_to = day.date
        if trace.scan_from is None:
            trace.scan_from = day.date

        if day.low is None or day.high is None:
            trace.bars.append(BarEval(
                date=day.date, open=day.open, high=day.high, low=day.low,
                close=day.close, prev_close=prev_close, checks=[],
                decision="no_data", reason="missing_ohlc",
            ))
            prev_close = day.close
            continue

        bar_checks: list[LevelCheck] = []
        bar_chosen: list[str] = []
        sorted_levels = sorted(
            pending_levels, key=lambda l: (l.level_type.value, l.order_index)
        )

        for level in sorted_levels:
            if level.id in fired_level_ids:
                continue

            if level.level_type == ExitLevelType.SL:
                threshold = (
                    level.price * (1 - margin) if long else level.price * (1 + margin)
                )
                if long:
                    pierced = day.low <= threshold
                    gap = day.open is not None and day.open <= threshold and (
                        prev_close is None or prev_close > threshold
                    )
                else:
                    pierced = day.high >= threshold
                    gap = day.open is not None and day.open >= threshold and (
                        prev_close is None or prev_close < threshold
                    )
            else:  # TP
                threshold = (
                    level.price * (1 + margin) if long else level.price * (1 - margin)
                )
                if long:
                    pierced = day.high >= threshold
                    gap = day.open is not None and day.open >= threshold and (
                        prev_close is None or prev_close < threshold
                    )
                else:
                    pierced = day.low <= threshold
                    gap = day.open is not None and day.open <= threshold and (
                        prev_close is None or prev_close > threshold
                    )

            bar_checks.append(LevelCheck(
                key=_key(level), kind=level.level_type.value, side=side,
                price=level.price, threshold=threshold,
                pierced=pierced, gap=gap,
            ))

            if pierced and remaining_units > 0:
                units_to_close = int(trade.units * level.units_pct)
                if units_to_close < 1:
                    units_to_close = 1
                if units_to_close > remaining_units:
                    units_to_close = remaining_units

                hits.append(LayeredLevelHit(
                    level=level, hit_date=day.date, units_to_close=units_to_close,
                ))
                remaining_units -= units_to_close
                fired_level_ids.add(level.id)
                bar_chosen.append(_key(level))

        if bar_chosen:
            trace.bars.append(BarEval(
                date=day.date, open=day.open, high=day.high, low=day.low,
                close=day.close, prev_close=prev_close, checks=bar_checks,
                decision="hit", chosen_keys=bar_chosen,
                reason="multi_level" if len(bar_chosen) > 1 else "first_match",
            ))
        else:
            trace.bars.append(BarEval(
                date=day.date, open=day.open, high=day.high, low=day.low,
                close=day.close, prev_close=prev_close, checks=bar_checks,
                decision="skip",
            ))

        if remaining_units <= 0:
            break
        prev_close = day.close

    if hits:
        trace.verdict = (
            f"{len(hits)} level hit(s); remaining_units={remaining_units}"
        )
    else:
        trace.verdict = f"no level hit across {trace.bars_scanned} bars"

    return hits, trace


def process_layered_hits(
    db: Session, trade: Trade, margin: float = DETECTION_MARGIN_PCT
) -> list[LayeredLevelHit]:
    """
    Process all layered exit level hits for a trade.

    Detects hits and applies partial closes.

    Args:
        db: Database session
        trade: Trade to process
        margin: Confirmation buffer fraction (see DETECTION_MARGIN_PCT)

    Returns:
        List of processed LayeredLevelHit objects
    """
    from asistrader.services.exit_level_service import mark_level_hit

    hits = detect_layered_hits(db, trade, margin)
    if not hits:
        return []

    for hit in hits:
        # Mark level as hit
        mark_level_hit(db, hit.level.id, hit.hit_date, hit.units_to_close)

        # Update trade remaining units
        if trade.remaining_units is None:
            trade.remaining_units = trade.units
        trade.remaining_units -= hit.units_to_close

        # Move SL to breakeven if configured
        if hit.level.move_sl_to_breakeven and hit.level.level_type == ExitLevelType.TP:
            # Update all pending SL exit levels to entry price (breakeven)
            for sl_level in trade.exit_levels:
                if sl_level.level_type == ExitLevelType.SL and sl_level.status == ExitLevelStatus.PENDING:
                    sl_level.price = trade.entry_price

    # Check if trade should be fully closed
    if trade.remaining_units is not None and trade.remaining_units <= 0:
        trade.status = TradeStatus.CLOSE
        # Calculate weighted exit price from hit levels
        hit_levels = [l for l in trade.exit_levels if l.status == ExitLevelStatus.HIT]
        if hit_levels:
            total_closed = sum(l.units_closed or 0 for l in hit_levels)
            if total_closed > 0:
                weighted_price = sum(
                    (l.price * (l.units_closed or 0)) for l in hit_levels
                ) / total_closed
                trade.exit_price = weighted_price
            # Use the last hit date as exit date
            trade.exit_date = max(l.hit_date for l in hit_levels if l.hit_date)
            # Determine exit type based on majority
            tp_units = sum(l.units_closed or 0 for l in hit_levels if l.level_type == ExitLevelType.TP)
            sl_units = sum(l.units_closed or 0 for l in hit_levels if l.level_type == ExitLevelType.SL)
            trade.exit_type = ExitType.TP if tp_units >= sl_units else ExitType.SL

    db.commit()

    # Fund integration: handle trade close if fully closed
    if trade.status == TradeStatus.CLOSE:
        from asistrader.services.fund_service import handle_trade_close

        handle_trade_close(db, trade)

    return hits


def process_open_trades(
    db: Session, user_id: int, margin: float = DETECTION_MARGIN_PCT
) -> tuple[list[SLTPAlert], list[LayeredAlert], int, int, int]:
    """
    Process all OPEN trades for a user to detect SL/TP hits.

    Returns a tuple of:
      - sltp_alerts: list of SLTPAlert objects (simple trades)
      - layered_alerts: list of LayeredAlert objects (layered trades)
      - auto_closed_count: number of auto-detect trades auto-closed
      - partial_close_count: number of partial closes processed
      - conflict_count: number of trades with both SL and TP hit same day
    """
    open_trades = (
        db.query(Trade)
        .filter(
            Trade.user_id == user_id,
            Trade.status == TradeStatus.OPEN,
        )
        .all()
    )

    sltp_alerts: list[SLTPAlert] = []
    layered_alerts: list[LayeredAlert] = []
    auto_closed_count = 0
    partial_close_count = 0
    conflict_count = 0

    for trade in open_trades:
        if trade.is_layered:
            # Process layered trade
            hits = process_layered_hits(db, trade, margin)
            for hit in hits:
                partial_close_count += 1
                layered_alerts.append(
                    LayeredAlert(
                        trade_id=trade.id,
                        ticker=trade.ticker,
                        level_type=hit.level.level_type.value,
                        level_index=hit.level.order_index,
                        hit_date=hit.hit_date,
                        hit_price=hit.level.price,
                        units_closed=hit.units_to_close,
                        remaining_units=trade.remaining_units or 0,
                        auto_detect=trade.auto_detect,
                        auto_processed=trade.auto_detect,
                        currency=trade.ticker_rel.currency if trade.ticker_rel else None,
                        price_hint=trade.ticker_rel.price_hint if trade.ticker_rel else None,
                    )
                )
        else:
            # Process simple trade (existing logic)
            hit = detect_sltp_hit(db, trade, margin)
            if not hit:
                continue

            auto_closed = False

            if hit.hit_type == SLTPHitType.BOTH:
                conflict_count += 1
            elif AUTO_TRADE_ENABLED and trade.auto_detect:
                auto_close_trade(db, trade, hit)
                auto_closed = True
                auto_closed_count += 1

            sltp_alerts.append(
                SLTPAlert(
                    trade_id=trade.id,
                    ticker=trade.ticker,
                    hit_type=hit.hit_type,
                    hit_date=hit.hit_date,
                    hit_price=hit.hit_price,
                    auto_detect=trade.auto_detect,
                    auto_closed=auto_closed,
                    currency=trade.ticker_rel.currency if trade.ticker_rel else None,
                    price_hint=trade.ticker_rel.price_hint if trade.ticker_rel else None,
                )
            )

    return sltp_alerts, layered_alerts, auto_closed_count, partial_close_count, conflict_count


def annotate_dismissals(
    db: Session,
    user_id: int,
    entry_alerts: list[EntryAlert],
    sltp_alerts: list[SLTPAlert],
    layered_alerts: list[LayeredAlert],
) -> None:
    """Set alert_kind / level_key / dismissed on each alert, in place.

    An alert's signature is (trade_id, hit_date, alert_kind, level_key). An
    alert is marked dismissed if a matching AlertDismissal row exists for
    this user. Dismissed alerts are kept in their lists (just flagged) so
    the frontend can show them in a reviewable section.
    """
    dismissed = {
        (d.trade_id, d.hit_date, d.alert_kind, d.level_key)
        for d in db.query(AlertDismissal)
        .filter(AlertDismissal.user_id == user_id)
        .all()
    }

    for entry in entry_alerts:
        entry.alert_kind = AlertKind.ENTRY.value
        entry.level_key = "entry"
        entry.dismissed = (
            entry.trade_id,
            entry.hit_date,
            AlertKind.ENTRY,
            "entry",
        ) in dismissed

    for sltp in sltp_alerts:
        sltp.alert_kind = AlertKind.SLTP.value
        sltp.level_key = sltp.hit_type.value
        sltp.dismissed = (
            sltp.trade_id,
            sltp.hit_date,
            AlertKind.SLTP,
            sltp.level_key,
        ) in dismissed

    for layered in layered_alerts:
        layered.alert_kind = AlertKind.LAYERED.value
        layered.level_key = f"{layered.level_type}:{layered.level_index}"
        layered.dismissed = (
            layered.trade_id,
            layered.hit_date,
            AlertKind.LAYERED,
            layered.level_key,
        ) in dismissed


def process_all_trades(db: Session, user_id: int) -> dict:
    """
    Process both PLAN and OPEN trades for a user.

    For PLAN trades: detect entry price hits and auto-open auto-detect trades.
    For OPEN trades: detect SL/TP hits and auto-close auto-detect trades.

    Returns a dict with:
      - entry_alerts: list of EntryAlert objects
      - sltp_alerts: list of SLTPAlert objects
      - layered_alerts: list of LayeredAlert objects
      - auto_opened_count: number of auto-detect trades auto-opened
      - auto_closed_count: number of auto-detect trades auto-closed
      - partial_close_count: number of partial closes for layered trades
      - conflict_count: number of trades with both SL and TP hit same day
    """
    # Per-user confirmation buffer (falls back to DETECTION_MARGIN_PCT).
    from asistrader.services.fund_service import get_detection_margin

    margin = get_detection_margin(db, user_id)

    # Process PLAN trades for entry hits
    entry_alerts, auto_opened_count = process_ordered_trades(db, user_id, margin)

    # Process OPEN trades for SL/TP hits
    # Note: This includes trades that were just auto-opened above
    sltp_alerts, layered_alerts, auto_closed_count, partial_close_count, conflict_count = process_open_trades(db, user_id, margin)

    # Tag each alert with its signature and whether it was previously
    # dismissed (the blacklist). Dismissed alerts are still returned so the
    # frontend can surface them in a reviewable "Discarded" section.
    annotate_dismissals(db, user_id, entry_alerts, sltp_alerts, layered_alerts)

    return {
        "entry_alerts": entry_alerts,
        "sltp_alerts": sltp_alerts,
        "layered_alerts": layered_alerts,
        "auto_opened_count": auto_opened_count,
        "auto_closed_count": auto_closed_count,
        "partial_close_count": partial_close_count,
        "conflict_count": conflict_count,
    }
