"""A STUN server that only answers Binding requests (RFC 5389), for the UDP check on /check/.

The browser sends a Binding request over WebRTC; an answer means the visitor's network lets UDP out to this port, the
one Vessel's nodes listen on. The answer carries the address the request came from (XOR-MAPPED-ADDRESS), which is what
STUN is for. Nothing is logged or kept: not the addresses, not counts. Anything that is not a well-formed Binding
request is dropped without an answer, so the server cannot be used to reflect other traffic.

    python3 stun.py [--host ::] [--port 443]
"""

import argparse
import asyncio
import ipaddress
import socket
import struct

MAGIC_COOKIE = 0x2112A442
BINDING_REQUEST = 0x0001
BINDING_SUCCESS = 0x0101
XOR_MAPPED_ADDRESS = 0x0020
HEADER = struct.Struct("!HHI12s")


def answer(data: bytes, addr: tuple) -> bytes | None:
    """The Binding success response to a request, or None for anything else."""
    if len(data) < HEADER.size:
        return None
    kind, length, cookie, txid = HEADER.unpack_from(data)
    # an RFC 3489 request has no magic cookie; the length covers the attributes, in 4-byte steps
    if kind != BINDING_REQUEST or cookie != MAGIC_COOKIE or length != len(data) - HEADER.size or length % 4:
        return None
    ip = ipaddress.ip_address(addr[0])
    if ip.version == 6 and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    port = addr[1] ^ (MAGIC_COOKIE >> 16)
    if ip.version == 4:
        value = struct.pack("!BBHI", 0, 1, port, int(ip) ^ MAGIC_COOKIE)
    else:
        mask = int.from_bytes(struct.pack("!I", MAGIC_COOKIE) + txid, "big")
        value = struct.pack("!BBH", 0, 2, port) + (int(ip) ^ mask).to_bytes(16, "big")
    attribute = struct.pack("!HH", XOR_MAPPED_ADDRESS, len(value)) + value
    return HEADER.pack(BINDING_SUCCESS, len(attribute), MAGIC_COOKIE, txid) + attribute


class Server(asyncio.DatagramProtocol):
    def connection_made(self, transport):
        self.transport = transport

    def datagram_received(self, data, addr):
        reply = answer(data, addr)
        if reply:
            self.transport.sendto(reply, addr)

    def error_received(self, exc):
        pass


def bind(host: str, port: int) -> socket.socket:
    """A UDP socket on host:port; on "::" it takes IPv4 too where the system allows."""
    family = socket.AF_INET6 if ":" in host else socket.AF_INET
    sock = socket.socket(family, socket.SOCK_DGRAM)
    if family == socket.AF_INET6:
        try:
            sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        except OSError:
            pass
    sock.bind((host, port))
    return sock


async def serve(host: str, port: int) -> None:
    loop = asyncio.get_running_loop()
    transport, _ = await loop.create_datagram_endpoint(Server, sock=bind(host, port))
    print(f"STUN on {host} port {port}/udp", flush=True)
    try:
        await asyncio.Event().wait()
    finally:
        transport.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--host", default="::")
    parser.add_argument("--port", type=int, default=443)
    args = parser.parse_args()
    try:
        asyncio.run(serve(args.host, args.port))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
