"""CSV import of Transactions into a Portfolio.

Every row is parsed first; then all parsed rows go to
`portfolio_service.create_transactions`, which validates them together with
the existing Transactions (the same rules as a manual Transaction) by
replaying them in date order, file order within a date. So a Sell may be
listed before its Buy as long as it is dated later. The import is
all-or-nothing: if any row fails to parse or validate, nothing is created
and every failing row is reported with a reason; the other rows are reported
as valid. A file that can't be read as a whole (no header, missing columns,
no rows) is rejected outright.

Format: a header row naming the columns `date, ticker, units, price, fees`
and optionally `fx_rate` and `kind` (case-insensitive, any order). Separator
`,` or `;` (detected from the header), so a Spanish-locale spreadsheet export
works as-is: dates `YYYY-MM-DD` or `DD/MM/YYYY`, decimal point or decimal
comma, no thousands separators. `kind` is `buy` (the default when the
column or cell is empty) or `sell`; anything else fails its row.
"""

import csv
import io
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from pydantic import ValidationError
from sqlalchemy.orm import Session

from asistrader.models.db import PortfolioTransaction, TransactionKind
from asistrader.models.schemas import PortfolioTransactionCreateRequest
from asistrader.services import portfolio_service
from asistrader.services.portfolio_service import TransactionBatchError, TransactionFields

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


def _parse_row(record: dict[str | None, str | None]) -> PortfolioTransactionCreateRequest:
    """Parse a row into the same request a manual Transaction is validated with."""
    kind = _cell(record, "kind").lower() or "buy"
    if kind not in ("buy", "sell"):
        raise RowError(f"Unsupported kind '{kind}': only Buys and Sells can be imported")
    fees = _cell(record, "fees")
    fx_rate = _cell(record, "fx_rate")
    try:
        request = PortfolioTransactionCreateRequest(
            kind=kind,
            date=_parse_date(_cell(record, "date")),
            ticker=_cell(record, "ticker"),
            units=_parse_number("units", _cell(record, "units")),
            price=_parse_number("price", _cell(record, "price")),
            fees=_parse_number("fees", fees) if fees else Decimal(0),
            fx_rate=_parse_number("fx_rate", fx_rate) if fx_rate else None,
        )
    except ValidationError as e:
        raise RowError("; ".join(f"{err['loc'][0]}: {err['msg']}" for err in e.errors()))
    if request.date > date.today():
        raise RowError("A Transaction can't be in the future")
    return request


def _reader(text: str) -> csv.DictReader:
    text = text.removeprefix("﻿")
    header = text.split("\n", 1)[0]
    delimiter = ";" if header.count(";") > header.count(",") else ","
    return csv.DictReader(io.StringIO(text), delimiter=delimiter)


def import_csv(
    db: Session, user_id: int, portfolio_id: int, text: str
) -> list[ImportRowResult]:
    """Import every data row of `text` as a Buy or Sell, or none of them.

    Returns one result per row, in file order: all "created", or, when any
    row fails, "error" (with its reason) or "valid" for each row and nothing
    created.

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

    errors: dict[int, str] = {}
    parsed: list[tuple[int, TransactionFields]] = []
    for line, record in records:
        try:
            request = _parse_row(record)
        except RowError as e:
            errors[line] = str(e)
            continue
        parsed.append(
            (
                line,
                TransactionFields(
                    kind=TransactionKind(request.kind),
                    on_date=request.date,
                    ticker=request.ticker,
                    units=request.units,
                    price=request.price,
                    fees=request.fees,
                    fx_rate=request.fx_rate,
                ),
            )
        )

    # With a row that didn't even parse, the rest is still validated (so every
    # failing row is reported) but not recorded.
    created: dict[int, PortfolioTransaction] = {}
    try:
        transactions = portfolio_service.create_transactions(
            db, user_id, portfolio_id, [fields for _, fields in parsed], record=not errors
        )
    except TransactionBatchError as e:
        errors.update({parsed[i][0]: reason for i, reason in e.errors.items()})
    else:
        if not errors:
            created = {line: tx for (line, _), tx in zip(parsed, transactions)}

    results = []
    for line, _ in records:
        if line in errors:
            results.append(ImportRowResult(line, "error", error=errors[line]))
        elif line in created:
            results.append(ImportRowResult(line, "created", created[line]))
        else:
            results.append(ImportRowResult(line, "valid"))
    return results
