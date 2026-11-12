#!/usr/bin/env python3
"""Receive the inspection streams from the nodes (node/host/vessel-inspect-stream.sh) into spool files for analyze.py.

Each connection starts with a line naming the node, then a pcap stream. Only the nodes listed in VESSEL_INSPECT_NODES
are listened to, each from its own tailnet address and under its own name: what arrives here becomes a person's report,
so nobody else who can reach the port, and no node in another's name, may add to it. Files are cut on packet boundaries, every
ROTATE_SECONDS or ROTATE_BYTES, and only appear under their final name when complete. The time is watched apart from
the packets, so a device that goes quiet does not leave its last packets waiting on disk. SIGUSR1 cuts every file now,
for the portal when an inspection ends."""

import asyncio
import datetime as dt
import ipaddress
import os
import re
import shutil
import signal
import struct
import sys
import time
from pathlib import Path

HOME = Path(os.environ.get("VESSEL_INSPECT_HOME", "/var/lib/vessel-inspect"))
ROTATE_SECONDS = int(os.environ.get("VESSEL_INSPECT_ROTATE", "900"))
ROTATE_BYTES = 64 * 10**6
MAX_PACKET = 262144
DISK_LIMIT = 0.9
NAME = re.compile(rb"^vessel-inspect ([a-zA-Z0-9][a-zA-Z0-9_.-]{0,62})\n$")
CHECK_EVERY = 10
NODE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$")
serial = 0
spools = set()
# address -> name, from VESSEL_INSPECT_NODES
NODES: dict[str, str] = {}


class Spool:
    def __init__(self, node: str, header: bytes):
        self.dir = HOME / "spool" / node
        self.dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.header = header
        self.file = None

    def open(self):
        global serial
        serial += 1
        stamp = dt.datetime.now(dt.UTC).strftime("%Y%m%d%H%M%S")
        self.path = self.dir / f"{stamp}-{serial}.pcap"
        self.part = self.path.with_suffix(".part")
        self.file = open(self.part, "wb")  # noqa: SIM115 - stays open across packets until the file is cut
        self.file.write(self.header)
        self.size = len(self.header)
        self.started = time.monotonic()

    def write(self, record: bytes):
        if self.file is None:
            self.open()
        self.file.write(record)
        self.size += len(record)
        if self.size >= ROTATE_BYTES or time.monotonic() - self.started >= ROTATE_SECONDS:
            self.close()

    def close(self):
        if self.file is not None:
            self.file.close()
            self.file = None
            os.replace(self.part, self.path)


def note_connected():
    """Which nodes are connected, for analyze.py status."""
    part = HOME / "connected.part"
    part.write_text("\n".join(sorted({spool.dir.name for spool in spools})))
    os.replace(part, HOME / "connected")


def cut_old():
    for spool in spools:
        if spool.file is not None and time.monotonic() - spool.started >= ROTATE_SECONDS:
            spool.close()


def cut_all():
    for spool in spools:
        spool.close()


async def keep_cutting():
    while True:
        await asyncio.sleep(CHECK_EVERY)
        cut_old()


def disk_full() -> bool:
    usage = shutil.disk_usage(HOME)
    return usage.used / usage.total >= DISK_LIMIT


def parse_nodes(text: str) -> dict[str, str]:
    """VESSEL_INSPECT_NODES, "sg=100.64.0.1 jp=100.64.0.2": the address each node sends from, to its name."""
    nodes = {}
    for item in text.split():
        name, _, address = item.partition("=")
        if not NODE.match(name) or name in nodes.values():
            sys.exit(f"VESSEL_INSPECT_NODES: {item!r} is not <name>=<tailnet IP>, or the name is there twice")
        try:
            address = str(ipaddress.ip_address(address))
        except ValueError:
            sys.exit(f"VESSEL_INSPECT_NODES: {item!r} is not <name>=<tailnet IP>")
        if address in nodes:
            sys.exit(f"VESSEL_INSPECT_NODES: {address} is there twice")
        nodes[address] = name
    return nodes


def sender(writer: asyncio.StreamWriter) -> str | None:
    """The node this connection comes from, by its address, or None for one that is not a node."""
    peer = writer.get_extra_info("peername")
    try:
        address = ipaddress.ip_address(peer[0])
    except (TypeError, IndexError, ValueError):
        return None
    return NODES.get(str(getattr(address, "ipv4_mapped", None) or address))


async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    spool = None
    try:
        node = sender(writer)
        if node is None:
            return
        match = NAME.match(await asyncio.wait_for(reader.readline(), 30))
        # the name a node gives is its own, and nobody else's
        if match is None or match[1].decode() != node:
            return
        spool = Spool(match[1].decode(), await reader.readexactly(24))
        spools.add(spool)
        note_connected()
        while True:
            head = await reader.readexactly(16)
            length = struct.unpack("<I", head[8:12])[0]
            if length > MAX_PACKET or disk_full():
                return
            spool.write(head + await reader.readexactly(length))
    except (asyncio.IncompleteReadError, TimeoutError, ConnectionError):
        pass
    finally:
        if spool is not None:
            spools.discard(spool)
            spool.close()
            note_connected()
        writer.close()


async def main():
    host, _, port = os.environ.get("VESSEL_INSPECT_LISTEN", "").rpartition(":")
    if not host:
        sys.exit("set VESSEL_INSPECT_LISTEN to <tailnet IP>:<port>")
    NODES.clear()
    NODES.update(parse_nodes(os.environ.get("VESSEL_INSPECT_NODES", "")))
    if not NODES:
        sys.exit("set VESSEL_INSPECT_NODES to the nodes that may send, as <name>=<tailnet IP> separated by spaces")
    (HOME / "spool").mkdir(parents=True, exist_ok=True, mode=0o700)
    note_connected()
    loop = asyncio.get_running_loop()
    loop.add_signal_handler(signal.SIGUSR1, cut_all)
    stopping = asyncio.Event()
    for name in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(name, stopping.set)
    cutting = asyncio.create_task(keep_cutting())  # kept: the loop holds only a weak reference to a task
    server = await asyncio.start_server(handle, host, int(port))
    await stopping.wait()
    # what has been received goes to the next analysis, instead of being lost with the process and leaving a partial file.
    # Not wait_closed(): it would wait for the nodes to hang up
    server.close()
    cutting.cancel()
    cut_all()


if __name__ == "__main__":
    asyncio.run(main())
