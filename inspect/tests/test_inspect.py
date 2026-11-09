import asyncio
import base64
import json
import os
import struct
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import analyze
import recv

T0 = 1794220032


def ip(src, dst, size):
    a = bytes(map(int, src.split(".")))
    b = bytes(map(int, dst.split(".")))
    return bytes([0x45, 0]) + struct.pack(">H", size) + bytes(5) + bytes([6]) + bytes(2) + a + b


def nflog(packet):
    body = struct.pack("<HH", 4 + len(packet), 9) + packet
    return bytes([2, 0, 0, 42]) + body


def pcap(link, records):
    out = struct.pack("<IHHiIII", 0xa1b2c3d4, 2, 4, 0, 0, 262144, link)
    for ts, data in records:
        out += struct.pack("<IIII", ts, 0, len(data), len(data)) + data
    return out


def logs(**kw):
    return {name: kw.get(name, []) for name in ("conn", "dns", "ssl", "quic", "http")}


def dns(query, ts=T0, rcode="NOERROR", who="10.8.1.3"):
    return {"ts": ts, "id.orig_h": who, "query": query, "rcode_name": rcode}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        analyze.HOME = recv.HOME = Path(self.tmp.name)
        analyze.EXCLUDE = analyze.HOME / "exclude.txt"
        analyze.EXCLUDE.write_text("# why\nshared.example\n")
        (analyze.HOME / "lists").mkdir()
        (analyze.HOME / "lists" / "stalkerware.txt").write_text("0.0.0.0 tracker.example\n0.0.0.0 shared.example\n")
        (analyze.HOME / "lists" / "malware.txt").write_text("bad.example CNAME .\n")
        (analyze.HOME / "lists" / "cti.txt").write_text("evil.example\n")
        (analyze.HOME / "lists" / "ads.txt").write_text("ad.example CNAME .\n")
        self.lists = analyze.load_lists()

    def tearDown(self):
        self.tmp.cleanup()


class Traffic(Base):
    def write(self, link, records):
        path = analyze.HOME / "t.pcap"
        path.write_bytes(pcap(link, records))
        return analyze.traffic(path)

    def test_header_length_counts_even_when_the_packet_was_cut(self):
        cut = ip("10.8.1.3", "1.1.1.1", 1400)[:28]
        hour = analyze.hour_of(T0)
        self.assertEqual(self.write(239, [(T0, nflog(cut))])[("10.8.1.3", hour)], [1400, 0])

    def test_direction_goes_by_the_device(self):
        got = self.write(101, [(T0, ip("10.8.1.3", "1.1.1.1", 100)), (T0, ip("1.1.1.1", "10.8.1.3", 900))])
        self.assertEqual(got[("10.8.1.3", analyze.hour_of(T0))], [100, 900])

    def test_the_nodes_own_addresses_are_not_devices(self):
        got = self.write(101, [(T0, ip("10.8.1.1", "10.8.1.3", 300))])
        self.assertEqual(list(got), [("10.8.1.3", analyze.hour_of(T0))])


class Checks(Base):
    def run_one(self, **kw):
        analyze.merge("n1", {("10.8.1.3", analyze.hour_of(T0)): [10, 20]}, logs(**kw), self.lists)
        return analyze.report("n1", "10.8.1.3")

    def test_a_stalkerware_name_is_a_threat_and_marks_the_hour(self):
        r = self.run_one(dns=[dns("api.tracker.example")])
        self.assertEqual(r["findings"][0]["severity"], "threat")
        self.assertEqual(r["findings"][0]["name"], "api.tracker.example")
        self.assertEqual(r["hours"][0]["mark"], "x")

    def test_other_lists_ask_for_a_check(self):
        r = self.run_one(ssl=[{"ts": T0, "id.orig_h": "10.8.1.3", "server_name": "bad.example"}])
        self.assertEqual((r["findings"][0]["severity"], r["findings"][0]["how"]), ("check", "SNI"))
        self.assertEqual(r["hours"][0]["mark"], "!")

    def test_excluded_names_do_not_count(self):
        self.assertEqual(self.run_one(dns=[dns("shared.example")])["findings"], [])

    def test_a_name_is_not_matched_by_its_tail_of_letters(self):
        self.assertEqual(self.run_one(dns=[dns("nottracker.example")])["findings"], [])

    def test_dns_to_someone_else_is_a_bypass_and_to_the_node_is_not(self):
        conn = [{"ts": T0, "id.orig_h": "10.8.1.3", "id.resp_h": "8.8.8.8", "id.resp_p": 53},
                {"ts": T0, "id.orig_h": "10.8.1.3", "id.resp_h": "10.8.1.1", "id.resp_p": 53}]
        r = self.run_one(conn=conn)
        self.assertEqual([c["count"] for c in r["checks"] if c["id"] == "bypass_dns"], [1])

    def test_a_name_the_nodes_lists_stopped_is_not_a_name_that_does_not_exist(self):
        rows = [dns("blocked.example", rcode="NXDOMAIN"), dns("gone.example", rcode="NXDOMAIN"), dns("a.example")]
        analyze.merge("n1", {("10.8.1.3", analyze.hour_of(T0)): [10, 20]},
                      {**logs(dns=rows), "blocked": {("10.8.1.3", "blocked.example")}}, self.lists)
        r = analyze.report("n1", "10.8.1.3")
        self.assertEqual(r["nx_names"], [{"name": "gone.example", "count": 1}])
        self.assertEqual(r["dns"]["total"], 3)

    def test_a_name_on_a_list_still_counts_when_the_node_stopped_it(self):
        rows = [dns("api.tracker.example", rcode="NXDOMAIN")]
        analyze.merge("n1", {("10.8.1.3", analyze.hour_of(T0)): [10, 20]},
                      {**logs(dns=rows), "blocked": {("10.8.1.3", "api.tracker.example")}}, self.lists)
        r = analyze.report("n1", "10.8.1.3")
        self.assertEqual(r["findings"][0]["name"], "api.tracker.example")
        self.assertEqual(r["nx_names"], [])

    def test_the_name_the_ad_list_points_to_is_not_counted(self):
        r = self.run_one(dns=[dns("blocked.vessel", rcode="NXDOMAIN"), dns("a.example")])
        self.assertEqual(r["nx_names"], [])
        self.assertEqual(r["dns"]["total"], 1)

    def test_shares(self):
        r = self.run_one(dns=[dns("ad.example"), dns("x.example", rcode="NXDOMAIN"), dns("a.example"), dns("b.example")])
        self.assertEqual((r["dns"]["ads_share"], r["dns"]["nx_share"]), (0.25, 0.25))
        self.assertEqual(r["nx_names"], [{"name": "x.example", "count": 1}])

    def test_the_sites_visited_are_not_in_the_state_or_the_report(self):
        r = self.run_one(dns=[dns("private-site.example")], ssl=[{"ts": T0, "id.orig_h": "10.8.1.3", "server_name": "secret.example"}])
        text = json.dumps(r) + analyze.state_path("n1", "10.8.1.3").read_text()
        self.assertNotIn("private-site", text)
        self.assertNotIn("secret.example", text)

    def test_idle_hours_in_taipei(self):
        two_am = 1794247200  # 18:00 UTC is 02:00 in Taipei
        analyze.merge("n1", {("10.8.1.3", analyze.hour_of(two_am)): [30, 70]}, logs(), self.lists)
        analyze.merge("n1", {("10.8.1.3", analyze.hour_of(T0)): [50, 50]}, logs(), self.lists)
        self.assertEqual(analyze.report("n1", "10.8.1.3")["idle_share"], 0.5)

    def test_clear_means_a_reused_address_starts_empty(self):
        self.run_one(dns=[dns("api.tracker.example")])
        analyze.state_path("n1", "10.8.1.3").unlink()
        self.assertTrue(analyze.report("n1", "10.8.1.3")["empty"])


class Seal(Base):
    def test_only_the_private_key_opens_it(self):
        from cryptography.exceptions import InvalidTag
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        from cryptography.hazmat.primitives.kdf.hkdf import HKDF

        def opened(private, box):
            shared = private.exchange(X25519PublicKey.from_public_bytes(base64.b64decode(box["epk"])))
            key = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=b"vessel-inspection-report").derive(shared)
            return AESGCM(key).decrypt(base64.b64decode(box["iv"]), base64.b64decode(box["ct"]), None)

        mine = X25519PrivateKey.generate()
        public = base64.b64encode(mine.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
        box = analyze.seal(b'{"report": 1}', public)
        self.assertEqual(opened(mine, box), b'{"report": 1}')
        self.assertNotIn("report", json.dumps(box))
        with self.assertRaises(InvalidTag):
            opened(X25519PrivateKey.generate(), box)


def dns_answer(name, flags, src="10.8.1.253", dst="10.8.1.3", sport=53):
    question = b"".join(bytes([len(p)]) + p.encode() for p in name.split(".")) + b"\0\0\1\0\1"
    body = struct.pack(">HHHHHH", 1, flags, 1, 0, 0, 0) + question
    udp = struct.pack(">HHHH", sport, 40000, 8 + len(body), 0) + body
    addr = lambda a: bytes(map(int, a.split(".")))  # noqa: E731
    return bytes([0x45, 0]) + struct.pack(">HHHBBH", 20 + len(udp), 0, 0, 64, 17, 0) + addr(src) + addr(dst) + udp


class BlockedAnswers(Base):
    def found(self, *packets):
        path = analyze.HOME / "c.pcap"
        path.write_bytes(pcap(101, [(T0, p) for p in packets]))
        return analyze.blocked_answers(path)

    def test_nxdomain_with_ra_cleared_is_the_nodes_own(self):
        self.assertEqual(self.found(dns_answer("Bad.Example", 0x8003)), {("10.8.1.3", "bad.example")})

    def test_a_name_that_does_not_exist_has_ra_set(self):
        self.assertEqual(self.found(dns_answer("gone.example", 0x8183)), set())

    def test_an_ordinary_answer_is_not_blocked(self):
        self.assertEqual(self.found(dns_answer("a.example", 0x8180)), set())

    def test_only_the_nodes_resolvers_count(self):
        self.assertEqual(self.found(dns_answer("bad.example", 0x8003, src="8.8.8.8")), set())

    def test_a_packet_cut_before_the_name_ends_is_skipped(self):
        self.assertEqual(self.found(dns_answer("a.example", 0x8003)[:45]), set())

    def test_the_flag_is_read_from_a_packet_as_the_node_sends_it(self):
        path = analyze.HOME / "c.pcap"
        path.write_bytes(pcap(239, [(T0, nflog(dns_answer("bad.example", 0x8003)))]))
        self.assertEqual(analyze.blocked_answers(path), {("10.8.1.3", "bad.example")})


class Status(Base):
    def test_status_says_when_the_analysis_last_ran(self):
        (analyze.HOME / "spool").mkdir()
        self.assertIsNone(analyze.status()["last_batch"])
        analyze.batch()
        self.assertIsNotNone(analyze.status()["last_batch"])


class Batch(Base):
    def test_a_capture_is_deleted_after_it_is_counted(self):
        spool = analyze.HOME / "spool" / "n1"
        spool.mkdir(parents=True)
        (spool / "a.pcap").write_bytes(pcap(101, [(T0, ip("10.8.1.3", "1.1.1.1", 100))]))
        analyze.zeek_logs = lambda path: logs()
        analyze.batch()
        self.assertEqual(list(spool.iterdir()), [])
        self.assertEqual(analyze.report("n1", "10.8.1.3")["hours"][0]["up"], 100)

    def test_a_capture_that_failed_stays_for_the_next_run(self):
        spool = analyze.HOME / "spool" / "n1"
        spool.mkdir(parents=True)
        (spool / "a.pcap").write_bytes(pcap(101, []))

        def fail(path):
            raise OSError("no zeek")

        analyze.zeek_logs = fail
        analyze.batch()
        self.assertEqual(len(list(spool.iterdir())), 1)


class Recv(Base):
    def stream(self, data):
        async def go():
            reader = asyncio.StreamReader()
            reader.feed_data(data)
            reader.feed_eof()

            class W:
                def close(self):
                    pass

            await recv.handle(reader, W())

        asyncio.run(go())
        return sorted((analyze.HOME / "spool").glob("*/*"))

    def test_a_stream_becomes_a_complete_file(self):
        body = pcap(239, [(T0, nflog(ip("10.8.1.3", "1.1.1.1", 100)))])
        files = self.stream(b"vessel-inspect node-1\n" + body)
        self.assertEqual([f.parent.name for f in files], ["node-1"])
        self.assertEqual(files[0].suffix, ".pcap")
        self.assertEqual(files[0].read_bytes(), body)

    def test_a_stream_cut_mid_packet_keeps_the_whole_packets(self):
        one = pcap(101, [(T0, ip("10.8.1.3", "1.1.1.1", 100))])
        files = self.stream(b"vessel-inspect node-1\n" + one + struct.pack("<IIII", T0, 0, 100, 100) + b"xx")
        self.assertEqual(files[0].read_bytes(), one)

    def hold_open(self, check):
        """A stream that has sent one packet and stays connected."""
        body = pcap(239, [(T0, nflog(ip("10.8.1.3", "1.1.1.1", 100)))])

        def suffixes():
            return [f.suffix for f in (analyze.HOME / "spool").glob("*/*")]

        async def go():
            reader = asyncio.StreamReader()
            reader.feed_data(b"vessel-inspect node-1\n" + body)

            class W:
                def close(self):
                    pass

            task = asyncio.create_task(recv.handle(reader, W()))
            await asyncio.sleep(0.01)
            self.assertEqual(suffixes(), [".part"])
            check()
            self.assertEqual(suffixes(), [".pcap"])
            reader.feed_eof()
            await task
            self.assertEqual(recv.spools, set())

        asyncio.run(go())

    def test_a_quiet_stream_is_cut_by_the_clock_without_another_packet(self):
        def check():
            spool = next(iter(recv.spools))
            recv.cut_old()
            self.assertIsNotNone(spool.file)
            spool.started -= recv.ROTATE_SECONDS
            recv.cut_old()

        self.hold_open(check)

    def test_the_portal_can_have_everything_cut_now(self):
        self.hold_open(recv.cut_all)

    def test_a_partial_file_left_by_a_crash_goes_with_the_old_captures(self):
        spool = analyze.HOME / "spool" / "n"
        spool.mkdir(parents=True)
        (spool / "a.part").write_bytes(b"x")
        os.utime(spool / "a.part", (1, 1))
        analyze.purge(8)
        self.assertEqual(list(spool.iterdir()), [])

    def test_a_bad_name_is_refused(self):
        self.assertEqual(self.stream(b"vessel-inspect ../etc\n" + bytes(24)), [])

    def test_a_silly_packet_length_ends_the_stream(self):
        files = self.stream(b"vessel-inspect n\n" + bytes(24) + struct.pack("<IIII", T0, 0, 10**9, 10))
        self.assertEqual(len(files), 0)


if __name__ == "__main__":
    unittest.main()
