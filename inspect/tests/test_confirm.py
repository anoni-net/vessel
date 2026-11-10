import http.client
import importlib.util
import ssl
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("confirm", ROOT / "node" / "host" / "vessel-inspect-confirm.py")
confirm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(confirm)
CODE = "ABCDEFGH23456789"


class Page(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        confirm.CONFIRMS = Path(self.tmp.name) / "inspect-confirm"
        confirm.SUBNET = "127.0."
        cert, key = Path(self.tmp.name) / "c.pem", Path(self.tmp.name) / "k.pem"
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert,
                        "-subj", "/CN=confirm.vessel.anoni.net", "-days", "1"], check=True, capture_output=True)
        self.server = confirm.http.server.ThreadingHTTPServer(("127.0.0.1", 0), confirm.Handler)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cert, key)
        self.server.socket = context.wrap_socket(self.server.socket, server_side=True)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def get(self, path):
        client = http.client.HTTPSConnection("127.0.0.1", self.server.server_address[1], context=ssl._create_unverified_context())
        client.request("GET", path)
        r = client.getresponse()
        return r.status, r.read().decode(), dict(r.getheaders())

    def test_a_code_opened_on_a_device_is_written_with_its_address(self):
        status, body, headers = self.get(f"/c/{CODE}")
        self.assertEqual(status, 200)
        self.assertIn("已確認", body)
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual((confirm.CONFIRMS / CODE).read_text(), "127.0.0.1")

    def test_anything_else_writes_nothing(self):
        for path in ("/", "/c/short", "/c/../../etc/passwd", f"/c/{CODE.lower()}", f"/x/{CODE}"):
            self.assertEqual(self.get(path)[0], 404, path)
        self.assertFalse(confirm.CONFIRMS.exists())

    def test_both_pages_say_their_language_and_what_happened(self):
        for path, title in ((f"/c/{CODE}", "已確認這台裝置"), ("/", "確認連結不正確")):
            body = self.get(path)[1]
            self.assertIn('<html lang="zh-Hant">', body)
            self.assertIn(f"<title>{title} · ", body)
            self.assertIn('<p lang="en">', body)
            self.assertIn('name="viewport"', body)

    def test_from_outside_the_tunnel_nothing_is_written(self):
        confirm.SUBNET = "10.8.1."
        self.assertEqual(self.get(f"/c/{CODE}")[0], 404)
        self.assertFalse(confirm.CONFIRMS.exists())


if __name__ == "__main__":
    unittest.main()
