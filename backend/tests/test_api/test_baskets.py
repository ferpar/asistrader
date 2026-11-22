"""Baskets API: visibility, read-only Curated Baskets and the Basket Index.

Curated Baskets are visible to every user and read-only; Personal Baskets are
visible only to their owner. Baskets and market data are seeded directly.
"""

import re
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from asistrader.auth.jwt import create_access_token
from asistrader.auth.password import hash_password
from asistrader.db.seed_baskets import load_curated_baskets, seed_baskets
from asistrader.models.db import Basket, BasketMember, MarketData, Ticker, User


def _ticker(db: Session, symbol: str) -> None:
    if db.get(Ticker, symbol) is None:
        db.add(Ticker(symbol=symbol))
        db.commit()


def _basket(
    db: Session,
    name: str,
    members: list[str],
    *,
    owner: User | None = None,
    slug: str | None = None,
) -> Basket:
    for symbol in members:
        _ticker(db, symbol)
    basket = Basket(
        kind="personal" if owner else "curated",
        owner_user_id=owner.id if owner else None,
        name=name,
        slug=slug,
        members=[BasketMember(ticker=s) for s in members],
    )
    db.add(basket)
    db.commit()
    return basket


def _closes(db: Session, symbol: str, adj: dict[date, float], raw: dict[date, float] | None = None) -> None:
    """Store adjusted closes (and optionally different raw closes) for a ticker."""
    _ticker(db, symbol)
    for day, adj_close in adj.items():
        close = raw[day] if raw else adj_close
        db.add(MarketData(ticker=symbol, date=day, close=close, adj_close=adj_close))
    db.commit()


@pytest.fixture
def other_user(db_session: Session) -> User:
    user = User(email="other@example.com", hashed_password=hash_password("password123"), is_active=True)
    db_session.add(user)
    db_session.commit()
    return user


@pytest.fixture
def other_headers(other_user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(other_user.id, other_user.email)}"}


# --- Visibility -------------------------------------------------------------


def test_lists_curated_and_own_personal_baskets_but_not_other_users(
    client: TestClient,
    db_session: Session,
    sample_user: User,
    auth_headers: dict[str, str],
    other_user: User,
) -> None:
    _basket(db_session, "Tech & AI", ["NVDA", "MSFT"], slug="tech-ai")
    _basket(db_session, "My picks", ["NVDA"], owner=sample_user)
    _basket(db_session, "Their picks", ["MSFT"], owner=other_user)

    response = client.get("/api/baskets", headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 2
    by_name = {b["name"]: b for b in body["baskets"]}
    assert set(by_name) == {"Tech & AI", "My picks"}
    assert by_name["Tech & AI"]["kind"] == "curated"
    assert by_name["Tech & AI"]["slug"] == "tech-ai"
    assert sorted(by_name["Tech & AI"]["members"]) == ["MSFT", "NVDA"]
    assert by_name["My picks"]["kind"] == "personal"


def test_another_users_personal_basket_is_not_found(
    client: TestClient, db_session: Session, auth_headers: dict[str, str], other_user: User
) -> None:
    theirs = _basket(db_session, "Their picks", ["MSFT"], owner=other_user)

    assert client.get(f"/api/baskets/{theirs.id}", headers=auth_headers).status_code == 404
    assert client.get(f"/api/baskets/{theirs.id}/index", headers=auth_headers).status_code == 404


def test_curated_baskets_are_readable_by_every_user(
    client: TestClient, db_session: Session, auth_headers: dict[str, str], other_headers: dict[str, str]
) -> None:
    curated = _basket(db_session, "Tech & AI", ["NVDA"], slug="tech-ai")

    for headers in (auth_headers, other_headers):
        response = client.get(f"/api/baskets/{curated.id}", headers=headers)
        assert response.status_code == 200
        assert response.json()["name"] == "Tech & AI"


@pytest.mark.parametrize(
    ("method", "suffix", "payload"),
    [
        ("PATCH", "", {"name": "Hijacked"}),
        ("PUT", "", {"name": "Hijacked"}),
        ("DELETE", "", None),
        ("POST", "/members", {"symbol": "AMD"}),
        ("DELETE", "/members/NVDA", None),
    ],
)
def test_curated_baskets_cannot_be_edited_through_the_api(
    client: TestClient,
    db_session: Session,
    auth_headers: dict[str, str],
    method: str,
    suffix: str,
    payload: dict | None,
) -> None:
    curated = _basket(db_session, "Tech & AI", ["NVDA"], slug="tech-ai")

    response = client.request(method, f"/api/baskets/{curated.id}{suffix}", json=payload, headers=auth_headers)

    assert response.status_code in (403, 404, 405)
    after = client.get(f"/api/baskets/{curated.id}", headers=auth_headers).json()
    assert after["name"] == "Tech & AI"
    assert after["members"] == ["NVDA"]


# --- Basket Index ------------------------------------------------------------

MON, TUE, WED, THU, FRI = (date(2025, 1, d) for d in range(6, 11))
NEXT_MON = date(2025, 1, 13)


def _index(client: TestClient, headers: dict[str, str], basket_id: int) -> dict[str, list]:
    response = client.get(f"/api/baskets/{basket_id}/index", headers=headers)
    assert response.status_code == 200
    return response.json()


def test_index_chains_the_equal_weighted_mean_of_member_returns_from_100(
    client: TestClient, db_session: Session, auth_headers: dict[str, str]
) -> None:
    _closes(db_session, "AAA", {MON: 100, TUE: 110, WED: 110})
    _closes(db_session, "BBB", {MON: 50, TUE: 60, WED: 54})
    basket = _basket(db_session, "Pair", ["AAA", "BBB"], slug="pair")

    series = _index(client, auth_headers, basket.id)

    assert series["dates"] == ["2025-01-06", "2025-01-07", "2025-01-08"]
    # Tue: mean(+10%, +20%) = +15%. Wed: mean(0%, -10%) = -5%.
    assert series["close"] == pytest.approx([100, 115, 109.25])


def test_a_late_member_joins_the_day_after_its_first_close(
    client: TestClient, db_session: Session, auth_headers: dict[str, str]
) -> None:
    _closes(db_session, "AAA", {MON: 100, TUE: 110, WED: 121, THU: 121})
    _closes(db_session, "BBB", {WED: 50, THU: 60})
    basket = _basket(db_session, "Pair", ["AAA", "BBB"], slug="pair")

    series = _index(client, auth_headers, basket.id)

    # Starts at the earliest member's first close. Wed: only AAA counts (+10%);
    # Thu: mean(0%, +20%) = +10%.
    assert series["dates"][0] == "2025-01-06"
    assert series["close"] == pytest.approx([100, 110, 121, 133.1])


def test_holidays_carry_the_last_close_forward_over_business_days(
    client: TestClient, db_session: Session, auth_headers: dict[str, str]
) -> None:
    # AAA's market is closed on Wednesday; nothing trades at the weekend.
    _closes(db_session, "AAA", {MON: 100, TUE: 110, THU: 121, FRI: 121, NEXT_MON: 121})
    _closes(db_session, "BBB", {MON: 100, TUE: 100, WED: 110, THU: 110, FRI: 110, NEXT_MON: 121})
    basket = _basket(db_session, "Pair", ["AAA", "BBB"], slug="pair")

    series = _index(client, auth_headers, basket.id)

    assert series["dates"] == [
        "2025-01-06", "2025-01-07", "2025-01-08", "2025-01-09", "2025-01-10", "2025-01-13",
    ]
    # Tue +5%; Wed AAA 0% (carried), BBB +10% -> +5%; Thu AAA 121/110 -> +5%;
    # Fri 0%; next Mon BBB +10% -> +5%.
    assert series["close"] == pytest.approx(
        [100, 105, 110.25, 115.7625, 115.7625, 121.550625]
    )


def test_a_member_without_a_close_for_more_than_5_business_days_stops_contributing(
    client: TestClient, db_session: Session, auth_headers: dict[str, str]
) -> None:
    next_tue, next_wed = date(2025, 1, 14), date(2025, 1, 15)
    # BBB's last close is Monday (e.g. delisted); AAA keeps trading.
    _closes(
        db_session,
        "AAA",
        {MON: 100, TUE: 100, WED: 100, THU: 100, FRI: 100, NEXT_MON: 100, next_tue: 110, next_wed: 121},
    )
    _closes(db_session, "BBB", {MON: 50})
    basket = _basket(db_session, "Pair", ["AAA", "BBB"], slug="pair")

    series = _index(client, auth_headers, basket.id)

    assert series["dates"][-3:] == ["2025-01-13", "2025-01-14", "2025-01-15"]
    # Up to next Monday (5 business days after its last close) BBB is carried
    # forward like a holiday; from next Tuesday only AAA counts: +10%, +10%.
    assert series["close"] == pytest.approx([100] * 6 + [110, 121])


def test_index_is_built_from_adjusted_closes(
    client: TestClient, db_session: Session, auth_headers: dict[str, str]
) -> None:
    # A 2:1 split on Tuesday halves the raw close; the adjusted close shows +5%.
    _closes(db_session, "AAA", {MON: 100, TUE: 105}, raw={MON: 200, TUE: 105})
    # A row stored before adjusted closes were recorded is not measured.
    db_session.add(MarketData(ticker="AAA", date=WED, close=300, adj_close=None))
    db_session.commit()
    basket = _basket(db_session, "Solo", ["AAA"], slug="solo")

    series = _index(client, auth_headers, basket.id)

    assert series["dates"] == ["2025-01-06", "2025-01-07"]
    assert series["close"] == pytest.approx([100, 105])
    assert series["adj_close"] == series["close"]


def test_a_basket_without_measurable_data_has_an_empty_index(
    client: TestClient, db_session: Session, auth_headers: dict[str, str]
) -> None:
    basket = _basket(db_session, "New", ["ZZZ"], slug="new")

    assert _index(client, auth_headers, basket.id) == {"dates": [], "close": [], "adj_close": []}


def test_bulk_index_returns_every_visible_basket_in_the_columnar_shape(
    client: TestClient,
    db_session: Session,
    sample_user: User,
    auth_headers: dict[str, str],
    other_user: User,
) -> None:
    _closes(db_session, "AAA", {MON: 100, TUE: 110, WED: 121})
    _closes(db_session, "BBB", {MON: 50, TUE: 45, WED: 45})
    curated = _basket(db_session, "Curated A", ["AAA"], slug="a")
    mine = _basket(db_session, "Mine", ["AAA", "BBB"], owner=sample_user)
    theirs = _basket(db_session, "Theirs", ["BBB"], owner=other_user)

    response = client.get("/api/baskets/index", headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    assert body["errors"] == {}
    assert set(body["data"]) == {str(curated.id), str(mine.id)}
    assert str(theirs.id) not in body["data"]
    a = body["data"][str(curated.id)]
    assert a["dates"] == ["2025-01-06", "2025-01-07", "2025-01-08"]
    assert a["close"] == pytest.approx([100, 110, 121])
    assert a["adj_close"] == a["close"]
    # Mine: Tue mean(+10%, -10%) = 0%; Wed mean(+10%, 0%) = +5%.
    assert body["data"][str(mine.id)]["close"] == pytest.approx([100, 100, 105])


def test_index_can_start_from_a_date_without_rebasing(
    client: TestClient, db_session: Session, auth_headers: dict[str, str]
) -> None:
    _closes(db_session, "AAA", {MON: 100, TUE: 110, WED: 121})
    basket = _basket(db_session, "Solo", ["AAA"], slug="solo")

    single = client.get(f"/api/baskets/{basket.id}/index?start_date=2025-01-07", headers=auth_headers).json()
    bulk = client.get("/api/baskets/index?start_date=2025-01-07", headers=auth_headers).json()

    assert single["dates"] == ["2025-01-07", "2025-01-08"]
    assert single["close"] == pytest.approx([110, 121])
    assert bulk["data"][str(basket.id)] == single


# --- Curated seed ------------------------------------------------------------


def _curated(client: TestClient, headers: dict[str, str]) -> dict[str, dict]:
    baskets = client.get("/api/baskets", headers=headers).json()["baskets"]
    return {b["slug"]: b for b in baskets if b["kind"] == "curated"}


def test_seed_creates_curated_baskets_visible_to_every_user(
    client: TestClient, db_session: Session, auth_headers: dict[str, str], other_headers: dict[str, str]
) -> None:
    specs = [
        {"slug": "tech-ai", "name": "Tech & AI", "description": "Chips and cloud", "members": ["NVDA", "MSFT"]},
        {"slug": "ibex", "name": "IBEX", "members": ["SAN.MC"]},
    ]

    result = seed_baskets(db_session, specs)

    assert result == (2, 0)
    for headers in (auth_headers, other_headers):
        curated = _curated(client, headers)
        assert set(curated) == {"tech-ai", "ibex"}
        assert curated["tech-ai"]["name"] == "Tech & AI"
        assert curated["tech-ai"]["description"] == "Chips and cloud"
        assert sorted(curated["tech-ai"]["members"]) == ["MSFT", "NVDA"]


def test_reseeding_updates_names_and_members_by_slug_without_duplicating(
    client: TestClient, db_session: Session, auth_headers: dict[str, str]
) -> None:
    seed_baskets(db_session, [{"slug": "tech-ai", "name": "Tech", "members": ["NVDA", "MSFT"]}])
    before = _curated(client, auth_headers)["tech-ai"]

    unchanged = seed_baskets(db_session, [{"slug": "tech-ai", "name": "Tech", "members": ["NVDA", "MSFT"]}])
    changed = seed_baskets(db_session, [{"slug": "tech-ai", "name": "Tech & AI", "members": ["NVDA", "AMD"]}])

    assert unchanged == (0, 0)
    assert changed == (0, 1)
    curated = _curated(client, auth_headers)
    assert list(curated) == ["tech-ai"]
    assert curated["tech-ai"]["id"] == before["id"]
    assert curated["tech-ai"]["name"] == "Tech & AI"
    assert sorted(curated["tech-ai"]["members"]) == ["AMD", "NVDA"]


def test_the_shipped_seed_file_applies_idempotently(
    client: TestClient, db_session: Session, auth_headers: dict[str, str]
) -> None:
    specs = load_curated_baskets()

    assert seed_baskets(db_session) == (len(specs), 0)
    assert seed_baskets(db_session) == (0, 0)
    curated = _curated(client, auth_headers)
    assert set(curated) == {spec["slug"] for spec in specs}
    for spec in specs:
        basket = curated[spec["slug"]]
        assert basket["name"] == spec["name"]
        assert basket["description"] == spec["description"]
        assert sorted(basket["members"]) == sorted(spec["members"])


def test_the_shipped_seed_file_is_well_formed() -> None:
    specs = load_curated_baskets()

    slugs = [spec["slug"] for spec in specs]
    names = [spec["name"] for spec in specs]
    assert len(slugs) == len(set(slugs))
    assert len(names) == len(set(names))
    for spec in specs:
        assert re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", spec["slug"]), spec["slug"]
        assert spec["name"].strip() and spec["description"].strip()
        assert spec["members"], spec["slug"]
        assert len(spec["members"]) == len(set(spec["members"])), spec["slug"]
        assert all(re.fullmatch(r"[A-Z0-9.\-]+", s) for s in spec["members"]), spec["slug"]
