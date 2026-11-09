#!/usr/bin/env python3
"""Receive the inspection streams from the nodes (node/host/vessel-inspect-stream.sh) into spool files for analyze.py.

Each connection starts with a line naming the node, then a pcap stream. Files are cut on packet boundaries, every
ROTATE_SECONDS or ROTATE_BYTES, and only appear under their final name when complete. The time is watched apart from
the packets, so a device that goes quiet does not leave its last packets waiting on disk. SIGUSR1 cuts every file now,
for the portal when an inspection ends."""

import asyncio
import datetime as dt
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
serial = 0
spools = set()


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


async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    spool = None
    try:
        match = NAME.match(await asyncio.wait_for(reader.readline(), 30))
        if match is None:
            return
        spool = Spool(match[1].decode(), await reader.readexactly(24))
        spools.add(spool)
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
        writer.close()


async def main():
    host, _, port = os.environ.get("VESSEL_INSPECT_LISTEN", "").rpartition(":")
    if not host:
        sys.exit("set VESSEL_INSPECT_LISTEN to <tailnet IP>:<port>")
    (HOME / "spool").mkdir(parents=True, exist_ok=True, mode=0o700)
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
