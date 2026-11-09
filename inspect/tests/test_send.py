import importlib.util
import socket
import threading
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("send", ROOT / "node" / "host" / "vessel-inspect-send.py")
send = importlib.util.module_from_spec(spec)
spec.loader.exec_module(send)


class Send(unittest.TestCase):
    def setUp(self):
        self.server = socket.socket()
        self.addCleanup(self.server.close)
        self.server.bind(("127.0.0.1", 0))
        self.server.listen(1)
        self.port = self.server.getsockname()[1]

    def test_a_host_that_says_nothing_is_found_out_within_a_minute(self):
        conn = send.connect("127.0.0.1", self.port)
        self.addCleanup(conn.close)
        self.assertEqual(conn.getsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE), 1)
        idle = conn.getsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPIDLE)
        every = conn.getsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPINTVL)
        probes = conn.getsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPCNT)
        self.assertLessEqual(idle + every * probes, 60)
        self.assertEqual(conn.getsockopt(socket.IPPROTO_TCP, socket.TCP_USER_TIMEOUT), 60_000)

    def test_the_name_goes_first_and_then_the_capture(self):
        got = []

        def receive():
            peer, _ = self.server.accept()
            with peer:
                while data := peer.recv(1024):
                    got.append(data)

        thread = threading.Thread(target=receive)
        thread.start()
        why = send.run("127.0.0.1", self.port, "tw", ["printf", "pcap"])
        thread.join(5)
        self.assertEqual(b"".join(got), b"vessel-inspect tw\npcap")
        self.assertEqual(why, "the capture ended")

    def test_the_host_closing_ends_it_without_another_packet_and_stops_the_capture(self):
        def close_soon():
            peer, _ = self.server.accept()
            peer.recv(64)
            peer.close()

        thread = threading.Thread(target=close_soon)
        thread.start()
        started = time.monotonic()
        why = send.run("127.0.0.1", self.port, "tw", ["sleep", "60"])
        thread.join(5)
        self.assertLess(time.monotonic() - started, 5)
        self.assertEqual(why, "the connection to the analysis host is gone")

    def test_nothing_listening_is_an_error_for_systemd_to_retry(self):
        self.server.close()
        with self.assertRaises(OSError):
            send.run("127.0.0.1", self.port, "tw", ["sleep", "60"])


if __name__ == "__main__":
    unittest.main()
