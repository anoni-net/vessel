import threading

from app.ratelimit import Limiter, bucket


def test_an_ipv6_address_counts_as_its_64():
    assert bucket("2001:db8:1:2:aaaa::1") == bucket("2001:db8:1:2:bbbb::9") == "2001:db8:1:2::/64"
    assert bucket("2001:db8:1:3::1") != bucket("2001:db8:1:2::1")
    assert bucket("::1") == "::/64"


def test_other_keys_count_as_themselves():
    assert bucket("203.0.113.7") == "203.0.113.7"
    assert bucket("::ffff:203.0.113.7") == "203.0.113.7"
    assert bucket("onion") == "onion"
    assert bucket("-") == "-"


def test_changing_address_within_a_64_does_not_get_around_the_limit():
    limiter = Limiter(limit=3, window_seconds=60)
    assert all(limiter.allow(f"2001:db8:1:2::{n:x}") for n in range(3))
    assert not limiter.allow("2001:db8:1:2:ffff::1")
    assert limiter.allow("2001:db8:1:3::1")


def test_ipv4_addresses_are_counted_apart():
    limiter = Limiter(limit=1, window_seconds=60)
    assert limiter.allow("203.0.113.7") and limiter.allow("203.0.113.8")
    assert not limiter.allow("203.0.113.7")


def test_many_threads_at_once_past_the_sweep():
    """The sweep walks the table while other requests add to it."""
    limiter = Limiter(limit=1, window_seconds=0)
    failed = []

    def run(start: int) -> None:
        try:
            for n in range(start, start + 4000):
                limiter.allow(f"198.{n >> 16 & 255}.{n >> 8 & 255}.{n & 255}")
        except Exception as e:  # noqa: BLE001 - whatever goes wrong in a thread fails the test
            failed.append(e)

    threads = [threading.Thread(target=run, args=(i * 4000,)) for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert failed == []
