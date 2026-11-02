"""Admin password reset CLI, for users locked out of their account.

Usage:
    python -m asistrader.cli.reset_password --find <text>
    python -m asistrader.cli.reset_password <email> [--password <new password>]

--find lists accounts whose email contains <text> and changes nothing.

Otherwise the exact email's password is replaced (with a generated one unless
--password is given), every refresh token for the account is revoked, and the
new password is printed once. It can't be recovered afterwards: only the hash
is stored.

Prefer the generated password: --password ends up in the shell history.
"""

from __future__ import annotations

import argparse
import secrets
import sys

from sqlalchemy.orm import Session

from asistrader.db.database import SessionLocal
from asistrader.models.db import User
from asistrader.services.auth_service import get_user_by_email, set_user_password

# Mirrors MIN_PASSWORD_LENGTH in frontend/src/hooks/useAuthValidation.ts.
MIN_PASSWORD_LENGTH = 8


def main(argv: list[str] | None = None, session: Session | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="asistrader.cli.reset_password",
        description="List accounts or reset an account's password.",
    )
    parser.add_argument("email", nargs="?", help="Exact email of the account to reset.")
    parser.add_argument(
        "--find", metavar="TEXT", default=None,
        help="List accounts whose email contains TEXT. Read-only.",
    )
    parser.add_argument(
        "--password", default=None,
        help="Use this password instead of generating one.",
    )
    args = parser.parse_args(argv)

    if (args.email is None) == (args.find is None):
        parser.error("pass either an email or --find")
    if args.find is not None and args.password is not None:
        parser.error("--password can't be combined with --find")
    if args.password is not None and len(args.password) < MIN_PASSWORD_LENGTH:
        print(
            f"error: password must be at least {MIN_PASSWORD_LENGTH} characters",
            file=sys.stderr,
        )
        return 2

    owns_session = session is None
    if session is None:
        session = SessionLocal()
    try:
        if args.find is not None:
            return _find(session, args.find)
        return _reset(session, args.email, args.password)
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
            f"  created={user.created_at:%Y-%m-%d %H:%M}"
            f"  trades={len(user.trades)}"
        )
    return 0


def _reset(session: Session, email: str, password: str | None) -> int:
    user = get_user_by_email(session, email)
    if user is None:
        print(f"error: no account with email '{email}'", file=sys.stderr)
        return 2

    new_password = password or secrets.token_urlsafe(12)
    revoked = set_user_password(session, user, new_password)

    print(f"Password reset for #{user.id} {user.email}")
    print(f"Sessions revoked: {revoked}")
    if not user.is_active:
        print("Warning: this account is inactive, so login will still fail.")
    print(f"New password: {new_password}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
