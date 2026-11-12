"""In-memory rate limits. Nothing is written to disk, and the keys (IPs) are dropped once their window ends."""

import ipaddress
import threading
import time
from collections import defaultdict, deque


def bucket(key: str) -> str:
    """Whom a limit counts together. An IPv6 address counts as its /64: a network hands a whole /64 to one connection,
    and whoever has it can change address with every request. Anything else (an IPv4 address, the onion site's shared
    key) counts as itself."""
    try:
        address = ipaddress.ip_address(key)
    except ValueError:
        return key
    if address.version == 4:
        return key
    if address.ipv4_mapped:
        return str(address.ipv4_mapped)
    return str(ipaddress.IPv6Network((int(address) >> 64 << 64, 64)))


class Limiter:
    def __init__(self, limit: int, window_seconds: float):
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        # requests run in threads: the sweep walks the whole table while others add to it
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        key = bucket(key)
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and now - hits[0] > self.window:
                hits.popleft()
            if len(hits) >= self.limit:
                return False
            hits.append(now)
            if len(self._hits) > 10_000:
                self._sweep(now)
            return True

    def _sweep(self, now: float) -> None:
        for key in [k for k, v in self._hits.items() if not v or now - v[-1] > self.window]:
            del self._hits[key]

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()
