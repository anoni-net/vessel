"""Service limits shown to users and enforced by the backend (#433)."""

from dataclasses import dataclass
from datetime import date

DEVICE_LIMIT = 3
NODE_PEER_LIMIT = 248       # a node hands out 10.8.1.2 to .249 (node/awgctl, next_ip); a suspended peer keeps its address
# personal accounts' monthly quota while the setting monthly_quota_gb is missing or not a positive number (personal_quota)
MONTHLY_QUOTA_BYTES = 50 * 10**9
DEVICE_DAYS = 30            # a device expires this many days after the account's last sign-in
SESSION_DAYS = 30
INVITE_DAYS = 30
USER_INVITE_DAYS = 7        # an invite an account makes works this long (toomore/anoni-net-ws#458)
INVITE_AFTER_DAYS = 14      # and an account may make them this many days after it was made
# Pickup numbers (app/pickups.py, toomore/anoni-net-ws#441): how long a request waits for a decision, and how long an
# approved or declined number stays before the worker deletes it
PICKUP_WAIT_DAYS = 30
PICKUP_KEEP_DAYS = 14
# requests taken in a day, and waiting at once, before new ones are turned away: one maintainer reads them all
PICKUP_DAILY = 20
PICKUP_WAITING = 50
PICKUP_NOTE = 200
PICKUP_PURPOSES = ("travel", "school_work", "public_wifi", "privacy", "other")
PICKUP_NETWORKS = ("home", "mobile", "school_work", "public", "other")
PASSKEY_LIMIT = 5           # passkeys per account: a phone, a computer, a security key, and spares
# Adding or removing a passkey and deleting the account need a person who just proved it is them: signing in counts
# for this long, then they confirm again with a passkey or the account number (app/auth.py, require_recent)
VERIFY_MINUTES = 10
INSPECT_DAYS = 7              # how long a device inspection runs
INSPECT_REPORT_DAYS = 7       # how long its report is kept after the end
INSPECT_CONFIRM_MINUTES = 30  # to open the confirmation link on the device
INSPECT_CONSENT_VERSION = "2026-11-14b"
INSPECT_CONFIRM_HOST = "confirm.vessel.anoni.net"
# The consent for an inspection a group's leader asked for: it also says what the leaders see (toomore/anoni-net-ws#483).
# A change to what the leaders see changes this, the group consent page (pages/inspect.tsx) and the privacy policy.
GROUP_INSPECT_CONSENT_VERSION = "2026-11-10g"
GROUP_INSPECT_REQUEST_DAYS = 7  # a leader's request waits this long for the member, and a no stays on the page as long
GROUP_CLOSE_DAYS = 30        # how long a closing group goes on, unless the maintainer gives another day
GROUP_BLOCKED_ALERT = 100    # malware lookups in a month that mark a group's device for checking (toomore/anoni-net-ws#464)


@dataclass(frozen=True)
class Limits:
    devices: int
    monthly_quota_bytes: int
    device_expires_on: date  # for a device made today


def personal_quota(conn) -> int:
    """A personal account's monthly quota in bytes: the setting monthly_quota_gb, which the maintainer changes with
    `python -m app.admin settings monthly_quota_gb N`, or MONTHLY_QUOTA_BYTES."""
    row = conn.execute("SELECT value FROM settings WHERE key = 'monthly_quota_gb'").fetchone()
    value = row[0].strip() if row else ""
    return int(value) * 10**9 if value.isdigit() and int(value) > 0 else MONTHLY_QUOTA_BYTES


def limits_of(conn, account_id: int) -> Limits:
    """What applies to an account: its group's settings (toomore/anoni-net-ws#464), or the values above for a personal
    account (the quota from the settings, personal_quota). A group's devices last until the group ends, however rarely
    their people sign in."""
    row = conn.execute(
        "SELECT coalesce(g.device_limit, %s), coalesce(g.monthly_quota_bytes, %s), coalesce(g.closing_on, g.ends_on, current_date + %s) "
        "FROM accounts a LEFT JOIN groups g ON g.code = a.group_code WHERE a.id = %s",
        (DEVICE_LIMIT, personal_quota(conn), DEVICE_DAYS, account_id),
    ).fetchone()
    return Limits(*row)
