"""Maintainer commands, run on the portal host. There is no admin web UI.

  python -m app.admin invites create [--count N] [--days D]   print new invite codes, one per line
  python -m app.admin settings [KEY VALUE]                     show or change a setting
  python -m app.admin stats                                    counts only, no per-account data

Settings: account_cap (0 means no cap), redeem_paused (true/false).
"""

import argparse
import sys

import psycopg

from app import crypto, policy
from app.config import load


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m app.admin")
    sub = parser.add_subparsers(dest="cmd", required=True)
    inv = sub.add_parser("invites").add_subparsers(dest="action", required=True).add_parser("create")
    inv.add_argument("--count", type=int, default=1)
    inv.add_argument("--days", type=int, default=policy.INVITE_DAYS)
    st = sub.add_parser("settings")
    st.add_argument("key", nargs="?")
    st.add_argument("value", nargs="?")
    sub.add_parser("stats")
    args = parser.parse_args(argv)

    settings = load()
    with psycopg.connect(settings.database_url) as conn:
        if args.cmd == "invites":
            for _ in range(args.count):
                code = crypto.new_invite_code()
                conn.execute(
                    "INSERT INTO invites (code_hmac, expires_at) VALUES (%s, now() + make_interval(days => %s))",
                    (crypto.keyed_hash(settings.hmac_key, crypto.normalize_invite_code(code)), args.days),
                )
                print(code)
        elif args.cmd == "settings":
            if args.key and args.value is not None:
                if args.key not in ("account_cap", "redeem_paused"):
                    sys.exit(f"unknown setting {args.key}")
                conn.execute("UPDATE settings SET value = %s WHERE key = %s", (args.value, args.key))
            for key, value in conn.execute("SELECT key, value FROM settings ORDER BY key"):
                print(f"{key} = {value}")
        elif args.cmd == "stats":
            queries = {
                "accounts": "SELECT count(*) FROM accounts",
                "invites unused": "SELECT count(*) FROM invites WHERE redeemed_at IS NULL AND expires_at > now()",
                "invites redeemed": "SELECT count(*) FROM invites WHERE redeemed_at IS NOT NULL",
                "invites expired": "SELECT count(*) FROM invites WHERE redeemed_at IS NULL AND expires_at <= now()",
                "devices": "SELECT count(*) FROM devices",
            }
            for label, sql in queries.items():
                print(f"{label}: {conn.execute(sql).fetchone()[0]}")


if __name__ == "__main__":
    main()
