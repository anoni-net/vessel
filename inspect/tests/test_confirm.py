import http.client
import importlib.util
import os
import re
import socket
import ssl
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("confirm", ROOT / "node" / "host" / "vessel-inspect-confirm.py")
confirm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(confirm)
CODE = "ABCDEFGH23456789"


TOKEN = re.compile(r'name="token" value="([0-9a-f]{64})"')


class Page(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        confirm.CONFIRMS = Path(self.tmp.name) / "inspect-confirm"
        confirm.SUBNET = "127.0."
        confirm.TIMEOUT = confirm.Handler.timeout = 1
        confirm._open.clear()
        cert, key = Path(self.tmp.name) / "c.pem", Path(self.tmp.name) / "k.pem"
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert,
                        "-subj", "/CN=confirm.vessel.anoni.net", "-days", "1"], check=True, capture_output=True)
        self.server = confirm.serve(("127.0.0.1", 0), cert, key)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def request(self, method, path, body=None, headers=None):
        client = http.client.HTTPSConnection("127.0.0.1", self.port, context=ssl._create_unverified_context(), timeout=10)
        form = {"Content-Type": "application/x-www-form-urlencoded"} if body is not None else {}
        client.request(method, path, body=body, headers={**form, **(headers or {})})
        r = client.getresponse()
        answer = r.status, r.read().decode(), dict(r.getheaders())
        client.close()
        return answer

    def get(self, path):
        return self.request("GET", path)

    def token(self, code=CODE):
        return TOKEN.search(self.get(f"/c/{code}")[1])[1]

    def written(self):
        return {f.name: f.read_text() for f in confirm.CONFIRMS.iterdir()} if confirm.CONFIRMS.exists() else {}

    def test_opening_the_link_asks_and_writes_nothing(self):
        status, body, headers = self.get(f"/c/{CODE}")
        self.assertEqual(status, 200)
        self.assertIn("確認檢測這台裝置", body)
        self.assertIn(f'<form method="post" action="/c/{CODE}">', body)
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(self.written(), {})

    def test_the_button_writes_the_code_under_the_address(self):
        status, body, _ = self.request("POST", f"/c/{CODE}", f"token={self.token()}", {"Sec-Fetch-Site": "same-origin"})
        self.assertEqual(status, 200)
        self.assertIn("已確認", body)
        self.assertEqual(self.written(), {"127.0.0.1": CODE})

    def test_a_browser_that_does_not_say_where_the_form_came_from_is_held_to_the_token(self):
        self.assertEqual(self.request("POST", f"/c/{CODE}", f"token={self.token()}")[0], 200)
        self.assertEqual(self.written(), {"127.0.0.1": CODE})

    def test_a_form_without_the_pages_token_writes_nothing(self):
        other = self.token("ZZZZZZZZ23456789")
        for body in ("", "token=", "token=" + "0" * 64, f"token={other}", "x=1"):
            self.assertEqual(self.request("POST", f"/c/{CODE}", body)[0], 403, body)
        self.assertEqual(self.written(), {})

    def test_a_token_for_another_address_writes_nothing(self):
        self.assertEqual(self.request("POST", f"/c/{CODE}", f"token={confirm.token(CODE, '10.8.1.9')}")[0], 403)
        self.assertEqual(self.written(), {})

    def test_a_form_sent_from_another_site_writes_nothing(self):
        token = self.token()
        for site in ("cross-site", "same-site", "none"):
            status, body, _ = self.request("POST", f"/c/{CODE}", f"token={token}", {"Sec-Fetch-Site": site})
            self.assertEqual(status, 403, site)
            self.assertIn("請重新打開確認連結", body)
        self.assertEqual(self.written(), {})

    def test_a_body_too_long_is_not_read(self):
        self.assertEqual(self.request("POST", f"/c/{CODE}", f"token={self.token()}&x=" + "a" * 300)[0], 400)
        self.assertEqual(self.written(), {})

    def test_a_device_confirming_again_replaces_its_own(self):
        other = "ZZZZZZZZ23456789"
        self.request("POST", f"/c/{CODE}", f"token={self.token()}")
        self.request("POST", f"/c/{other}", f"token={self.token(other)}")
        self.assertEqual(self.written(), {"127.0.0.1": other})

    def test_an_old_confirmation_goes_when_another_is_written(self):
        confirm.CONFIRMS.mkdir()
        old = confirm.CONFIRMS / "127.0.0.9"
        old.write_text(CODE)
        os.utime(old, (time.time() - 7200,) * 2)
        self.request("POST", f"/c/{CODE}", f"token={self.token()}")
        self.assertEqual(self.written(), {"127.0.0.1": CODE})

    def test_anything_else_writes_nothing(self):
        for path in ("/", "/c/short", "/c/../../etc/passwd", f"/c/{CODE.lower()}", f"/x/{CODE}"):
            self.assertEqual(self.get(path)[0], 404, path)
            self.assertEqual(self.request("POST", path, "token=x")[0], 404, path)
        self.assertFalse(confirm.CONFIRMS.exists())

    def test_every_page_says_its_language_and_what_happened(self):
        pages = (self.get(f"/c/{CODE}")[1], self.request("POST", f"/c/{CODE}", f"token={self.token()}")[1],
                 self.get("/")[1], self.request("POST", f"/c/{CODE}", "token=x")[1])
        for body, title in zip(pages, ("確認檢測這台裝置", "已確認這台裝置", "確認連結不正確", "請重新打開確認連結")):
            self.assertIn('<html lang="zh-Hant">', body)
            self.assertIn(f"<title>{title} · ", body)
            self.assertIn('<p lang="en">', body)
            self.assertIn('name="viewport"', body)

    def test_no_page_may_be_put_inside_another(self):
        for headers in (self.get(f"/c/{CODE}")[2], self.get("/")[2]):
            self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
            self.assertIn("form-action 'self'", headers["Content-Security-Policy"])
            self.assertEqual(headers["X-Frame-Options"], "DENY")

    def test_from_outside_the_tunnel_nothing_is_written(self):
        token = self.token()
        confirm.SUBNET = "10.8.1."
        self.assertEqual(self.get(f"/c/{CODE}")[0], 404)
        self.assertEqual(self.request("POST", f"/c/{CODE}", f"token={token}")[0], 404)
        self.assertFalse(confirm.CONFIRMS.exists())

    def test_a_connection_that_says_nothing_does_not_keep_the_others_waiting(self):
        silent = socket.create_connection(("127.0.0.1", self.port))
        try:
            started = time.monotonic()
            self.assertEqual(self.get(f"/c/{CODE}")[0], 200)
            self.assertLess(time.monotonic() - started, confirm.TIMEOUT)
            # and it is closed once its time is up
            silent.settimeout(confirm.TIMEOUT + 5)
            self.assertEqual(silent.recv(1), b"")
        finally:
            silent.close()

    def test_one_address_holds_only_so_many_connections(self):
        held = [socket.create_connection(("127.0.0.1", self.port)) for _ in range(confirm.PER_ADDRESS)]
        try:
            time.sleep(0.2)
            with self.assertRaises((ssl.SSLError, ConnectionError, http.client.HTTPException)):
                self.get(f"/c/{CODE}")
        finally:
            for s in held:
                s.close()
        # once they are gone the page answers again
        time.sleep(confirm.TIMEOUT + 0.5)
        self.assertEqual(self.get(f"/c/{CODE}")[0], 200)


if __name__ == "__main__":
    unittest.main()
