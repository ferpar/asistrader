"""CSV import of Transactions into a Portfolio.

Each data row is imported on its own, through `portfolio_service.create_buy`
— the same path, and so the same validation, as a manual Transaction. Valid
rows are recorded and failing rows are reported with a reason; a failing row
never prevents the others from being imported. Only a file that can't be read
as a whole (no header, missing columns, no rows) is rejected outright.

Format: a header row naming the columns `date, ticker, units, price, fees`
and optionally `fx_rate` and `kind` (case-insensitive, any order). Separator
`,` or `;` (detected from the header), so a Spanish-locale spreadsheet export
works as-is: dates `YYYY-MM-DD` or `DD/MM/YYYY`, decimal point or decimal
comma, no thousands separators. Only Buys are imported: a row whose `kind`
is anything but empty or `buy` is reported as an error.
"""

import csv
import io
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from pydantic import ValidationError
from sqlalchemy.orm import Session

from asistrader.models.db import PortfolioTransaction
from asistrader.models.schemas import PortfolioTransactionCreateRequest
from asistrader.services import portfolio_service
from asistrader.services.portfolio_computation_service import PortfolioReplayError
from asistrader.services.ticker_service import TickerValidationError

REQUIRED_COLUMNS = ("date", "ticker", "units", "price", "fees")
DATE_FORMATS = ("%Y-%m-%d", "%d/%m/%Y")


@dataclass
class ImportRowResult:
    row: int
    status: str
    transaction: PortfolioTransaction | None = None
    error: str | None = None


class ImportFileError(Exception):
    """The file as a whole can't be imported; no row is attempted."""


class RowError(Exception):
    """A row that can't be imported; the message is the reason shown to the user."""


def _cell(record: dict[str | None, str | None], column: str) -> str:
    return (record.get(column) or "").strip()


def _parse_date(value: str) -> date:
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            pass
    raise RowError(f"Invalid date '{value}' (expected YYYY-MM-DD or DD/MM/YYYY)")


def _parse_number(column: str, value: str) -> Decimal:
    if "," in value and "." not in value:
        value = value.replace(",", ".")
    try:
        number = Decimal(value)
    except InvalidOperation:
        raise RowError(f"Invalid number in {column}: '{value}'")
    if not number.is_finite():
        raise RowError(f"Invalid number in {column}: '{value}'")
    return number


def _parse_buy(record: dict[str | None, str | None]) -> PortfolioTransactionCreateRequest:
    """Parse a row into the same request a manual Buy is validated with."""
    kind = _cell(record, "kind").lower()
    if kind not in ("", "buy"):
        raise RowError(f"Unsupported kind '{kind}': only Buys can be imported")
    fees = _cell(record, "fees")
    fx_rate = _cell(record, "fx_rate")
    try:
        buy = PortfolioTransactionCreateRequest(
            kind="buy",
            date=_parse_date(_cell(record, "date")),
            ticker=_cell(record, "ticker"),
            units=_parse_number("units", _cell(record, "units")),
            price=_parse_number("price", _cell(record, "price")),
            fees=_parse_number("fees", fees) if fees else Decimal(0),
            fx_rate=_parse_number("fx_rate", fx_rate) if fx_rate else None,
        )
    except ValidationError as e:
        raise RowError("; ".join(f"{err['loc'][0]}: {err['msg']}" for err in e.errors()))
    if buy.date > date.today():
        raise RowError("A Transaction can't be in the future")
    return buy


def _reader(text: str) -> csv.DictReader:
    text = text.removeprefix("﻿")
    header = text.split("\n", 1)[0]
    delimiter = ";" if header.count(";") > header.count(",") else ","
    return csv.DictReader(io.StringIO(text), delimiter=delimiter)


def import_csv(
    db: Session, user_id: int, portfolio_id: int, text: str
) -> list[ImportRowResult]:
    """Import each data row of `text` as a Buy, in file order.

    Raises:
        PortfolioNotFoundError: the Portfolio isn't the user's.
        ImportFileError: the file as a whole can't be read (no header, missing
            required columns, no data rows); nothing is imported.
    """
    portfolio_service.get_portfolio(db, user_id, portfolio_id)
    reader = _reader(text)
    if not reader.fieldnames:
        raise ImportFileError("The file is empty")
    reader.fieldnames = [name.strip().lower() for name in reader.fieldnames]
    missing = [c for c in REQUIRED_COLUMNS if c not in reader.fieldnames]
    if missing:
        raise ImportFileError(f"Missing required columns: {', '.join(missing)}")
    records = [(reader.line_num, record) for record in reader]
    if not records:
        raise ImportFileError("The file has no data rows")

    results = []
    for line, record in records:
        try:
            buy = _parse_buy(record)
            transaction = portfolio_service.create_buy(
                db,
                user_id,
                portfolio_id,
                on_date=buy.date,
                ticker=buy.ticker,
                units=buy.units,
                price=buy.price,
                fees=buy.fees,
                fx_rate=buy.fx_rate,
            )
        except (RowError, TickerValidationError, PortfolioReplayError) as e:
            results.append(ImportRowResult(line, "error", error=str(e)))
        else:
            results.append(ImportRowResult(line, "created", transaction))
    return results
