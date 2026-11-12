#!/usr/bin/env python3
"""The page a device opens to confirm that it, and not someone at another browser, wants to be inspected
(toomore/anoni-net-ws#480). It listens only inside the tunnel, so whoever reaches it is on a device of this node, and
the tunnel address says which one: WireGuard does not let a peer send from another peer's address. The portal
collects what is written here through awgctl inspect confirms.

Opening the link confirms nothing: the page asks, and the person presses the button. A page elsewhere can make a
device load an address (an image, a redirect), so the confirmation is a form sent from this page itself, with a value
only this page was given.

Runs in the container's network namespace (vessel-inspect-confirm.sh). Without a certificate it does not start."""

import hashlib
import hmac
import http.server
import os
import re
import secrets
import ssl
import sys
import tempfile
import threading
import time
import urllib.parse
from pathlib import Path

D = Path(os.environ.get("VESSEL_NODE_DIR", "/opt/vessel-node"))
CONFIRMS = D / "inspect-confirm"
LISTEN = os.environ.get("VESSEL_CONFIRM_LISTEN", "10.8.1.1")
PORT = int(os.environ.get("VESSEL_CONFIRM_PORT", "443"))
SUBNET = os.environ.get("VESSEL_CONFIRM_SUBNET", "10.8.1.")
CODE = re.compile(r"^/c/([A-Z0-9]{16})/?$")
# a confirmation the portal has not read by then is of no use to anybody (awgctl inspect confirms drops them too)
KEEP_SECONDS = 3600
# One device cannot keep the page from the others: a connection gets this long for the TLS handshake and for each
# read, a device holds a few connections at once, and all devices together a bounded number of threads.
TIMEOUT = 10
PER_ADDRESS = 4
CONNECTIONS = 128
MAX_BODY = 256
# a longer body is read and dropped up to this much, then the connection is closed
MAX_DRAIN = 16 * 1024
# made anew each time the service starts: a page open across a restart is loaded again
SECRET = secrets.token_bytes(32)

# Every page says in its title what happened, and marks the English part as English (WCAG 2.4.2, 3.1.1, 3.1.2).
HEAD = """<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title><body style="font-family:system-ui,sans-serif;max-width:32em;margin:3em auto;padding:0 1.2em;line-height:1.7;color:#17295e;background:#fff">"""
ASK = HEAD.format(title="確認檢測這台裝置 · Confirm inspecting this device · Vessel") + """
<h1 style="color:#0b3ca8">確認檢測這台裝置</h1>
<p>按下確認之後，Vessel 會開始檢測這台裝置的連線，蒐集的內容與期間寫在 Vessel 檢測頁的說明裡。</p>
<p>如果你沒有在 Vessel 的檢測頁開啟檢測，請不要按確認，關掉這一頁即可。</p>
<p lang="en">After you confirm, Vessel starts inspecting this device's connections, as the inspection page on Vessel describes. If you did not start an inspection there, do not confirm: close this page.</p>
<form method="post" action="/c/{code}"><input type="hidden" name="token" value="{token}">
<button type="submit" style="font:inherit;font-weight:600;padding:.7em 1.4em;border:0;border-radius:.5em;background:#0b3ca8;color:#fff">確認 <span lang="en">Confirm</span></button></form>"""
DONE = HEAD.format(title="已確認這台裝置 · Device confirmed · Vessel") + """
<h1 style="color:#0b3ca8">已確認這台裝置</h1><p>回到 Vessel 的裝置頁，檢測會在一分鐘內開始。</p>
<p lang="en">This device is confirmed. Go back to the devices page on Vessel: the inspection starts within a minute.</p>"""
BAD = HEAD.format(title="確認連結不正確 · Link not valid · Vessel") + """
<h1 style="color:#0b3ca8">確認連結不正確</h1><p>請回到 Vessel 的檢測頁，確認這台裝置連著 Vessel，或重新產生確認連結。</p>
<p lang="en">This confirmation link is not valid. On the inspection page on Vessel, check that this device is connected to Vessel, or make a new link.</p>"""
AGAIN = HEAD.format(title="請重新打開確認連結 · Open the link again · Vessel") + """
<h1 style="color:#0b3ca8">請重新打開確認連結</h1><p>這一頁放得太久，或不是從確認頁送出的。請重新打開確認連結，再按一次確認。</p>
<p lang="en">This page was open for too long, or the confirmation did not come from it. Open the confirmation link again and confirm once more.</p>"""

_open: dict[str, int] = {}
_open_lock = threading.Lock()


def token(code: str, address: str) -> str:
    """What the page puts in its form: only someone who was given the page by this service, for this code and from
    this address, has it. A page elsewhere cannot read ours, so it cannot send the form for the device."""
    return hmac.new(SECRET, f"{code} {address}".encode(), hashlib.sha256).hexdigest()


def record(code: str, address: str) -> None:
    """Note that this code was confirmed from this tunnel address: one file per address, holding the code, so a device
    confirming again replaces its own and the directory never holds more files than the node has addresses. Written
    whole, so the portal never reads half."""
    CONFIRMS.mkdir(mode=0o700, exist_ok=True)
    now = time.time()
    for old in CONFIRMS.iterdir():
        try:
            if now - old.stat().st_mtime > KEEP_SECONDS:
                old.unlink()
        except OSError:
            pass
    with tempfile.NamedTemporaryFile("w", dir=CONFIRMS, delete=False, prefix=".tmp") as f:
        f.write(code)
    os.replace(f.name, CONFIRMS / address)


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    context: ssl.SSLContext

    def verify_request(self, request, client_address) -> bool:
        """Turn away a connection past what one device, or all of them, may hold at once."""
        address = client_address[0]
        with _open_lock:
            if _open.get(address, 0) >= PER_ADDRESS or sum(_open.values()) >= CONNECTIONS:
                return False
            _open[address] = _open.get(address, 0) + 1
        return True

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            address = client_address[0]
            with _open_lock:
                _open[address] -= 1
                if not _open[address]:
                    del _open[address]

    def handle_error(self, request, client_address):
        """Nothing is logged: the default prints the address of whoever the connection failed for."""


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "vessel"
    sys_version = ""
    timeout = TIMEOUT

    def setup(self):
        # The handshake is done here, in the connection's own thread and against the clock. Done by the listening
        # socket, one connection that says nothing would keep every other device waiting.
        self.request.settimeout(TIMEOUT)
        self.request = self.server.context.wrap_socket(self.request, server_side=True)
        super().setup()

    def code(self) -> str | None:
        """The code in the address, when the request comes from a device of this node."""
        match = CODE.match(self.path)
        return match[1] if match and self.client_address[0].startswith(SUBNET) else None

    def do_GET(self):
        code = self.code()
        if code is None:
            return self.reply(404, BAD)
        return self.reply(200, ASK.format(code=code, token=token(code, self.client_address[0])))

    def finish(self):
        super().finish()
        # the server closes the socket it accepted, which the TLS one above replaced
        self.request.close()

    def body(self) -> str | None:
        """The form as sent, or None when it is longer than any form of ours. Read before any answer, also one that
        turns the request down: an answer to a request not yet read may not reach the browser."""
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            return None
        if not 0 <= length <= MAX_DRAIN:
            return None
        data = self.rfile.read(length)
        return data.decode("ascii", "replace") if length <= MAX_BODY else None

    def do_POST(self):
        form = self.body()
        code = self.code()
        if code is None:
            return self.reply(404, BAD)
        if form is None:
            return self.reply(400, AGAIN)
        # a browser says where a form was sent from; one sent from another site is not the person's answer. Browsers
        # that do not say are held to the token alone
        if self.headers.get("Sec-Fetch-Site", "same-origin") != "same-origin":
            return self.reply(403, AGAIN)
        sent = urllib.parse.parse_qs(form).get("token", [""])[0]
        if not hmac.compare_digest(sent.encode(), token(code, self.client_address[0]).encode()):
            return self.reply(403, AGAIN)
        record(code, self.client_address[0])
        return self.reply(200, DONE)

    def reply(self, status: int, body: str) -> None:
        data = body.encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        # the page's own styles and its one form, and never inside another page, where the button could be covered
        self.send_header("Content-Security-Policy",
                         "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        """Nothing is logged: the address is only used for the file above."""


def serve(address: tuple[str, int], cert: Path, key: Path) -> Server:
    server = Server(address, Handler)
    server.context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    server.context.load_cert_chain(cert, key)
    return server


def main() -> None:
    cert, key = D / "confirm" / "fullchain.pem", D / "confirm" / "privkey.pem"
    if not cert.exists() or not key.exists():
        print(f"no certificate in {cert.parent}, nothing to serve", file=sys.stderr)
        return
    serve((LISTEN, PORT), cert, key).serve_forever()


if __name__ == "__main__":
    main()
