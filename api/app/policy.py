"""Service limits shown to users and enforced by the backend (#433)."""

from dataclasses import dataclass
from datetime import date

DEVICE_LIMIT = 3
NODE_PEER_LIMIT = 248       # a node hands out 10.8.1.2 to .249 (node/awgctl, next_ip); a suspended peer keeps its address
MONTHLY_QUOTA_BYTES = 50 * 10**9
DEVICE_DAYS = 30            # a device expires this many days after the account's last sign-in
SESSION_DAYS = 30
INVITE_DAYS = 30
USER_INVITE_DAYS = 7        # an invite an account makes works this long (toomore/anoni-net-ws#458)
INVITE_AFTER_DAYS = 14      # and an account may make them this many days after it was made
PASSKEY_LIMIT = 5           # passkeys per account: a phone, a computer, a security key, and spares
# Adding or removing a passkey and deleting the account need a person who just proved it is them: signing in counts
# for this long, then they confirm again with a passkey or the account number (app/auth.py, require_recent)
VERIFY_MINUTES = 10
GROUP_BLOCKED_ALERT = 100    # malware lookups in a month that mark a group's device for checking (toomore/anoni-net-ws#464)


@dataclass(frozen=True)
class Limits:
    devices: int
    monthly_quota_bytes: int
    device_expires_on: date  # for a device made today


def limits_of(conn, account_id: int) -> Limits:
    """What applies to an account: its group's settings (toomore/anoni-net-ws#464), or the values above for a personal
    account. A group's devices last until the group ends, however rarely their people sign in."""
    row = conn.execute(
        "SELECT coalesce(g.device_limit, %s), coalesce(g.monthly_quota_bytes, %s), coalesce(g.ends_on, current_date + %s) "
        "FROM accounts a LEFT JOIN groups g ON g.code = a.group_code WHERE a.id = %s",
        (DEVICE_LIMIT, MONTHLY_QUOTA_BYTES, DEVICE_DAYS, account_id),
    ).fetchone()
    return Limits(*row)
