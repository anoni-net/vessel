#!/usr/bin/env python3
"""Send the packets of the devices under inspection to the analysis host: what a command (tcpdump) writes, over one TCP
connection. It returns as soon as either end is gone, and systemd connects again.

The analysis host never sends anything, so the connection becoming readable means it was closed. A host that crashed or
lost its network says nothing at all: keepalive finds that out within a minute, where the kernel's default is to retry
sending for about 15 minutes, and not to notice at all while there is nothing to send."""

import os
import select
import socket
import subprocess
import sys

KEEPALIVE_IDLE = 30  # seconds without traffic before the first probe
KEEPALIVE_INTERVAL = 10
KEEPALIVE_PROBES = 3
UNACKED_MS = 60_000  # how long sent data may stay unacknowledged


def connect(host: str, port: int) -> socket.socket:
    conn = socket.create_connection((host, port), timeout=10)
    conn.settimeout(None)
    conn.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
    conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPIDLE, KEEPALIVE_IDLE)
    conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPINTVL, KEEPALIVE_INTERVAL)
    conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPCNT, KEEPALIVE_PROBES)
    conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_USER_TIMEOUT, UNACKED_MS)
    return conn


def pump(conn: socket.socket, source: int) -> str:
    """Copy until one end is gone, and say which."""
    poller = select.poll()
    poller.register(conn, select.POLLIN)
    poller.register(source, select.POLLIN)
    while True:
        for fd, _ in poller.poll():
            if fd == conn.fileno():
                return "the connection to the analysis host is gone"
            data = os.read(source, 65536)
            if not data:
                return "the capture ended"
            conn.sendall(data)


def run(host: str, port: int, name: str, command: list[str]) -> str:
    conn = connect(host, port)
    conn.sendall(f"vessel-inspect {name}\n".encode())
    capture = subprocess.Popen(command, stdout=subprocess.PIPE)
    try:
        return pump(conn, capture.stdout.fileno())
    finally:
        capture.terminate()
        capture.wait()
        conn.close()


if __name__ == "__main__":
    host, port, name, *command = sys.argv[1:]
    try:
        sys.exit(run(host, int(port), name, command))
    except OSError as e:
        sys.exit(f"{host}:{port}: {e}")
