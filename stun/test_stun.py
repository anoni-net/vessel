"""python3 -m unittest discover stun: the server answers a Binding request with the sender's address, and only that."""

import asyncio
import ipaddress
import os
import socket
import struct
import threading
import unittest

from stun import BINDING_SUCCESS, MAGIC_COOKIE, XOR_MAPPED_ADDRESS, Server, answer, bind


def request(txid: bytes, attributes: bytes = b"", cookie: int = MAGIC_COOKIE, kind: int = 1) -> bytes:
    return struct.pack("!HHI12s", kind, len(attributes), cookie, txid) + attributes


def mapped(reply: bytes, txid: bytes) -> tuple[str, int]:
    kind, length, cookie, rtxid = struct.unpack_from("!HHI12s", reply)
    assert (kind, cookie, rtxid, length) == (BINDING_SUCCESS, MAGIC_COOKIE, txid, len(reply) - 20)
    atype, alen, _, family, xport = struct.unpack_from("!HHBBH", reply, 20)
    assert atype == XOR_MAPPED_ADDRESS
    port = xport ^ (MAGIC_COOKIE >> 16)
    raw = reply[28:24 + alen]
    if family == 1:
        return str(ipaddress.IPv4Address(int.from_bytes(raw, "big") ^ MAGIC_COOKIE)), port
    mask = int.from_bytes(struct.pack("!I", MAGIC_COOKIE) + txid, "big")
    return str(ipaddress.IPv6Address(int.from_bytes(raw, "big") ^ mask)), port


class AnswerTest(unittest.TestCase):
    def test_ipv4(self):
        txid = os.urandom(12)
        self.assertEqual(mapped(answer(request(txid), ("203.0.113.7", 50000)), txid), ("203.0.113.7", 50000))

    def test_ipv4_mapped_on_a_dual_stack_socket(self):
        txid = os.urandom(12)
        reply = answer(request(txid), ("::ffff:198.51.100.2", 4242, 0, 0))
        self.assertEqual(reply[25], 1)
        self.assertEqual(mapped(reply, txid), ("198.51.100.2", 4242))

    def test_ipv6(self):
        txid = os.urandom(12)
        self.assertEqual(mapped(answer(request(txid), ("2001:db8::1", 443, 0, 0)), txid), ("2001:db8::1", 443))

    def test_attributes_in_the_request(self):
        txid = os.urandom(12)
        software = struct.pack("!HH", 0x8022, 4) + b"test"
        self.assertEqual(mapped(answer(request(txid, software), ("192.0.2.1", 1)), txid), ("192.0.2.1", 1))

    def test_drops_everything_else(self):
        txid = os.urandom(12)
        addr = ("192.0.2.1", 1)
        for data in (
            b"", b"\x00" * 19, b"GET / HTTP/1.1\r\n\r\n" + b"\x00" * 8,
            request(txid, cookie=0),                       # RFC 3489, no magic cookie
            request(txid, kind=0x0101),                    # a response
            request(txid, kind=0x0011),                    # an indication
            request(txid) + b"\x00" * 4,                   # length does not match
            struct.pack("!HHI12s", 1, 2, MAGIC_COOKIE, txid) + b"\x00\x00",  # not a multiple of 4
        ):
            self.assertIsNone(answer(data, addr), data)


class SocketTest(unittest.TestCase):
    """A real round trip on the loopback address."""

    def setUp(self):
        self.sock = bind("127.0.0.1", 0)
        self.port = self.sock.getsockname()[1]
        self.loop = asyncio.new_event_loop()
        ready = threading.Event()

        def run():
            asyncio.set_event_loop(self.loop)
            self.transport, _ = self.loop.run_until_complete(
                self.loop.create_datagram_endpoint(Server, sock=self.sock))
            ready.set()
            self.loop.run_forever()

        self.thread = threading.Thread(target=run, daemon=True)
        self.thread.start()
        ready.wait(5)

    def tearDown(self):
        self.loop.call_soon_threadsafe(self.transport.close)
        self.loop.call_soon_threadsafe(self.loop.stop)
        self.thread.join(5)
        self.loop.close()

    def test_round_trip(self):
        client = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        client.settimeout(2)
        txid = os.urandom(12)
        client.sendto(request(txid), ("127.0.0.1", self.port))
        reply, _ = client.recvfrom(1024)
        self.assertEqual(mapped(reply, txid), ("127.0.0.1", client.getsockname()[1]))
        client.sendto(b"not stun" * 4, ("127.0.0.1", self.port))
        with self.assertRaises(socket.timeout):
            client.settimeout(0.5)
            client.recvfrom(1024)
        client.close()


if __name__ == "__main__":
    unittest.main()
