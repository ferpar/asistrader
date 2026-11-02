"""Admin password reset CLI, for users locked out of their account.

Usage:
    python -m asistrader.cli.reset_password --find <text>
    python -m asistrader.cli.reset_password <email> [--hours 24]

--find lists accounts whose email contains <text> and changes nothing.

Otherwise a one-time reset link is created for the exact email and printed
once. It can't be recovered afterwards: only a hash of the token is stored.
Creating a link cancels any earlier unused link for that account. The current
password and sessions keep working until the user sets a new password, which
then signs them out of every device.

Links are built from the APP_URL environment variable.
"""

from __future__ import annotations

import argparse
import os
import sys

from sqlalchemy.orm import Session

from asistrader.db.database import SessionLocal
from asistrader.models.db import User
from asistrader.services.auth_service import (
    DEFAULT_RESET_TOKEN_HOURS,
    create_password_reset_token,
    get_user_by_email,
)


def main(argv: list[str] | None = None, session: Session | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="asistrader.cli.reset_password",
        description="List accounts or create a password reset link.",
    )
    parser.add_argument("email", nargs="?", help="Exact email of the account to reset.")
    parser.add_argument(
        "--find", metavar="TEXT", default=None,
        help="List accounts whose email contains TEXT. Read-only.",
    )
    parser.add_argument(
        "--hours", type=int, default=DEFAULT_RESET_TOKEN_HOURS,
        help=f"Hours until the link expires (default {DEFAULT_RESET_TOKEN_HOURS}).",
    )
    args = parser.parse_args(argv)

    if (args.email is None) == (args.find is None):
        parser.error("pass either an email or --find")
    if args.hours < 1:
        print("error: --hours must be at least 1", file=sys.stderr)
        return 2

    owns_session = session is None
    if session is None:
        session = SessionLocal()
    try:
        if args.find is not None:
            return _find(session, args.find)
        return _create_link(session, args.email, args.hours)
    finally:
        if owns_session:
            session.close()


def _find(session: Session, text: str) -> int:
    users = (
        session.query(User)
        .filter(User.email.contains(text, autoescape=True))
        .order_by(User.id)
        .all()
    )
    if not users:
        print(f"no accounts match '{text}'")
        return 0
    for user in users:
        print(
            f"#{user.id}  {user.email}  active={user.is_active}"
            f"  created={user.created_at or 'unknown'}"
            f"  trades={len(user.trades)}"
        )
    return 0


def _create_link(session: Session, email: str, hours: int) -> int:
    app_url = os.getenv("APP_URL")
    if not app_url:
        print("error: APP_URL is not set", file=sys.stderr)
        return 2

    user = get_user_by_email(session, email)
    if user is None:
        print(f"error: no account with email '{email}'", file=sys.stderr)
        return 2
    if not user.is_active:
        print(f"error: account '{email}' is inactive", file=sys.stderr)
        return 2

    token = create_password_reset_token(session, user, hours)
    print(f"Reset link for #{user.id} {user.email}, valid for {hours}h:")
    print(f"{app_url.rstrip('/')}/reset-password#token={token}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
