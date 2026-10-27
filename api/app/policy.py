"""Service limits shown to users and enforced by the backend (#433)."""

DEVICE_LIMIT = 3
MONTHLY_QUOTA_BYTES = 50 * 10**9
DEVICE_DAYS = 30            # a device expires this many days after the account's last sign-in
SESSION_DAYS = 30
INVITE_DAYS = 30
