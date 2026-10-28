"""Maintainer commands, run on the portal host. There is no admin web UI.

  python -m app.admin invites create [--count N] [--days D]   print new invite codes, one per line
  python -m app.admin settings [KEY VALUE]                     show or change a setting
  python -m app.admin stats                                    counts only, no per-account data
  python -m app.admin report [--days N]                        totals for reviewing the test, and the daily
                                                               stats of the last N days (default 14)
  python -m app.admin regions [set ID --node-host HOST (--open|--closed)]
                                                               list regions, or add/change one

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
    rp = sub.add_parser("report")
    rp.add_argument("--days", type=int, default=14)
    rg = sub.add_parser("regions")
    rg_sub = rg.add_subparsers(dest="action")
    rs = rg_sub.add_parser("set")
    rs.add_argument("id")
    rs.add_argument("--node-host", required=True)
    state = rs.add_mutually_exclusive_group(required=True)
    state.add_argument("--open", dest="is_open", action="store_true")
    state.add_argument("--closed", dest="is_open", action="store_false")
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
        elif args.cmd == "regions":
            if args.action == "set":
                conn.execute(
                    "INSERT INTO regions (id, node_host, is_open) VALUES (%s, %s, %s) "
                    "ON CONFLICT (id) DO UPDATE SET node_host = EXCLUDED.node_host, is_open = EXCLUDED.is_open",
                    (args.id, args.node_host, args.is_open),
                )
            for rid, host, is_open in conn.execute("SELECT id, node_host, is_open FROM regions ORDER BY id"):
                print(f"{rid}  {host}  {'open' if is_open else 'closed'}")
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
        elif args.cmd == "report":
            report(conn, args.days)


def size(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1000:
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1000
    return f"{n:.1f} TB"


def one(conn: psycopg.Connection, sql: str, params: tuple = ()) -> int:
    return conn.execute(sql, params).fetchone()[0]


def counts(conn: psycopg.Connection, sql: str) -> str:
    return ", ".join(f"{k} {v}" for k, v in conn.execute(sql).fetchall()) or "-"


MONTH = "date_trunc('month', current_date)"


def report(conn: psycopg.Connection, days: int) -> None:
    """Totals only, for the weekly review of the test: nothing here names or singles out an account or device."""
    accounts = one(conn, "SELECT count(*) FROM accounts")
    new = one(conn, "SELECT count(*) FROM accounts WHERE created_on > current_date - 7")
    print(f"accounts: {accounts} (new in the last 7 days: {new})")
    print("last used the portal: " + counts(
        conn,
        "SELECT CASE WHEN last_login_on > current_date - 7 THEN 'within 7 days' "
        "WHEN last_login_on > current_date - 30 THEN 'within 30 days' ELSE 'longer ago' END AS k, count(*) "
        "FROM accounts GROUP BY k ORDER BY k DESC",
    ))
    print("invites: " + counts(
        conn,
        "SELECT CASE WHEN redeemed_at IS NOT NULL THEN 'redeemed' WHEN expires_at <= now() THEN 'expired' "
        "ELSE 'unused' END AS k, count(*) FROM invites GROUP BY k ORDER BY k",
    ))
    print(f"devices: {one(conn, 'SELECT count(*) FROM devices')}")
    for label, column in (("by region", "region_id"), ("by filter", "dns_filter"), ("by status", "status")):
        print(f"  {label}: " + counts(conn, f"SELECT {column}, count(*) FROM devices GROUP BY 1 ORDER BY 1"))
    idle = one(
        conn,
        "SELECT count(*) FROM devices d WHERE d.created_on < current_date AND d.status <> 'revoking' "
        "AND NOT EXISTS (SELECT 1 FROM device_usage u WHERE u.device_id = d.id "
        f"AND u.period = {MONTH} AND u.rx_bytes + u.tx_bytes > 0)",
    )
    print(f"devices older than a day with no traffic this month: {idle}")
    rows = conn.execute(
        "SELECT d.region_id, sum(u.rx_bytes + u.tx_bytes) FROM device_usage u JOIN devices d ON d.id = u.device_id "
        f"WHERE u.period = {MONTH} GROUP BY 1 ORDER BY 1"
    ).fetchall()
    by_region = ", ".join(f"{region} {size(b)}" for region, b in rows) or "-"
    print(f"traffic this month: {by_region} (total {size(sum(b for _, b in rows))})")
    full = one(
        conn,
        f"SELECT count(*) FROM account_usage WHERE period = {MONTH} AND rx_bytes + tx_bytes >= %s",
        (policy.MONTHLY_QUOTA_BYTES,),
    )
    print(f"accounts at the monthly quota: {full}")
    print(f"daily, UTC, last {days} days (active: devices with a handshake that day):")
    print(f"  {'day':10}  {'region':6}  {'active':>6}  {'traffic':>9}  {'expired':>7}")
    for day, region, active, rx, tx, expired in conn.execute(
        "SELECT day, region_id, active_devices, rx_bytes, tx_bytes, expired_devices FROM daily_stats "
        "WHERE day > current_date - %s ORDER BY day, region_id",
        (days,),
    ):
        print(f"  {day.isoformat():10}  {region:6}  {active:6}  {size(rx + tx):>9}  {expired:7}")

if __name__ == "__main__":
    main()
