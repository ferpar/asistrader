"""Trade detection service for paper trading auto-open and auto-close functionality."""

from dataclasses import dataclass
from datetime import date

from sqlalchemy.orm import Session

from asistrader.models.db import (
    ExitLevel,
    ExitLevelStatus,
    ExitLevelType,
    ExitType,
    MarketData,
    Trade,
    TradeStatus,
)
from asistrader.models.schemas import EntryAlert, EntryHitType, SLTPAlert, SLTPHitType, LayeredAlert


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
    trade: Trade, market_day: MarketData
) -> SLTPHitType | None:
    """
    Check if SL or TP was hit on a specific market day.

    For long positions:
      - SL hit if low <= stop_loss
      - TP hit if high >= take_profit

    For short positions:
      - SL hit if high >= stop_loss
      - TP hit if low <= take_profit

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
        sl_hit = market_day.low <= trade.stop_loss
        tp_hit = market_day.high >= trade.take_profit
    else:
        sl_hit = market_day.high >= trade.stop_loss
        tp_hit = market_day.low <= trade.take_profit

    if sl_hit and tp_hit:
        return SLTPHitType.BOTH
    elif sl_hit:
        return SLTPHitType.SL
    elif tp_hit:
        return SLTPHitType.TP
    return None


def detect_sltp_hit(db: Session, trade: Trade) -> SLTPHit | None:
    """
    Scan market data from trade's date_actual to find first SL/TP hit.

    Returns the first hit found, or None if no hit detected.
    """
    if trade.status != TradeStatus.OPEN or trade.date_actual is None:
        return None

    market_data = (
        db.query(MarketData)
        .filter(
            MarketData.ticker == trade.ticker,
            MarketData.date >= trade.date_actual,
        )
        .order_by(MarketData.date)
        .all()
    )

    for day in market_data:
        hit_type = check_sltp_hit_for_day(trade, day)
        if hit_type:
            # Determine hit price based on hit type
            if hit_type == SLTPHitType.SL:
                hit_price = trade.stop_loss
            elif hit_type == SLTPHitType.TP:
                hit_price = trade.take_profit
            else:
                # BOTH hit - we don't know exact price, use the one closer to open
                # For reporting purposes, just use the stop_loss
                hit_price = trade.stop_loss

            return SLTPHit(
                hit_type=hit_type,
                hit_date=day.date,
                hit_price=hit_price,
            )

    return None


def auto_close_paper_trade(
    db: Session, trade: Trade, hit: SLTPHit
) -> None:
    """
    Auto-close a paper trade with the SL/TP hit information.

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


def check_entry_hit_for_day(trade: Trade, market_day: MarketData) -> bool:
    """
    Check if entry price was hit on a specific market day.

    For long positions (SL < entry): Entry hit if low <= entry_price
    For short positions (SL > entry): Entry hit if high >= entry_price

    Returns True if entry was hit, False otherwise.
    """
    if market_day.low is None or market_day.high is None:
        return False

    long = is_long_trade(trade)
    if long:
        return market_day.low <= trade.entry_price
    else:
        return market_day.high >= trade.entry_price


def detect_entry_hit(db: Session, trade: Trade) -> EntryHit | None:
    """
    Scan market data from trade's date_planned to find first entry price hit.

    Returns the first hit found, or None if no hit detected.
    """
    if trade.status != TradeStatus.PLAN or trade.date_planned is None:
        return None

    market_data = (
        db.query(MarketData)
        .filter(
            MarketData.ticker == trade.ticker,
            MarketData.date >= trade.date_planned,
        )
        .order_by(MarketData.date)
        .all()
    )

    for day in market_data:
        if check_entry_hit_for_day(trade, day):
            return EntryHit(hit_date=day.date, entry_price=trade.entry_price)

    return None


def auto_open_paper_trade(db: Session, trade: Trade, hit: EntryHit) -> None:
    """
    Auto-open a paper trade with the entry hit information.

    Sets status=OPEN and date_actual to the hit date.
    """
    trade.status = TradeStatus.OPEN
    trade.date_actual = hit.hit_date
    db.commit()


def process_plan_trades(
    db: Session, user_id: int
) -> tuple[list[EntryAlert], int]:
    """
    Process all PLAN trades for a user to detect entry price hits.

    Returns a tuple of:
      - entry_alerts: list of EntryAlert objects
      - auto_opened_count: number of paper trades auto-opened
    """
    plan_trades = (
        db.query(Trade)
        .filter(
            Trade.user_id == user_id,
            Trade.status == TradeStatus.PLAN,
        )
        .all()
    )

    entry_alerts: list[EntryAlert] = []
    auto_opened_count = 0

    for trade in plan_trades:
        hit = detect_entry_hit(db, trade)
        if not hit:
            continue

        auto_opened = False

        if trade.paper_trade:
            auto_open_paper_trade(db, trade, hit)
            auto_opened = True
            auto_opened_count += 1
            message = f"{trade.ticker}: Entry hit on {hit.hit_date}. Trade auto-opened."
        else:
            message = f"{trade.ticker}: Entry hit on {hit.hit_date} at ${trade.entry_price:.2f}. Review to open."

        entry_alerts.append(
            EntryAlert(
                trade_id=trade.id,
                ticker=trade.ticker,
                hit_type=EntryHitType.ENTRY,
                hit_date=hit.hit_date,
                entry_price=hit.entry_price,
                paper_trade=trade.paper_trade,
                auto_opened=auto_opened,
                message=message,
            )
        )

    return entry_alerts, auto_opened_count


def check_layered_level_hit(
    trade: Trade,
    level: ExitLevel,
    market_day: MarketData,
) -> bool:
    """
    Check if a layered exit level was hit on a specific market day.

    For long positions:
      - SL hit if low <= SL price
      - TP hit if high >= TP price

    For short positions:
      - SL hit if high >= SL price
      - TP hit if low <= TP price

    Returns True if the level was hit.
    """
    if market_day.low is None or market_day.high is None:
        return False

    long = is_long_trade(trade)

    if level.level_type == ExitLevelType.SL:
        if long:
            return market_day.low <= level.price
        else:
            return market_day.high >= level.price
    else:  # TP
        if long:
            return market_day.high >= level.price
        else:
            return market_day.low <= level.price


def detect_layered_hits(
    db: Session,
    trade: Trade,
) -> list[LayeredLevelHit]:
    """
    Detect all exit level hits for a trade.

    Scans market data from trade's date_actual and checks all pending levels.
    Returns all levels that were hit (can be multiple on the same day).

    All trades have exit_levels now, so this works for both simple and layered trades.

    Args:
        db: Database session
        trade: Trade to check

    Returns:
        List of LayeredLevelHit objects for all hit levels
    """
    if trade.status != TradeStatus.OPEN or trade.date_actual is None:
        return []

    # Get pending levels
    pending_levels = [
        l for l in trade.exit_levels if l.status == ExitLevelStatus.PENDING
    ]
    if not pending_levels:
        return []

    # Get market data from trade open date
    market_data = (
        db.query(MarketData)
        .filter(
            MarketData.ticker == trade.ticker,
            MarketData.date >= trade.date_actual,
        )
        .order_by(MarketData.date)
        .all()
    )

    hits: list[LayeredLevelHit] = []
    remaining_units = trade.remaining_units or trade.units

    for day in market_data:
        # Check all pending levels for hits on this day
        # Process in order_index order
        for level in sorted(pending_levels, key=lambda l: (l.level_type.value, l.order_index)):
            if level.status != ExitLevelStatus.PENDING:
                continue

            if check_layered_level_hit(trade, level, day):
                # Calculate units to close - percentage is of total units, not remaining
                units_to_close = int(trade.units * level.units_pct)
                if units_to_close < 1:
                    units_to_close = 1  # Close at least 1 unit
                # Don't close more than remaining
                if units_to_close > remaining_units:
                    units_to_close = remaining_units

                hits.append(LayeredLevelHit(
                    level=level,
                    hit_date=day.date,
                    units_to_close=units_to_close,
                ))

                # Update remaining for subsequent calculations this day
                remaining_units -= units_to_close

                # Mark level as no longer pending for this scan
                level.status = ExitLevelStatus.HIT

        # If all units closed, stop scanning
        if remaining_units <= 0:
            break

    # Reset status for levels we marked (will be properly updated in process_layered_hits)
    for hit in hits:
        hit.level.status = ExitLevelStatus.PENDING

    return hits


def process_layered_hits(db: Session, trade: Trade) -> list[LayeredLevelHit]:
    """
    Process all layered exit level hits for a trade.

    Detects hits and applies partial closes.

    Args:
        db: Database session
        trade: Trade to process

    Returns:
        List of processed LayeredLevelHit objects
    """
    from asistrader.services.exit_level_service import mark_level_hit

    hits = detect_layered_hits(db, trade)
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
    return hits


def process_open_trades(
    db: Session, user_id: int
) -> tuple[list[SLTPAlert], list[LayeredAlert], int, int, int]:
    """
    Process all OPEN trades for a user to detect SL/TP hits.

    Returns a tuple of:
      - sltp_alerts: list of SLTPAlert objects (simple trades)
      - layered_alerts: list of LayeredAlert objects (layered trades)
      - auto_closed_count: number of paper trades auto-closed
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
            hits = process_layered_hits(db, trade)
            for hit in hits:
                partial_close_count += 1
                hit_label = "Take Profit" if hit.level.level_type == ExitLevelType.TP else "Stop Loss"
                level_num = hit.level.order_index

                if trade.status == TradeStatus.CLOSE:
                    message = f"{trade.ticker}: {hit_label} {level_num} hit on {hit.hit_date}. Trade fully closed."
                else:
                    message = f"{trade.ticker}: {hit_label} {level_num} hit on {hit.hit_date}. Closed {hit.units_to_close} units at ${hit.level.price:.2f}."

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
                        paper_trade=trade.paper_trade,
                        auto_processed=trade.paper_trade,
                        message=message,
                    )
                )
        else:
            # Process simple trade (existing logic)
            hit = detect_sltp_hit(db, trade)
            if not hit:
                continue

            auto_closed = False

            if hit.hit_type == SLTPHitType.BOTH:
                conflict_count += 1
                message = f"{trade.ticker}: Both SL and TP hit on {hit.hit_date}. Manual resolution required."
            elif trade.paper_trade:
                auto_close_paper_trade(db, trade, hit)
                auto_closed = True
                auto_closed_count += 1
                hit_label = "Stop Loss" if hit.hit_type == SLTPHitType.SL else "Take Profit"
                message = f"{trade.ticker}: {hit_label} hit on {hit.hit_date}. Trade auto-closed at ${hit.hit_price:.2f}."
            else:
                hit_label = "Stop Loss" if hit.hit_type == SLTPHitType.SL else "Take Profit"
                message = f"{trade.ticker}: {hit_label} hit on {hit.hit_date} at ${hit.hit_price:.2f}. Consider closing manually."

            sltp_alerts.append(
                SLTPAlert(
                    trade_id=trade.id,
                    ticker=trade.ticker,
                    hit_type=hit.hit_type,
                    hit_date=hit.hit_date,
                    hit_price=hit.hit_price,
                    paper_trade=trade.paper_trade,
                    auto_closed=auto_closed,
                    message=message,
                )
            )

    return sltp_alerts, layered_alerts, auto_closed_count, partial_close_count, conflict_count


def process_all_trades(db: Session, user_id: int) -> dict:
    """
    Process both PLAN and OPEN trades for a user.

    For PLAN trades: detect entry price hits and auto-open paper trades.
    For OPEN trades: detect SL/TP hits and auto-close paper trades.

    Returns a dict with:
      - entry_alerts: list of EntryAlert objects
      - sltp_alerts: list of SLTPAlert objects
      - layered_alerts: list of LayeredAlert objects
      - auto_opened_count: number of paper trades auto-opened
      - auto_closed_count: number of paper trades auto-closed
      - partial_close_count: number of partial closes for layered trades
      - conflict_count: number of trades with both SL and TP hit same day
    """
    # Process PLAN trades for entry hits
    entry_alerts, auto_opened_count = process_plan_trades(db, user_id)

    # Process OPEN trades for SL/TP hits
    # Note: This includes trades that were just auto-opened above
    sltp_alerts, layered_alerts, auto_closed_count, partial_close_count, conflict_count = process_open_trades(db, user_id)

    return {
        "entry_alerts": entry_alerts,
        "sltp_alerts": sltp_alerts,
        "layered_alerts": layered_alerts,
        "auto_opened_count": auto_opened_count,
        "auto_closed_count": auto_closed_count,
        "partial_close_count": partial_close_count,
        "conflict_count": conflict_count,
    }
