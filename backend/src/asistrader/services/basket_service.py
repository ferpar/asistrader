"""Baskets: visibility, Personal Basket writes and the Basket Index.

Curated Baskets are visible to every user and read-only; Personal Baskets are
visible to and editable by their owner only. A Basket another user owns is
reported as not found, so its existence never leaks.
"""

from datetime import date, timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from asistrader.models.db import Basket, BasketKind, BasketMember, MarketData, Ticker
from asistrader.services.market_data_service import ensure_ticker_with_history


class BasketNotFoundError(Exception):
    """The Basket doesn't exist or isn't visible to this user."""


class BasketReadOnlyError(Exception):
    """A write was attempted on a Curated Basket, which no user may change."""


class BasketNameExistsError(Exception):
    """The user already has a Personal Basket with that name."""


class BasketMemberNotFoundError(Exception):
    """The ticker isn't a member of the Basket."""


class BasketMemberExistsError(Exception):
    """The ticker is already a member of the Basket."""


# History loaded for a ticker first seen as a new member: the radar window
# (frontend indicatorBuild.ts), enough for the 1-year Momentum Score.
MEMBER_HISTORY_DAYS = 400


def _visible(db: Session, user_id: int):
    return (
        db.query(Basket)
        .options(selectinload(Basket.members))
        .filter(or_(Basket.kind == BasketKind.CURATED.value, Basket.owner_user_id == user_id))
    )


def get_visible_baskets(db: Session, user_id: int) -> list[Basket]:
    """Curated Baskets plus the user's Personal ones, curated first, then by name."""
    baskets = _visible(db, user_id).all()
    return sorted(baskets, key=lambda b: (b.kind != BasketKind.CURATED.value, b.name.lower()))


def get_visible_basket(db: Session, user_id: int, basket_id: int) -> Basket:
    basket = _visible(db, user_id).filter(Basket.id == basket_id).first()
    if basket is None:
        raise BasketNotFoundError(f"Basket {basket_id} not found")
    return basket


# --- Personal Basket writes --------------------------------------------------
#
# Personal Baskets carry no slug: the slug is the stable key the curated seed
# reconciles by, and the unique constraint allows any number of NULLs.


def _ensure_name_free(
    db: Session, user_id: int, name: str, exclude_id: int | None = None
) -> None:
    """Personal Basket names are unique per owner, ignoring case.

    Sharing a Curated Basket's name is allowed: the ranking marks the kind.
    """
    query = db.query(Basket.id).filter(
        Basket.owner_user_id == user_id, func.lower(Basket.name) == name.lower()
    )
    if exclude_id is not None:
        query = query.filter(Basket.id != exclude_id)
    if query.first() is not None:
        raise BasketNameExistsError(f"You already have a Basket named '{name}'")


def create_personal_basket(
    db: Session, user_id: int, name: str, description: str | None = None
) -> Basket:
    _ensure_name_free(db, user_id, name)
    basket = Basket(
        kind=BasketKind.PERSONAL.value,
        owner_user_id=user_id,
        name=name,
        description=description,
    )
    db.add(basket)
    db.commit()
    db.refresh(basket)
    return basket


def copy_basket(
    db: Session, user_id: int, basket_id: int, name: str | None = None
) -> Basket:
    """A new Personal Basket with the same members as a visible Basket.

    Usually a Curated one, so the user can tweak a ready-made group. The copy
    is independent: later changes to either side don't touch the other.
    """
    source = get_visible_basket(db, user_id, basket_id)
    name = name or f"{source.name} (copy)"
    _ensure_name_free(db, user_id, name)
    copy = Basket(
        kind=BasketKind.PERSONAL.value,
        owner_user_id=user_id,
        name=name,
        description=source.description,
        members=[BasketMember(ticker=m.ticker) for m in source.members],
    )
    db.add(copy)
    db.commit()
    db.refresh(copy)
    return copy


def _own_personal(db: Session, user_id: int, basket_id: int) -> Basket:
    """A visible Basket the user may change: one of their Personal Baskets.

    Curated Baskets are visible to everyone, so refusing them can say why;
    another user's Personal Basket isn't visible and stays a plain not-found.
    """
    basket = get_visible_basket(db, user_id, basket_id)
    if basket.kind == BasketKind.CURATED.value:
        raise BasketReadOnlyError(f"Basket {basket_id} is a Curated Basket and is read-only")
    return basket


def update_personal_basket(
    db: Session, user_id: int, basket_id: int, fields: dict
) -> Basket:
    """Apply the given fields (`name`, `description`) to the user's Personal Basket."""
    basket = _own_personal(db, user_id, basket_id)
    if fields.get("name") is not None:
        _ensure_name_free(db, user_id, fields["name"], exclude_id=basket.id)
        basket.name = fields["name"]
    if "description" in fields:
        basket.description = fields["description"]
    db.commit()
    db.refresh(basket)
    return basket


def delete_personal_basket(db: Session, user_id: int, basket_id: int) -> None:
    db.delete(_own_personal(db, user_id, basket_id))
    db.commit()


def add_member(db: Session, user_id: int, basket_id: int, symbol: str) -> Basket:
    """Add a ticker to the user's Personal Basket by symbol.

    A symbol AsisTrader doesn't know yet is validated on Yahoo, created and
    its history loaded (`TickerValidationError` when Yahoo doesn't know it).
    """
    basket = _own_personal(db, user_id, basket_id)
    symbol = symbol.strip().upper()
    if any(m.ticker == symbol for m in basket.members):
        raise BasketMemberExistsError(f"{symbol} is already a member of Basket {basket_id}")
    if db.get(Ticker, symbol) is None:
        since = date.today() - timedelta(days=MEMBER_HISTORY_DAYS)
        ensure_ticker_with_history(db, symbol, since)
    basket.members.append(BasketMember(ticker=symbol))
    db.commit()
    db.refresh(basket)
    return basket


def remove_member(db: Session, user_id: int, basket_id: int, symbol: str) -> None:
    """Drop a ticker from the user's Personal Basket; the ticker itself stays."""
    basket = _own_personal(db, user_id, basket_id)
    symbol = symbol.strip().upper()
    member = next((m for m in basket.members if m.ticker == symbol), None)
    if member is None:
        raise BasketMemberNotFoundError(f"{symbol} is not a member of Basket {basket_id}")
    basket.members.remove(member)
    db.commit()


IndexSeries = tuple[list[date], list[float]]


def _adjusted_closes(db: Session, symbols: set[str]) -> dict[str, list[tuple[date, float]]]:
    """Each symbol's stored adjusted closes in date order, in one query.

    Rows not yet backfilled (adj_close NULL) are skipped: a Basket Index is a
    measurement and never mixes in raw closes (ADR 0002).
    """
    out: dict[str, list[tuple[date, float]]] = {s: [] for s in symbols}
    if not symbols:
        return out
    rows = db.execute(
        select(MarketData.ticker, MarketData.date, MarketData.adj_close)
        .where(MarketData.ticker.in_(symbols), MarketData.adj_close.isnot(None))
        .order_by(MarketData.ticker, MarketData.date)
    )
    for ticker, day, adj_close in rows:
        out[ticker].append((day, adj_close))
    return out


def _business_days(start: date, end: date) -> list[date]:
    days = []
    day = start
    while day <= end:
        if day.weekday() < 5:
            days.append(day)
        day += timedelta(days=1)
    return days


def _index_from_closes(closes: dict[str, list[tuple[date, float]]]) -> IndexSeries:
    """Chain an equal-weighted Basket Index from 100 over business days.

    Starts at the earliest member's first adjusted close and runs to the
    latest close any member has. Each member's last close is carried forward
    over days it has no row (a market holiday is a 0% return for it). A day's
    return is the mean of the returns of members that already had a close on
    the previous business day — a late-joining member counts from the day
    after its first close.
    """
    series = {s: rows for s, rows in closes.items() if rows}
    if not series:
        return [], []
    start = min(rows[0][0] for rows in series.values())
    end = max(rows[-1][0] for rows in series.values())

    cursor = {s: 0 for s in series}
    last: dict[str, float] = {}
    dates: list[date] = []
    values: list[float] = []
    level = 100.0
    for day in _business_days(start, end):
        previous = dict(last)
        for symbol, rows in series.items():
            i = cursor[symbol]
            while i < len(rows) and rows[i][0] <= day:
                last[symbol] = rows[i][1]
                i += 1
            cursor[symbol] = i
        if dates:
            returns = [last[s] / p - 1 for s, p in previous.items() if p]
            if returns:
                level *= 1 + sum(returns) / len(returns)
        dates.append(day)
        values.append(level)
    return dates, values


def _trim(series: IndexSeries, start_date: date | None) -> IndexSeries:
    if start_date is None:
        return series
    dates, values = series
    keep = [i for i, d in enumerate(dates) if d >= start_date]
    return [dates[i] for i in keep], [values[i] for i in keep]


def get_basket_index(
    db: Session, user_id: int, basket_id: int, start_date: date | None = None
) -> IndexSeries:
    """One visible Basket's index as (dates, levels), optionally from `start_date`.

    Trimming doesn't rebase: levels stay chained from the Basket's own start.
    """
    basket = get_visible_basket(db, user_id, basket_id)
    symbols = {m.ticker for m in basket.members}
    return _trim(_index_from_closes(_adjusted_closes(db, symbols)), start_date)


def get_visible_basket_indexes(
    db: Session, user_id: int, start_date: date | None = None
) -> dict[int, IndexSeries]:
    """Every visible Basket's index, keyed by Basket id, reading closes once."""
    baskets = get_visible_baskets(db, user_id)
    closes = _adjusted_closes(db, {m.ticker for b in baskets for m in b.members})
    return {
        b.id: _trim(_index_from_closes({m.ticker: closes[m.ticker] for m in b.members}), start_date)
        for b in baskets
    }
