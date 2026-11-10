#!/usr/bin/env python3
"""The page a device opens to confirm that it, and not someone at another browser, wants to be inspected
(toomore/anoni-net-ws#480). It listens only inside the tunnel, so whoever reaches it is on a device of this node, and
the tunnel address says which one: WireGuard does not let a peer send from another peer's address. The portal
collects what is written here through awgctl inspect confirms.

Runs in the container's network namespace (vessel-inspect-confirm.sh). Without a certificate it does not start."""

import http.server
import os
import re
import ssl
import sys
import tempfile
from pathlib import Path

D = Path(os.environ.get("VESSEL_NODE_DIR", "/opt/vessel-node"))
CONFIRMS = D / "inspect-confirm"
LISTEN = os.environ.get("VESSEL_CONFIRM_LISTEN", "10.8.1.1")
PORT = int(os.environ.get("VESSEL_CONFIRM_PORT", "443"))
SUBNET = os.environ.get("VESSEL_CONFIRM_SUBNET", "10.8.1.")
CODE = re.compile(r"^/c/([A-Z0-9]{16})/?$")

# Both pages say in their title what happened, and mark the English part as English (WCAG 2.4.2, 3.1.1, 3.1.2).
HEAD = """<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title><body style="font-family:system-ui,sans-serif;max-width:32em;margin:3em auto;padding:0 1.2em;line-height:1.7;color:#17295e;background:#fff">"""
DONE = HEAD.format(title="已確認這台裝置 · Device confirmed · Vessel") + """
<h1 style="color:#0b3ca8">已確認這台裝置</h1><p>回到 Vessel 的裝置頁，檢測會在一分鐘內開始。</p>
<p lang="en">This device is confirmed. Go back to the devices page on Vessel: the inspection starts within a minute.</p>"""
BAD = HEAD.format(title="確認連結不正確 · Link not valid · Vessel") + """
<h1 style="color:#0b3ca8">確認連結不正確</h1><p>請回到 Vessel 的檢測頁，確認這台裝置連著 Vessel，或重新產生確認連結。</p>
<p lang="en">This confirmation link is not valid. On the inspection page on Vessel, check that this device is connected to Vessel, or make a new link.</p>"""


def record(code: str, address: str) -> None:
    """Note that this code was opened from this tunnel address. Written whole, so the portal never reads half."""
    CONFIRMS.mkdir(mode=0o700, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=CONFIRMS, delete=False, prefix=".tmp") as f:
        f.write(address)
    os.replace(f.name, CONFIRMS / code)


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "vessel"
    sys_version = ""

    def do_GET(self):
        match = CODE.match(self.path)
        address = self.client_address[0]
        if match is None or not address.startswith(SUBNET):
            return self.reply(404, BAD)
        record(match[1], address)
        return self.reply(200, DONE)

    def reply(self, status: int, body: str) -> None:
        data = body.encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        """Nothing is logged: the address is only used for the file above."""


def main() -> None:
    cert, key = D / "confirm" / "fullchain.pem", D / "confirm" / "privkey.pem"
    if not cert.exists() or not key.exists():
        print(f"no certificate in {cert.parent}, nothing to serve", file=sys.stderr)
        return
    server = http.server.ThreadingHTTPServer((LISTEN, PORT), Handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert, key)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
