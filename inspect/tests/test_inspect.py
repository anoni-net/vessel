import asyncio
import base64
import io
import json
import os
import signal
import socket
import struct
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import analyze
import recv

# other tests swap analyze.zeek_logs for a stand-in; this is the real one
ZEEK_LOGS = analyze.zeek_logs

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
        (analyze.HOME / "lists" / "stalkerware-apps.csv").write_text("type,indicator,app\n")
        (analyze.HOME / "lists" / "spyware.csv").write_text(
            "type,indicator,app\ndomain,spy.example,FakeGroup Spy\ndomain,shared.example,FakeGroup Spy\nipv4,203.0.113.99,OtherSpy\n")
        (analyze.HOME / "lists" / "doh.txt").write_text(
            "$TTL 3600\n@ SOA localhost. root.localhost. 1 2 3 4 5\n  NS  localhost.\n; a comment\n"
            "doh.example CNAME .\n*.doh.example CNAME .\ndoh.dns.apple.com CNAME .\nmask.icloud.com CNAME .\n")
        (analyze.HOME / "lists" / "doh-ips.txt").write_text("# a comment\n192.0.2.53\n17.132.82.11\n2001:db8::53\n")
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
        self.assertEqual(r["findings"][0]["name"], "tracker.example")
        self.assertEqual(r["hours"][0]["mark"], "x")

    def test_the_subdomains_of_a_listed_name_are_one_line(self):
        r = self.run_one(dns=[dns(f"x{i}.cdn.tracker.example", ts=T0 + 60 * i) for i in range(500)])
        self.assertEqual(len(r["findings"]), 1)
        self.assertEqual((r["findings"][0]["name"], r["findings"][0]["count"]), ("tracker.example", 500))

    def test_a_report_lists_the_most_frequent_of_each_kind_and_counts_all_of_them(self):
        (analyze.HOME / "lists" / "cti.txt").write_text("".join(f"e{i}.example\n" for i in range(40)))
        (analyze.HOME / "lists" / "malware.txt").write_text("".join(f"m{i}.example\n" for i in range(3)))
        self.lists = analyze.load_lists()
        queries = [dns(f"e{i}.example", ts=T0 + 60 * j) for i in range(40) for j in range(i + 1)] + [dns("m0.example")]
        r = self.run_one(dns=queries)
        cti = [f for f in r["findings"] if f["kind"] == "cti"]
        self.assertEqual(len(cti), analyze.MAX_FINDINGS)
        self.assertEqual((cti[0]["name"], cti[-1]["name"]), ("e39.example", "e10.example"))
        self.assertEqual(r["more"], {"cti": 10})
        self.assertEqual({c["id"]: c["count"] for c in r["checks"]}["cti"], sum(range(1, 41)))
        self.assertEqual(len([f for f in r["findings"] if f["kind"] == "malware"]), 1)

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

    def bypasses(self, **kw):
        return next(c["count"] for c in self.run_one(**kw)["checks"] if c["id"] == "bypass_dns")

    def test_a_connection_to_an_encrypted_dns_server_is_a_bypass_once(self):
        tls = {"ts": T0, "uid": "C1", "id.orig_h": "10.8.1.3", "id.resp_h": "192.0.2.53", "id.resp_p": 443, "server_name": "dns.doh.example"}
        conn = [{"ts": T0, "uid": "C1", "id.orig_h": "10.8.1.3", "id.resp_h": "192.0.2.53", "id.resp_p": 443}]
        # by its name, and not again by its address or for the same connection seen twice
        self.assertEqual(self.bypasses(ssl=[tls], quic=[tls], conn=conn), 1)

    def test_it_marks_the_hour_and_names_no_site(self):
        tls = {"ts": T0, "uid": "C1", "id.orig_h": "10.8.1.3", "server_name": "doh.example"}
        r = self.run_one(ssl=[tls])
        self.assertEqual(r["findings"], [{"severity": "check", "kind": "bypass_dns", "count": 1}])
        self.assertNotIn("doh.example", json.dumps(r) + (analyze.HOME / "state" / "n1" / "10.8.1.3.json").read_text())

    def test_an_address_of_one_counts_only_without_a_name(self):
        conn = [{"ts": T0, "uid": "C1", "id.orig_h": "10.8.1.3", "id.resp_h": "192.0.2.53", "id.resp_p": 443},
                {"ts": T0, "uid": "C2", "id.orig_h": "10.8.1.3", "id.resp_h": "192.0.2.53", "id.resp_p": 443},
                {"ts": T0, "uid": "C3", "id.orig_h": "10.8.1.3", "id.resp_h": "192.0.2.53", "id.resp_p": 8443},
                {"ts": T0, "uid": "C4", "id.orig_h": "10.8.1.3", "id.resp_h": "192.0.2.54", "id.resp_p": 443}]
        # C2 asked for a site that shares the address; C3 is another port, C4 another address
        site = {"ts": T0, "uid": "C2", "id.orig_h": "10.8.1.3", "server_name": "blog.example"}
        self.assertEqual(self.bypasses(conn=conn, ssl=[site]), 1)

    def test_apples_own_resolvers_and_private_relay_are_not_a_bypass(self):
        rows = [{"ts": T0, "uid": f"C{i}", "id.orig_h": "10.8.1.3", "server_name": name}
                for i, name in enumerate(["doh.dns.apple.com", "mask.icloud.com", "a.mask.icloud.com"])]
        conn = [{"ts": T0, "uid": "C9", "id.orig_h": "10.8.1.3", "id.resp_h": "17.132.82.11", "id.resp_p": 443}]
        self.assertEqual(self.bypasses(ssl=rows, conn=conn), 0)

    def test_without_the_list_of_servers_only_the_dns_ports_count(self):
        (analyze.HOME / "lists" / "doh.txt").unlink()
        (analyze.HOME / "lists" / "doh-ips.txt").unlink()
        self.lists = analyze.load_lists()
        tls = {"ts": T0, "uid": "C1", "id.orig_h": "10.8.1.3", "server_name": "doh.example"}
        conn = [{"ts": T0, "uid": "C2", "id.orig_h": "10.8.1.3", "id.resp_h": "192.0.2.53", "id.resp_p": 443},
                {"ts": T0, "uid": "C3", "id.orig_h": "10.8.1.3", "id.resp_h": "192.0.2.53", "id.resp_p": 853}]
        self.assertEqual(self.bypasses(ssl=[tls], conn=conn), 1)

    def test_a_name_the_nodes_lists_stopped_is_not_a_name_that_does_not_exist(self):
        rows = [dns("blocked.example", rcode="NXDOMAIN"), dns("gone.example", rcode="NXDOMAIN"), dns("a.example")]
        analyze.merge("n1", {("10.8.1.3", analyze.hour_of(T0)): [10, 20]},
                      {**logs(dns=rows), "blocked": {("10.8.1.3", "blocked.example")}}, self.lists)
        r = analyze.report("n1", "10.8.1.3")
        self.assertEqual((r["dns"]["total"], r["dns"]["nx_share"]), (3, 1 / 3))

    def test_a_name_on_a_list_still_counts_when_the_node_stopped_it(self):
        rows = [dns("api.tracker.example", rcode="NXDOMAIN")]
        analyze.merge("n1", {("10.8.1.3", analyze.hour_of(T0)): [10, 20]},
                      {**logs(dns=rows), "blocked": {("10.8.1.3", "api.tracker.example")}}, self.lists)
        r = analyze.report("n1", "10.8.1.3")
        self.assertEqual(r["findings"][0]["name"], "tracker.example")
        self.assertEqual(r["dns"]["nx_share"], 0)

    def test_the_name_the_ad_list_points_to_is_not_counted(self):
        r = self.run_one(dns=[dns("blocked.vessel", rcode="NXDOMAIN"), dns("a.example")])
        self.assertEqual(r["dns"]["nx_share"], 0)
        self.assertEqual(r["dns"]["total"], 1)

    def test_shares(self):
        r = self.run_one(dns=[dns("ad.example"), dns("x.example", rcode="NXDOMAIN"), dns("a.example"), dns("b.example")])
        self.assertEqual((r["dns"]["ads_share"], r["dns"]["nx_share"]), (0.25, 0.25))

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


def sni(name, ts=T0, who="10.8.1.3"):
    return {"ts": ts, "id.orig_h": who, "server_name": name}


class Visits(Base):
    def merge_one(self, **kw):
        analyze.merge("n1", {}, logs(**kw), self.lists)
        return analyze.report("n1", "10.8.1.3")

    def hit(self, r):
        return next(f for f in r["findings"] if f["kind"] != "bypass_dns")

    def test_one_visit_counts_once_across_lookups_and_sni(self):
        rows = [dns("api.tracker.example", ts=T0 + i) for i in range(3)] + [dns("cdn.tracker.example", ts=T0 + 5)]
        r = self.merge_one(dns=rows, ssl=[sni("api.tracker.example", ts=T0 + 2)], quic=[sni("api.tracker.example", ts=T0 + 59)])
        self.assertEqual((self.hit(r)["count"], self.hit(r)["how"]), (1, "DNS"))
        self.assertEqual({c["id"]: c["count"] for c in r["checks"]}["stalkerware"], 1)

    def test_a_visit_a_minute_later_counts_again(self):
        r = self.merge_one(dns=[dns("api.tracker.example", ts=T0), dns("api.tracker.example", ts=T0 + 30),
                          dns("api.tracker.example", ts=T0 + 60), dns("api.tracker.example", ts=T0 + 3600)])
        self.assertEqual(self.hit(r)["count"], 3)

    def test_the_minute_runs_on_across_captures(self):
        analyze.merge("n1", {}, logs(dns=[dns("api.tracker.example", ts=T0)]), self.lists)
        analyze.merge("n1", {}, logs(ssl=[sni("api.tracker.example", ts=T0 + 20)]), self.lists)
        r = self.merge_one(dns=[dns("api.tracker.example", ts=T0 + 80)])
        self.assertEqual(self.hit(r)["count"], 2)

    def test_hours_and_last_whatever_the_order_of_the_rows(self):
        times = [T0 + 7200, T0, T0 + 30, T0 + 3600, T0 + 7230]
        rows = [dns("api.tracker.example", ts=t) for t in times]
        forward = self.merge_one(dns=rows)
        analyze.state_path("n1", "10.8.1.3").unlink()
        backward = self.merge_one(dns=rows[::-1])
        for r in (forward, backward):
            hit = self.hit(r)
            self.assertEqual((hit["count"], hit["first"], hit["last"]), (3, T0, T0 + 7230))
            self.assertEqual(hit["hours"], sorted({analyze.hour_of(t) for t in times}))
            self.assertEqual(len(hit["hours"]), 3)

    def test_a_finding_has_exactly_the_reported_fields(self):
        r = self.merge_one(dns=[dns("api.tracker.example")], conn=[{"ts": T0, "id.orig_h": "10.8.1.3", "id.resp_h": "8.8.8.8", "id.resp_p": 53}])
        self.assertEqual(set(self.hit(r)), {"severity", "kind", "name", "how", "count", "first", "last", "hours", "lists"})
        self.assertEqual(r["findings"][-1], {"severity": "check", "kind": "bypass_dns", "count": 1})

    def test_an_older_state_file_still_loads(self):
        hour = analyze.hour_of(T0)
        old = {"node": "n1", "address": "10.8.1.3", "hours": {hour: [1, 2]}, "marks": {hour: "x"},
               "dns": {"total": 4, "nx": 2, "ads": 0}, "nx_names": {"printer.lan": 2},
               "hits": {"stalkerware|tracker.example": {"kind": "stalkerware", "name": "tracker.example", "how": "DNS",
                                                        "count": 24, "first": T0}},
               "bypass": 0, "first": T0, "last": T0}
        path = analyze.state_path("n1", "10.8.1.3")
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps(old))
        hit = self.hit(analyze.report("n1", "10.8.1.3"))
        self.assertEqual((hit["count"], hit["last"], hit["hours"]), (24, T0, [hour]))
        # which other lists its names were on is not known: only its own
        self.assertEqual(hit["lists"], ["stalkerware"])
        r = self.merge_one(dns=[dns("api.tracker.example", ts=T0 + 10), dns("api.tracker.example", ts=T0 + 4000)])
        self.assertEqual((self.hit(r)["count"], self.hit(r)["last"]), (25, T0 + 4000))
        self.assertNotIn("nx_names", r)
        self.assertNotIn("nx_names", path.read_text())
        self.assertNotIn("printer.lan", path.read_text())


class HitLists(Base):
    """Every list a hit's names are on, the ad list included (toomore/anoni-net-ws#480)."""

    def setUp(self):
        super().setUp()
        (analyze.HOME / "lists" / "cti.txt").write_text("evil.example\nnet.example\n")
        (analyze.HOME / "lists" / "malware.txt").write_text("bad.example CNAME .\nevil.example CNAME .\n")
        (analyze.HOME / "lists" / "ads.txt").write_text("ad.example CNAME .\nevil.example CNAME .\ncdn.net.example CNAME .\n"
                                                        "tracker.example CNAME .\n")
        self.lists = analyze.load_lists()

    def report(self, *batches):
        for kw in batches:
            analyze.merge("n1", {}, logs(**kw), self.lists)
        return {f["name"]: f for f in analyze.report("n1", "10.8.1.3")["findings"] if f["kind"] != "bypass_dns"}

    def test_a_name_on_a_flagged_list_and_the_ad_list_says_both(self):
        (analyze.HOME / "lists" / "malware.txt").write_text("bad.example CNAME .\n")
        self.lists = analyze.load_lists()
        hit = self.report({"dns": [dns("x.evil.example")]})["evil.example"]
        self.assertEqual((hit["kind"], hit["lists"]), ("cti", ["ads", "cti"]))

    def test_every_list_is_named_once_in_order_with_its_own_kind(self):
        hit = self.report({"dns": [dns("evil.example")], "ssl": [sni("evil.example", ts=T0 + 1)]})["evil.example"]
        # malware comes first among the flagged lists, so the hit is a malware one, also on the other two
        self.assertEqual((hit["kind"], hit["lists"]), ("malware", ["ads", "cti", "malware"]))

    def test_a_name_on_one_list_only_has_only_that_one(self):
        self.assertEqual(self.report({"dns": [dns("bad.example")]})["bad.example"]["lists"], ["malware"])

    def test_the_subdomains_of_an_entry_add_up_to_their_lists(self):
        # net.example is on the threat list; only cdn.net.example is also on the ad list
        rows = [dns("www.net.example"), dns("img.cdn.net.example", ts=T0 + 120)]
        hit = self.report({"dns": rows})["net.example"]
        self.assertEqual((hit["count"], hit["lists"]), (2, ["ads", "cti"]))
        self.assertEqual(self.report()["net.example"]["lists"], ["ads", "cti"])

    def test_the_lists_add_up_across_captures(self):
        first = self.report({"dns": [dns("www.net.example")]})["net.example"]
        self.assertEqual(first["lists"], ["cti"])
        later = self.report({"quic": [sni("a.cdn.net.example", ts=T0 + 3600)]})["net.example"]
        self.assertEqual(later["lists"], ["ads", "cti"])
        # seen again without the ad list's name, what it was on stays
        again = self.report({"dns": [dns("www.net.example", ts=T0 + 7200)]})["net.example"]
        self.assertEqual(again["lists"], ["ads", "cti"])

    def test_stalkerware_says_its_other_lists_and_stays_a_threat(self):
        hit = self.report({"dns": [dns("api.tracker.example")]})["tracker.example"]
        self.assertEqual((hit["severity"], hit["lists"]), ("threat", ["ads", "stalkerware"]))
        self.assertEqual(analyze.load_state("n1", "10.8.1.3")["marks"], {analyze.hour_of(T0): "x"})

    def test_a_lookup_around_the_node_has_no_lists(self):
        conn = [{"ts": T0, "id.orig_h": "10.8.1.3", "id.resp_h": "8.8.8.8", "id.resp_p": 53}]
        analyze.merge("n1", {}, logs(conn=conn, dns=[dns("evil.example")]), self.lists)
        bypass = analyze.report("n1", "10.8.1.3")["findings"][-1]
        self.assertEqual(bypass, {"severity": "check", "kind": "bypass_dns", "count": 1})

    def test_an_ad_name_alone_is_not_a_finding(self):
        self.assertEqual(self.report({"dns": [dns("ad.example")]}), {})


class StalkerwareApps(Base):
    """Which stalkerware a hit belongs to, from Echap's network.csv (toomore/anoni-net-ws#480)."""

    CSV = ("type,indicator,app\n"
           "domain,tracker.example,FakeSpy\n"
           "domain,api.tracker.example,FakeSpy Pro\n"
           "ipv4,192.0.2.1,FakeSpy\n"
           "domain,collect.example,<b>Spy</b>\n"
           "domain,other.example,OtherSpy\n")

    def setUp(self):
        super().setUp()
        (analyze.HOME / "lists" / "stalkerware.txt").write_text("0.0.0.0 tracker.example\n0.0.0.0 collect.example\n"
                                                                "0.0.0.0 unnamed.example\n0.0.0.0 shared.example\n")
        (analyze.HOME / "lists" / "stalkerware-apps.csv").write_text(self.CSV)
        (analyze.HOME / "lists" / "cti.txt").write_text("other.example\n")
        self.lists = analyze.load_lists()

    def report(self, rows):
        analyze.merge("n1", {}, logs(dns=rows), self.lists)
        return {f["name"]: f for f in analyze.report("n1", "10.8.1.3")["findings"]}

    def test_only_the_domains_of_the_table_are_kept(self):
        self.assertEqual(analyze.load_apps(), {"tracker.example": "FakeSpy", "api.tracker.example": "FakeSpy Pro",
                                               "collect.example": "<b>Spy</b>", "other.example": "OtherSpy"})

    def test_a_stalkerware_hit_says_which_app_from_its_most_specific_domain(self):
        r = self.report([dns("x.cdn.tracker.example"), dns("collect.example", ts=T0 + 1)])
        self.assertEqual(r["tracker.example"]["app"], "FakeSpy")
        # the name as the table has it, whatever it has in it: the page shows it as text
        self.assertEqual(r["collect.example"]["app"], "<b>Spy</b>")
        analyze.state_path("n1", "10.8.1.3").unlink()
        self.assertEqual(self.report([dns("v2.api.tracker.example")])["tracker.example"]["app"], "FakeSpy Pro")

    def test_a_hit_not_in_the_table_has_no_app(self):
        hit = self.report([dns("unnamed.example")])["unnamed.example"]
        self.assertNotIn("app", hit)
        self.assertEqual(hit["severity"], "threat")

    def test_only_stalkerware_hits_have_an_app(self):
        self.assertNotIn("app", self.report([dns("other.example")])["other.example"])

    def test_without_the_table_there_is_no_app(self):
        (analyze.HOME / "lists" / "stalkerware-apps.csv").unlink()
        self.lists = analyze.load_lists()
        hit = self.report([dns("tracker.example")])["tracker.example"]
        self.assertEqual((hit["severity"], "app" in hit), ("threat", False))

    def test_an_older_state_gets_its_app_when_the_site_is_seen_again(self):
        old = {"node": "n1", "address": "10.8.1.3", "hours": {}, "marks": {}, "dns": {"total": 0, "nx": 0, "ads": 0},
               "hits": {"stalkerware|tracker.example": {"kind": "stalkerware", "name": "tracker.example", "how": "DNS",
                                                        "count": 2, "first": T0}},
               "bypass": 0, "first": T0, "last": T0}
        path = analyze.state_path("n1", "10.8.1.3")
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps(old))
        self.assertNotIn("app", analyze.report("n1", "10.8.1.3")["findings"][0])
        self.assertEqual(self.report([dns("tracker.example", ts=T0 + 600)])["tracker.example"]["app"], "FakeSpy")

    def test_a_failed_download_keeps_the_table_it_had(self):
        with mock.patch.object(analyze.urllib.request, "urlopen", side_effect=OSError("offline")), \
                mock.patch.object(analyze.sys, "stderr"):
            analyze.update_lists()
        self.assertEqual((analyze.HOME / "lists" / "stalkerware-apps.csv").read_text(), self.CSV)
        self.assertEqual(analyze.load_apps()["tracker.example"], "FakeSpy")

    def test_a_download_replaces_the_table(self):
        fresh = self.CSV.replace("FakeSpy\n", "RenamedSpy\n") + "".join(f"domain,d{i}.example,Filler\n" for i in range(60))

        def urlopen(url, timeout):
            body = fresh if url == analyze.APPS_SOURCE else "0.0.0.0 tracker.example\n" * 60
            return io.BytesIO(body.encode())

        with mock.patch.object(analyze.urllib.request, "urlopen", side_effect=urlopen):
            analyze.update_lists()
        self.assertEqual(analyze.load_apps()["tracker.example"], "RenamedSpy")


class Addresses(Base):
    """Servers a list knows by address: a device may reach one without looking a name up."""

    CSV = ("type,indicator,app\n"
           "domain,tracker.example,FakeSpy\n"
           "ipv4,203.0.113.7,FakeSpy\n"
           "ipv4,203.0.113.8,\n"
           "ipv4,192.168.1.1,HomeSpy\n"
           "ipv4,203.0.113.0/24,RangeSpy\n"
           "ipv6,2001:db8::7,FakeSpy\n")

    def setUp(self):
        super().setUp()
        (analyze.HOME / "lists" / "stalkerware-apps.csv").write_text(self.CSV)
        self.lists = analyze.load_lists()

    def conn(self, ip, ts=T0, port=443):
        return {"ts": ts, "uid": f"C{ts}{ip}", "id.orig_h": "10.8.1.3", "id.resp_h": ip, "id.resp_p": port}

    def report(self, **kw):
        analyze.merge("n1", {}, logs(**kw), self.lists)
        return analyze.report("n1", "10.8.1.3")

    def test_only_addresses_on_the_internet_are_read(self):
        self.assertEqual(self.lists[analyze.ADDRESSES]["stalkerware"], {"203.0.113.7": "FakeSpy", "203.0.113.8": None})
        for word in ("10.0.0.1", "172.16.0.1", "192.168.0.1", "127.0.0.1", "169.254.1.1", "100.64.0.1", "224.0.0.1", "0.0.0.0",
                     "1.2.3", "1.2.3.4.5", "256.1.1.1", "1.2.3.4/32", "a.b.c.d", ""):
            self.assertIsNone(analyze.address(word), word)
        self.assertEqual(analyze.address(" 203.000.113.007 "), "203.0.113.7")

    def test_a_connection_to_a_listed_address_is_a_threat_with_its_app(self):
        r = self.report(conn=[self.conn("203.0.113.7", port=8080)])
        self.assertEqual(r["findings"], [{"severity": "threat", "kind": "stalkerware", "name": "203.0.113.7", "how": "IP", "count": 1,
                                          "first": T0, "last": T0, "hours": [analyze.hour_of(T0)], "lists": ["stalkerware"], "app": "FakeSpy"}])
        self.assertEqual([c["count"] for c in r["checks"] if c["id"] == "stalkerware"], [1])
        self.assertEqual(analyze.load_state("n1", "10.8.1.3")["marks"], {analyze.hour_of(T0): "x"})

    def test_an_address_without_a_name_in_the_table_has_no_app(self):
        self.assertNotIn("app", self.report(conn=[self.conn("203.0.113.8")])["findings"][0])

    def test_connections_a_minute_apart_count_again(self):
        r = self.report(conn=[self.conn("203.0.113.7"), self.conn("203.0.113.7", T0 + 30), self.conn("203.0.113.7", T0 + 90)])
        self.assertEqual(r["findings"][0]["count"], 2)

    def test_the_address_behind_a_listed_name_is_the_same_visit(self):
        r = self.report(dns=[dns("api.tracker.example")], conn=[self.conn("203.0.113.7", T0 + 1)])
        self.assertEqual([(f["name"], f["count"]) for f in r["findings"]], [("tracker.example", 1)])

    def test_an_address_reached_long_after_the_name_is_listed_too(self):
        r = self.report(dns=[dns("api.tracker.example")], conn=[self.conn("203.0.113.7", T0 + 600)])
        self.assertEqual(sorted(f["name"] for f in r["findings"]), ["203.0.113.7", "tracker.example"])

    def test_other_addresses_are_not_kept(self):
        r = self.report(conn=[self.conn("198.51.100.9"), self.conn("192.168.1.1")])
        self.assertEqual(r["findings"], [])
        self.assertNotIn("198.51.100.9", (analyze.HOME / "state" / "n1" / "10.8.1.3.json").read_text())

    def test_someone_elses_connection_is_not_this_devices(self):
        row = {**self.conn("10.8.1.3"), "id.orig_h": "203.0.113.7"}
        analyze.merge("n1", {}, logs(conn=[row]), self.lists)
        self.assertTrue(analyze.report("n1", "203.0.113.7").get("empty"))

    def test_without_the_table_no_address_is_compared(self):
        (analyze.HOME / "lists" / "stalkerware-apps.csv").unlink()
        self.lists = analyze.load_lists()
        self.assertEqual(self.report(conn=[self.conn("203.0.113.7")])["findings"], [])

    def test_a_leaders_summary_has_the_kind_and_not_the_address(self):
        self.report(conn=[self.conn("203.0.113.7")])
        summary = analyze.summary("n1", "10.8.1.3")
        self.assertEqual((summary["verdict"], summary["kinds"]), ("threat", [{"kind": "stalkerware", "severity": "threat"}]))
        self.assertNotIn("203.0.113.7", json.dumps(summary))


class Spyware(Base):
    """Mercenary spyware, from the investigations the Mobile Verification Toolkit's index lists."""

    INDEX = """indicators:
  -
    type: github
    name: FakeGroup Spy Indicators of Compromise
    sources:
      - Somebody
    references:
      - https://example.org/report
    github:
      owner: mvt-project
      repo: mvt-indicators
      branch: main
      path: fake/fakegroup.stix2

  -
    type: github
    name: Stalkerware Indicators of Compromise
    github:
      owner: AssoEchap
      repo: stalkerware-indicators
      branch: master
      path: generated/stalkerware.stix2

  -
    type: github
    name: "OtherSpy Indicators of Compromise"
    github:
      owner: AmnestyTech
      repo: investigations
      branch: master
      path: 2024-01-01_other/other.stix2
"""
    FILES = {
        "https://raw.githubusercontent.com/mvt-project/mvt-indicators/main/fake/fakegroup.stix2":
            [f"[domain-name:value='c{i}.spy.example']" for i in range(120)] + ["[domain-name:value='Spy.Example.']", "[file:path='/tmp/x']",
                                                                           "[process:name='spyd']", "[domain-name:value='not a name']"],
        "https://raw.githubusercontent.com/AmnestyTech/investigations/master/2024-01-01_other/other.stix2":
            ["[ipv4-addr:value='203.0.113.99']", "[ipv4-addr:value='10.0.0.1']", "[domain-name:value='other.example']"],
    }

    @classmethod
    def urlopen(cls, url, timeout):
        if url == analyze.SPYWARE_INDEX:
            return io.BytesIO(cls.INDEX.encode())
        objects = [{"type": "malware", "name": "x"}, *({"type": "indicator", "pattern": p} for p in cls.FILES[url])]
        return io.BytesIO(json.dumps({"type": "bundle", "objects": objects}).encode())

    def report(self, **kw):
        analyze.merge("n1", {}, logs(**kw), self.lists)
        return analyze.report("n1", "10.8.1.3")

    def test_the_index_names_each_investigation_and_its_file_and_leaves_out_stalkerware(self):
        self.assertEqual(analyze.spyware_sources(self.INDEX), [("FakeGroup Spy", next(iter(self.FILES))), ("OtherSpy", list(self.FILES)[1])])

    def test_an_index_that_points_somewhere_else_is_refused(self):
        for path in ("../../../evil/repo/main/x.stix2", "a/../b.stix2", "x.stix2?token=1", "a b.stix2", "/etc/passwd"):
            with self.assertRaises(ValueError, msg=path):
                analyze.spyware_sources(self.INDEX.replace("fake/fakegroup.stix2", path))
        with self.assertRaises(ValueError):
            analyze.spyware_sources(self.INDEX.replace("owner: mvt-project", "owner: evil.example/x"))

    def test_the_table_has_the_domains_and_addresses_with_the_investigations_name(self):
        with mock.patch.object(analyze.urllib.request, "urlopen", side_effect=self.urlopen):
            rows = analyze.spyware_rows(analyze.SPYWARE_INDEX)
        self.assertEqual(len(rows), 123)
        self.assertIn(("domain", "spy.example", "FakeGroup Spy"), rows)
        self.assertEqual(rows[-2:], [("ipv4", "203.0.113.99", "OtherSpy"), ("domain", "other.example", "OtherSpy")])

    def test_one_investigation_missing_keeps_the_table_it_had(self):
        before = (analyze.HOME / "lists" / "spyware.csv").read_text()

        def urlopen(url, timeout):
            if "AmnestyTech" in url:
                raise OSError("offline")
            return self.urlopen(url, timeout) if url == analyze.SPYWARE_INDEX or url.endswith(".stix2") else io.BytesIO(b"0.0.0.0 a.example\n" * 80)

        with mock.patch.object(analyze.urllib.request, "urlopen", side_effect=urlopen), mock.patch.object(analyze.sys, "stderr"):
            self.assertEqual(analyze.update_lists(), ["spyware.csv"])
        self.assertEqual((analyze.HOME / "lists" / "spyware.csv").read_text(), before)

    def test_a_download_replaces_the_table(self):
        def urlopen(url, timeout):
            return self.urlopen(url, timeout) if url == analyze.SPYWARE_INDEX or url.endswith(".stix2") else io.BytesIO(b"0.0.0.0 a.example\n" * 80)

        with mock.patch.object(analyze.urllib.request, "urlopen", side_effect=urlopen):
            self.assertEqual(analyze.update_lists(), [])
        lists = analyze.load_lists()
        self.assertIn("other.example", lists["spyware"])
        self.assertEqual(lists[analyze.NAMES]["spyware"]["c7.spy.example"], "FakeGroup Spy")

    def test_a_spyware_name_is_a_threat_named_after_its_investigation_and_comes_first(self):
        r = self.report(dns=[dns("api.tracker.example"), dns("c2.spy.example", ts=T0 + 5)])
        self.assertEqual([(f["kind"], f["severity"], f["name"], f.get("app")) for f in r["findings"]],
                         [("spyware", "threat", "spy.example", "FakeGroup Spy"), ("stalkerware", "threat", "tracker.example", None)])
        self.assertEqual([c["id"] for c in r["checks"]], ["spyware", "stalkerware", "malware", "cti", "bypass_dns"])
        self.assertEqual(r["findings"][0]["lists"], ["spyware"])
        self.assertEqual(analyze.load_state("n1", "10.8.1.3")["marks"], {analyze.hour_of(T0): "x"})

    def test_a_spyware_server_is_known_by_its_address(self):
        conn = [{"ts": T0, "uid": "C1", "id.orig_h": "10.8.1.3", "id.resp_h": "203.0.113.99", "id.resp_p": 443}]
        hit = self.report(conn=conn)["findings"][0]
        self.assertEqual((hit["kind"], hit["name"], hit["how"], hit["app"]), ("spyware", "203.0.113.99", "IP", "OtherSpy"))

    def test_excluded_names_do_not_count(self):
        self.assertEqual(self.report(dns=[dns("shared.example")])["findings"], [])

    def test_without_the_table_nothing_is_spyware(self):
        (analyze.HOME / "lists" / "spyware.csv").unlink()
        self.lists = analyze.load_lists()
        r = self.report(dns=[dns("spy.example")])
        self.assertEqual(r["findings"], [])
        self.assertEqual(r["checks"][0], {"id": "spyware", "count": 0})

    def test_a_leaders_summary_has_the_kind_alone(self):
        self.report(dns=[dns("spy.example")])
        summary = analyze.summary("n1", "10.8.1.3")
        self.assertEqual((summary["verdict"], summary["kinds"]), ("threat", [{"kind": "spyware", "severity": "threat"}]))
        self.assertNotIn("FakeGroup", json.dumps(summary))


class SystemNames(Base):
    NAMES = ["lb._dns-sd._udp.0.1.168.192.in-addr.arpa", "_dns.resolver.arpa", "b.a.ip6.arpa", "router.home.arpa",
             "iPhone.local", "nas.localdomain", "db.internal", "printer.lan", "box.home", "x.invalid", "a.test",
             "abc.onion", "laptop.tail1234.ts.net", "wpad", "Router."]

    def merge_one(self, rows):
        analyze.merge("n1", {("10.8.1.3", analyze.hour_of(T0)): [10, 20]}, logs(dns=rows), self.lists)
        return analyze.report("n1", "10.8.1.3")

    def test_system_and_private_names_are_left_out_of_the_counts(self):
        rows = [dns(n, rcode="NXDOMAIN") for n in self.NAMES] + [dns("gone.example", rcode="NXDOMAIN"), dns("a.example")]
        r = self.merge_one(rows)
        self.assertEqual((r["dns"]["total"], r["dns"]["nx_share"]), (2, 0.5))
        self.assertNotIn("nx_names", r)
        text = json.dumps(r) + analyze.state_path("n1", "10.8.1.3").read_text()
        for name in ("in-addr", "ts.net", "printer", "gone.example"):
            self.assertNotIn(name, text)

    def test_only_whole_labels_count_as_system_names(self):
        for name in ("example.com", "local.example", "tailnet.example", "arpa.example", "notlocal.com", "mytest.com"):
            self.assertFalse(analyze.system_name(name), name)
        for name in self.NAMES:
            self.assertTrue(analyze.system_name(name), name)

    def test_a_system_name_is_not_compared_with_the_lists(self):
        (analyze.HOME / "lists" / "cti.txt").write_text("evil.example\nevil.lan\n")
        (analyze.HOME / "lists" / "ads.txt").write_text("ads.local\n")
        self.lists = analyze.load_lists()
        analyze.merge("n1", {}, logs(dns=[dns("x.evil.lan"), dns("t.ads.local")], ssl=[sni("evil.lan")]), self.lists)
        r = analyze.report("n1", "10.8.1.3")
        self.assertEqual((r["findings"], r["dns"]["ads_share"], r["dns"]["total"]), ([], 0, 0))


class Summary(Base):
    def run_one(self, **kw):
        analyze.merge("n1", {("10.8.1.3", analyze.hour_of(T0)): [10, 20]}, logs(**kw), self.lists)
        return analyze.summary("n1", "10.8.1.3")

    def test_nothing_seen_is_empty(self):
        self.assertEqual(analyze.summary("n1", "10.8.1.3"), {"empty": True})

    def test_nothing_found_is_clean(self):
        r = self.run_one(dns=[dns("example.org")])
        self.assertEqual((r["verdict"], r["kinds"]), ("clean", []))
        self.assertEqual(r["coverage"], {"active_hours": 1, "total_hours": 1})

    def test_a_threat_comes_first_and_decides_the_verdict(self):
        r = self.run_one(dns=[dns("bad.example"), dns("bad.example", ts=T0 + 120), dns("tracker.example")],
                         conn=[{"ts": T0, "id.orig_h": "10.8.1.3", "id.resp_h": "9.9.9.9", "id.resp_p": 53}])
        self.assertEqual(r["verdict"], "threat")
        self.assertEqual(r["kinds"][0], {"kind": "stalkerware", "severity": "threat"})
        self.assertEqual({k["kind"] for k in r["kinds"]}, {"stalkerware", "malware", "bypass_dns"})

    def test_a_check_alone_is_a_check(self):
        r = self.run_one(dns=[dns("evil.example")])
        self.assertEqual((r["verdict"], r["kinds"]), ("check", [{"kind": "cti", "severity": "check"}]))

    def test_no_sites_counts_hours_or_traffic(self):
        r = self.run_one(dns=[dns("api.tracker.example")])
        self.assertEqual(set(r), {"verdict", "kinds", "coverage"})
        self.assertEqual(set(r["coverage"]), {"active_hours", "total_hours"})
        text = json.dumps(r)
        for leak in ("tracker", "10.8.1.3", "n1", "count", "\"hours\"", "\"app\"", "\"up\"", "\"first\"", "\"last\"", str(T0)[:6]):
            self.assertNotIn(leak, text)


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

    def test_a_summary_does_not_open_as_a_report(self):
        from cryptography.exceptions import InvalidTag
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        from cryptography.hazmat.primitives.kdf.hkdf import HKDF

        def opened(private, box, info):
            shared = private.exchange(X25519PublicKey.from_public_bytes(base64.b64decode(box["epk"])))
            key = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=info).derive(shared)
            return AESGCM(key).decrypt(base64.b64decode(box["iv"]), base64.b64decode(box["ct"]), None)

        mine = X25519PrivateKey.generate()
        public = base64.b64encode(mine.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
        box = analyze.seal(b'{"verdict": "clean"}', public, analyze.SUMMARY_INFO)
        self.assertEqual(opened(mine, box, b"vessel-inspection-summary"), b'{"verdict": "clean"}')
        with self.assertRaises(InvalidTag):
            opened(mine, box, b"vessel-inspection-report")


def wire(name):
    return b"".join(bytes([len(p)]) + p.encode() for p in name.split(".")) + b"\0"


def dns_answer(name, flags, src="10.8.1.253", dst="10.8.1.3", sport=53, cname=None):
    question = wire(name) + b"\0\1\0\1"
    # a CNAME record pointing back at the question's name (offset 12), as unbound writes it
    answer = b"\xc0\x0c\0\5\0\1" + struct.pack(">IH", 3600, len(wire(cname))) + wire(cname) if cname else b""
    body = struct.pack(">HHHHHH", 1, flags, 1, 1 if cname else 0, 0, 0) + question + answer
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

    def test_the_ad_lists_cname_to_a_name_that_does_not_exist_is_the_nodes_own(self):
        self.assertEqual(self.found(dns_answer("ad.example", 0x8583, src="10.8.1.254", cname="blocked.vessel")),
                         {("10.8.1.3", "ad.example")})

    def test_a_cname_elsewhere_that_does_not_exist_is_not_blocked(self):
        self.assertEqual(self.found(dns_answer("cdn.example", 0x8183, cname="gone.example")), set())

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


class ListAge(Base):
    def age(self, name, seconds):
        at = T0 - seconds
        os.utime(analyze.HOME / "lists" / name, (at, at))

    def test_the_lists_are_as_old_as_the_oldest_of_them(self):
        for name in analyze.list_files():
            self.age(name, 3600)
        self.age("cti.txt", 3 * 86400)
        self.assertEqual(analyze.lists_at(), T0 - 3 * 86400)
        self.assertEqual(analyze.status()["lists_at"], T0 - 3 * 86400)

    def test_a_missing_list_has_no_age(self):
        (analyze.HOME / "lists" / "malware.txt").unlink()
        self.assertIsNone(analyze.lists_at())

    def test_a_report_says_how_old_its_lists_were(self):
        for name in analyze.list_files():
            self.age(name, 7200)
        analyze.merge("n1", {}, logs(dns=[dns("ok.example")]), self.lists)
        self.assertEqual(analyze.report("n1", "10.8.1.3")["lists_at"], T0 - 7200)

    def test_a_failed_download_is_named_and_keeps_its_age(self):
        for name in analyze.list_files():
            self.age(name, 7200)

        def urlopen(url, timeout):
            if url == analyze.SOURCES["cti"]:
                raise OSError("offline")
            if url == analyze.SPYWARE_INDEX or url.endswith(".stix2"):
                return Spyware.urlopen(url, timeout)
            return io.BytesIO(b"0.0.0.0 tracker.example\n" * 60)

        with mock.patch.object(analyze.urllib.request, "urlopen", side_effect=urlopen), mock.patch.object(analyze.sys, "stderr"):
            self.assertEqual(analyze.update_lists(), ["cti.txt"])
        self.assertEqual(analyze.lists_at(), T0 - 7200)

    def test_the_command_fails_when_a_download_did(self):
        with mock.patch.object(analyze, "update_lists", return_value=["cti.txt"]), \
                mock.patch.object(analyze.sys, "argv", ["analyze.py", "update-lists"]), self.assertRaises(SystemExit) as stop:
            analyze.main()
        self.assertEqual(stop.exception.code, 1)


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


class Leftovers(Base):
    def test_what_a_killed_batch_left_goes_at_the_next_batch_and_at_purge(self):
        for run in (analyze.batch, lambda: analyze.purge(8)):
            left = analyze.HOME / "work" / "tmpkilled"
            left.mkdir(parents=True)
            (left / "dns.log").write_text('{"query": "secret.example"}')
            run()
            self.assertFalse(left.exists())

    def test_zeek_works_under_the_directory_that_is_cleared(self):
        seen = []

        def fake(cmd, **kw):
            seen.append(next(a for a in cmd if a.endswith(":/logs")).split(":")[0])
            return analyze.subprocess.CompletedProcess(cmd, 0)

        with mock.patch.object(analyze.subprocess, "run", fake):
            ZEEK_LOGS(analyze.HOME / "spool" / "n" / "a.pcap")
        self.assertEqual(Path(seen[0]).parent, analyze.HOME / "work")
        self.assertFalse(Path(seen[0]).exists())

    def test_a_capture_that_breaks_the_analysis_does_not_hold_back_the_ones_after_it(self):
        spool = analyze.HOME / "spool" / "n"
        spool.mkdir(parents=True)
        for name in ("a.pcap", "b.pcap"):
            (spool / name).write_bytes(pcap(101, [(T0, ip("10.8.1.3", "1.1.1.1", 100))]))
        good = analyze.zeek_logs

        def logs(path):
            if path.name == "a.pcap":
                raise KeyError("ts")  # a row of Zeek's without a field the analysis reads
            return {name: [] for name in ("conn", "dns", "ssl", "quic", "http")}

        analyze.zeek_logs = logs
        try:
            analyze.batch()
        finally:
            analyze.zeek_logs = good
        self.assertEqual([f.name for f in spool.iterdir()], ["a.pcap"])


class Recv(Base):
    def setUp(self):
        super().setUp()
        recv.NODES.clear()
        recv.NODES.update({"100.64.0.1": "node-1", "100.64.0.2": "n"})

    def stream(self, data, peer="100.64.0.1"):
        async def go():
            reader = asyncio.StreamReader()
            reader.feed_data(data)
            reader.feed_eof()

            class W:
                def close(self):
                    pass

                def get_extra_info(self, name):
                    return (peer, 40000)

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

    def hold_open(self, check, peer="100.64.0.1"):
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

                def get_extra_info(self, name):
                    return (peer, 40000)

            task = asyncio.create_task(recv.handle(reader, W()))
            await asyncio.sleep(0.01)
            self.assertEqual(suffixes(), [".part"])
            self.assertEqual(analyze.status()["connected"], ["node-1"])
            check()
            self.assertEqual(suffixes(), [".pcap"])
            reader.feed_eof()
            await task
            self.assertEqual(recv.spools, set())
            self.assertEqual(analyze.status()["connected"], [])

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

    def test_stopping_the_service_keeps_what_it_has_received(self):
        body = pcap(239, [(T0, nflog(ip("10.8.1.3", "1.1.1.1", 100)))])
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]

        async def go():
            task = asyncio.create_task(recv.main())
            await asyncio.sleep(0.05)
            _, writer = await asyncio.open_connection("127.0.0.1", port)
            writer.write(b"vessel-inspect node-1\n" + body)
            await writer.drain()
            await asyncio.sleep(0.05)
            os.kill(os.getpid(), signal.SIGTERM)
            await asyncio.wait_for(task, 5)
            writer.close()

        with mock.patch.dict(os.environ, {"VESSEL_INSPECT_LISTEN": f"127.0.0.1:{port}",
                                          "VESSEL_INSPECT_NODES": "node-1=127.0.0.1"}):
            asyncio.run(go())
        files = sorted((analyze.HOME / "spool").glob("*/*"))
        self.assertEqual([f.suffix for f in files], [".pcap"])
        self.assertEqual(files[0].read_bytes(), body)

    def test_a_bad_name_is_refused(self):
        self.assertEqual(self.stream(b"vessel-inspect ../etc\n" + bytes(24)), [])

    def test_a_silly_packet_length_ends_the_stream(self):
        files = self.stream(b"vessel-inspect n\n" + bytes(24) + struct.pack("<IIII", T0, 0, 10**9, 10), peer="100.64.0.2")
        self.assertEqual(len(files), 0)

    def test_only_a_node_is_listened_to(self):
        body = pcap(239, [(T0, nflog(ip("10.8.1.3", "1.1.1.1", 100)))])
        for peer in ("100.64.0.9", "127.0.0.1", "::1", None):
            self.assertEqual(self.stream(b"vessel-inspect node-1\n" + body, peer=peer), [], peer)
        self.assertFalse((analyze.HOME / "spool" / "node-1").exists())

    def test_a_node_cannot_send_in_the_name_of_another(self):
        body = pcap(239, [(T0, nflog(ip("10.8.1.3", "1.1.1.1", 100)))])
        self.assertEqual(self.stream(b"vessel-inspect node-1\n" + body, peer="100.64.0.2"), [])
        self.assertEqual([f.parent.name for f in self.stream(b"vessel-inspect n\n" + body, peer="100.64.0.2")], ["n"])

    def test_a_node_reaching_us_over_a_mapped_address_is_still_that_node(self):
        body = pcap(239, [(T0, nflog(ip("10.8.1.3", "1.1.1.1", 100)))])
        self.assertEqual(len(self.stream(b"vessel-inspect node-1\n" + body, peer="::ffff:100.64.0.1")), 1)

    def test_the_list_of_nodes_is_read_strictly(self):
        self.assertEqual(recv.parse_nodes("sg=100.64.0.1  jp=100.64.0.2"), {"100.64.0.1": "sg", "100.64.0.2": "jp"})
        self.assertEqual(recv.parse_nodes(""), {})
        for bad in ("sg", "sg=", "sg=nowhere", "../x=100.64.0.1", "sg=100.64.0.1 sg=100.64.0.2", "sg=100.64.0.1 jp=100.64.0.1"):
            with self.assertRaises(SystemExit, msg=bad):
                recv.parse_nodes(bad)

    def test_without_a_list_of_nodes_the_service_does_not_start(self):
        with mock.patch.dict(os.environ, {"VESSEL_INSPECT_LISTEN": "127.0.0.1:1"}), self.assertRaises(SystemExit):
            os.environ.pop("VESSEL_INSPECT_NODES", None)
            asyncio.run(recv.main())


if __name__ == "__main__":
    unittest.main()
