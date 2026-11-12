#!/usr/bin/env python3
"""Turn the spooled captures into per-device results, then delete the captures (toomore/anoni-net-ws#480).

  analyze.py update-lists              download the lists to compare against
  analyze.py batch                     process finished captures; nothing of them stays but the counts below
  analyze.py report --node N --address A [--seal PUBLIC_KEY]
  analyze.py summary --node N --address A [--seal PUBLIC_KEY]
  analyze.py status
  analyze.py clear --node N --address A
  analyze.py purge --days D

What is kept for a device: traffic per hour, DNS totals, and the list entries it hit with the hours they came up in.
The sites it visited are not kept, nor the names that did not exist: a report that lists them would be a tool for
whoever holds someone else's phone (#461)."""

import argparse
import base64
import collections
import csv
import datetime as dt
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

HOME = Path(os.environ.get("VESSEL_INSPECT_HOME", "/var/lib/vessel-inspect"))
EXCLUDE = Path(os.environ.get("VESSEL_INSPECT_EXCLUDE", Path(__file__).resolve().parent.parent / "node" / "exclude.txt"))
ZEEK_IMAGE = "zeek/zeek:lts"
SUBNET = "10.8.1."
RESOLVERS = {"10.8.1.1", "10.8.1.253", "10.8.1.254"}
TZ = dt.timezone(dt.timedelta(hours=8))
IDLE_HOURS = range(1, 6)
AD_BLOCK_TARGET = "blocked.vessel"
AD_BLOCK_WIRE = b"\x07blocked\x06vessel\x00"  # the name as it appears in an answer
MAX_FINDINGS = 30  # of each kind in a report, the most frequent; the rest are only counted
SOURCES = {
    "stalkerware": "https://raw.githubusercontent.com/AssoEchap/stalkerware-indicators/master/generated/hosts",
    "malware": "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/rpz/tif.mini.txt",
    "cti": "https://raw.githubusercontent.com/DNSBunker/CTI/refs/heads/main/domains.txt",
    "ads": "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/rpz/pro.txt",
}
# Which stalkerware each of Echap's domains belongs to (`type,indicator,app`), CC BY 4.0: the name a report gives a
# stalkerware hit, with where it comes from (toomore/anoni-net-ws#480)
APPS = "stalkerware-apps"
APPS_SOURCE = "https://raw.githubusercontent.com/AssoEchap/stalkerware-indicators/master/generated/network.csv"
# One visit to a site looks a listed name up as A, AAAA and HTTPS, and then connects with SNI: a hit seen again this
# soon after it was last counted is the same visit (toomore/anoni-net-ws#480)
VISIT_SECONDS = 60
# Names that never leave the device's own network or the operating system: reverse lookups, Bonjour's
# lb._dns-sd._udp.<address>.in-addr.arpa and DDR's _dns.resolver.arpa (all under .arpa), mDNS and home-router names,
# the reserved test and invalid names, onion addresses, and Tailscale's MagicDNS. They say nothing about the sites a
# device reaches, most of them do not exist on purpose, and their names give away the person's own network, so they
# are left out of the DNS counts and are not compared with the lists. A name without a dot is a search-domain guess.
SYSTEM_SUFFIXES = ("arpa", "local", "localdomain", "internal", "lan", "home", "invalid", "test", "onion", "ts.net")
THREAT = {"stalkerware"}
FLAGGED = ("stalkerware", "malware", "cti")
SUMMARY_INFO = b"vessel-inspection-summary"  # the HKDF info a leader's summary is sealed with


def words(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            parts = line.split()
            if parts and parts[0][0] not in "#;$!":
                yield parts


def clean(word):
    word = word.lower().rstrip(".").removeprefix("*.")
    return word if "." in word and all(c.isalnum() or c in "._-" for c in word) else None


def load_lists():
    excluded = {clean(p[0]) for p in words(EXCLUDE)} if EXCLUDE.exists() else set()
    lists = {}
    for kind in SOURCES:
        names = set()
        path = HOME / "lists" / f"{kind}.txt"
        if path.exists():
            for parts in words(path):
                name = clean(parts[1] if parts[0] in ("0.0.0.0", "127.0.0.1") and len(parts) > 1 else parts[0])
                if name:
                    names.add(name)
        lists[kind] = names - excluded
    lists[APPS] = load_apps()
    return lists


def load_apps():
    """Domain to stalkerware name, from Echap's network.csv; empty where it has not been downloaded."""
    path = HOME / "lists" / f"{APPS}.csv"
    apps = {}
    if path.exists():
        with open(path, encoding="utf-8", errors="replace", newline="") as f:
            for row in csv.DictReader(f):
                name = clean(row.get("indicator") or "")
                app = (row.get("app") or "").strip()
                if row.get("type") == "domain" and name and app:
                    apps.setdefault(name, app)
    return apps


def app_of(name, apps):
    """The stalkerware a name belongs to: the most specific of Echap's domains that covers it, or None."""
    labels = (name or "").lower().rstrip(".").split(".")
    return next((apps[entry] for i in range(len(labels) - 1) if (entry := ".".join(labels[i:])) in apps), None)


def entry_of(name, names):
    """The widest entry of a list that covers a name: what a person can look up, and the one line that a tracker's
    thousands of subdomains come to."""
    labels = (name or "").lower().rstrip(".").split(".")
    return next((entry for i in range(len(labels) - 2, -1, -1) if (entry := ".".join(labels[i:])) in names), None)


def listed(name, names):
    return entry_of(name, names) is not None


def match(name, lists):
    """(kind, list entry) of the first flagged list that covers a name, or None."""
    return next(((kind, entry) for kind in FLAGGED if (entry := entry_of(name, lists[kind]))), None)


def lists_of(name, lists):
    """Every list that covers a name, the ad list included: what the lists themselves say about a site, so that a report
    can tell an ad network that is also on a malware list from a site only a malware list knows (toomore/anoni-net-ws#480).
    Nothing about the device is learnt from it."""
    return {kind for kind in SOURCES if listed(name, lists[kind])}


def system_name(name):
    name = name.lower().rstrip(".")
    return "." not in name or any(name == s or name.endswith("." + s) for s in SYSTEM_SUFFIXES)


def hour_of(ts):
    return dt.datetime.fromtimestamp(ts, dt.UTC).strftime("%Y-%m-%dT%H")


def ip_packet(link, data):
    if link == 101:
        return data
    if link == 239:  # NFLOG: a 4-byte header, then TLVs padded to 4 bytes; type 9 is the packet
        i = 4
        while i + 4 <= len(data):
            size, kind = struct.unpack("<HH", data[i:i + 4])
            if kind == 9:
                return data[i + 4:i + size]
            if size < 4:
                return None
            i += (size + 3) & ~3
    return None


def ipv4_packets(path):
    """(time, IP packet, source, destination) of each IPv4 packet in a capture."""
    with open(path, "rb") as f:
        header = f.read(24)
        if len(header) < 24:
            return
        link = struct.unpack("<I", header[20:24])[0]
        while len(record := f.read(16)) == 16:
            ts, _, length = struct.unpack("<IIIxxxx", record)
            ip = ip_packet(link, f.read(length))
            if ip and len(ip) >= 20 and ip[0] >> 4 == 4:
                yield ts, ip, ".".join(map(str, ip[12:16])), ".".join(map(str, ip[16:20]))


def traffic(path):
    """Bytes per device and hour, from the length in each IP header: it is still there in a packet cut to its start,
    which Zeek's own counts for QUIC are not."""
    totals = collections.defaultdict(lambda: [0, 0])
    for ts, ip, src, dst in ipv4_packets(path):
        size = struct.unpack(">H", ip[2:4])[0]
        if src.startswith(SUBNET) and src not in RESOLVERS:
            totals[(src, hour_of(ts))][0] += size
        elif dst.startswith(SUBNET) and dst not in RESOLVERS:
            totals[(dst, hour_of(ts))][1] += size
    return totals


def question_name(dns):
    """The name asked about in a DNS message, or None if the packet was cut before its end."""
    labels, at = [], 12
    while at < len(dns) and dns[at]:
        end = at + 1 + dns[at]
        if dns[at] > 63 or end > len(dns):
            return None
        labels.append(dns[at + 1:end].decode("ascii", "replace"))
        at = end
    return ".".join(labels).lower() if at < len(dns) else None


def blocked_answers(path):
    """(device, name) of the lookups the node's own lists stopped, read from the packets as node/start.sh counts them.
    The malware lists answer NXDOMAIN with the RA flag cleared, which no other answer has; Zeek's RA field is false for
    every answer without records, so it cannot tell these from a name that really does not exist. The ad list answers
    with a CNAME to blocked.vessel., which then does not exist: NXDOMAIN with RA set, told apart only by that name."""
    found = set()
    for _, ip, src, dst in ipv4_packets(path):
        if src not in RESOLVERS or ip[9] != 17:
            continue
        udp = (ip[0] & 15) * 4
        dns = ip[udp + 8:]
        if len(dns) <= 12 or struct.unpack(">H", ip[udp:udp + 2])[0] != 53 or dns[3] & 0x0F != 3:
            continue
        name = question_name(dns)
        # the answer section starts after the question's name and its type and class
        if name and (not dns[3] & 0x80 or AD_BLOCK_WIRE in dns[12 + len(name) + 2 + 4:]):
            found.add((dst, name))
    return found


def clear_work():
    """Zeek's logs name every site a device looked up; they live for one capture, under work/. A batch that was killed
    (out of memory, a reboot, systemd's timeout) leaves its directory behind, and nothing else would ever delete it."""
    shutil.rmtree(HOME / "work", ignore_errors=True)


def zeek_logs(path):
    (HOME / "work").mkdir(mode=0o700, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=HOME / "work") as work:
        subprocess.run(
            ["docker", "run", "--rm", "--network", "none", "-v", f"{path.parent}:/p:ro", "-v", f"{work}:/logs", "-w", "/logs",
             ZEEK_IMAGE, "zeek", "-C", "-r", f"/p/{path.name}", "local", "LogAscii::use_json=T"],
            check=True, capture_output=True,
        )
        logs = {}
        for name in ("conn", "dns", "ssl", "quic", "http"):
            log = Path(work) / f"{name}.log"
            logs[name] = [json.loads(line) for line in log.open() if line.startswith("{")] if log.exists() else []
        # Zeek ran as root in the container; its files go with the directory
        subprocess.run(["docker", "run", "--rm", "--network", "none", "-v", f"{work}:/logs", ZEEK_IMAGE, "sh", "-c", "rm -rf /logs/*"], check=False)
        return logs


def state_path(node, address):
    return HOME / "state" / node / f"{address}.json"


def load_state(node, address):
    path = state_path(node, address)
    if not path.exists():
        return {"node": node, "address": address, "hours": {}, "marks": {}, "dns": {"total": 0, "nx": 0, "ads": 0},
                "hits": {}, "bypass": 0, "first": None, "last": None}
    state = json.loads(path.read_text())
    # an older state kept the names that did not exist; they go with the next write
    state.pop("nx_names", None)
    for hit in state["hits"].values():
        hit.setdefault("last", hit["first"])
        hit.setdefault("hours", [hour_of(hit["first"])])
        hit.setdefault("counted", hit["last"])
        # an older state did not say which other lists its names were on; nothing is guessed for it
        hit.setdefault("lists", [hit["kind"]])
    return state


def save_state(state):
    path = state_path(state["node"], state["address"])
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state))
    os.replace(tmp, path)


def merge(node, totals, logs, lists):
    """Fold one capture into each device's counts."""
    states = {}

    def get(address):
        if address not in states:
            states[address] = load_state(node, address)
        return states[address]

    def seen(state, ts):
        state["first"] = min(state["first"] or ts, ts)
        state["last"] = max(state["last"] or ts, ts)

    def mark(state, ts, sign):
        hour = hour_of(ts)
        if sign == "x" or state["marks"].get(hour) != "x":
            state["marks"][hour] = sign

    candidates = []

    def note_hit(row, name, how):
        if not system_name(name) and (matched := match(name, lists)):
            app = app_of(name, lists.get(APPS, {})) if matched[0] == "stalkerware" else None
            candidates.append((row["ts"], row["id.orig_h"], *matched, how, lists_of(name, lists), app))

    def count_hit(ts, address, kind, entry, how, on, app):
        """A visit counts once: Zeek's rows come in no set order, so they are sorted before they get here. `on` is every
        list the name seen covers; a hit is a list entry, so its lists are those of all the names it came from. `app`
        is the stalkerware the name belongs to, kept from the first name that had one."""
        state = get(address)
        hit = state["hits"].setdefault(f"{kind}|{entry}", {"kind": kind, "name": entry, "how": how, "count": 0, "first": ts,
                                                           "last": ts, "hours": [], "counted": None, "lists": [kind]})
        hit["lists"] = sorted(set(hit["lists"]) | on | {kind})
        if app and not hit.get("app"):
            hit["app"] = app
        if hit["counted"] is None or abs(ts - hit["counted"]) >= VISIT_SECONDS:
            hit["count"] += 1
            hit["counted"] = max(hit["counted"] or ts, ts)
        hit["first"] = min(hit["first"], ts)
        hit["last"] = max(hit["last"], ts)
        hit["hours"] = sorted(set(hit["hours"]) | {hour_of(ts)})
        mark(state, ts, "x" if kind in THREAT else "!")

    def ours(row):
        return row.get("id.orig_h", "").startswith(SUBNET) and row.get("id.orig_h") not in RESOLVERS

    for (address, hour), (up, down) in totals.items():
        state = get(address)
        slot = state["hours"].setdefault(hour, [0, 0])
        slot[0] += up
        slot[1] += down
    for row in logs["dns"]:
        if not ours(row) or not row.get("query"):
            continue
        state = get(row["id.orig_h"])
        seen(state, row["ts"])
        name = row["query"].lower()
        # the ad list's answer points here, and some devices then look it up: Vessel's own name, not the device's lookup
        if name == AD_BLOCK_TARGET or system_name(name):
            continue
        state["dns"]["total"] += 1
        if row.get("rcode_name") == "NXDOMAIN" and (row["id.orig_h"], name) not in logs.get("blocked", ()):
            state["dns"]["nx"] += 1
        if listed(name, lists["ads"]):
            state["dns"]["ads"] += 1
        note_hit(row, name, "DNS")
    for log, field, how in (("ssl", "server_name", "SNI"), ("quic", "server_name", "SNI"), ("http", "host", "HTTP")):
        for row in logs[log]:
            if ours(row) and row.get(field):
                note_hit(row, row[field].lower(), how)
    # sorted() keeps DNS ahead of SNI and HTTP at the same moment, so a visit's first row names how it was seen
    for candidate in sorted(candidates, key=lambda c: c[0]):
        count_hit(*candidate)
    for row in logs["conn"]:
        if not ours(row):
            continue
        state = get(row["id.orig_h"])
        seen(state, row["ts"])
        if row.get("id.resp_p") in (53, 853) and row.get("id.resp_h") not in RESOLVERS:
            state["bypass"] += 1
            mark(state, row["ts"], "!")
    for state in states.values():
        save_state(state)


def batch():
    # one batch at a time (the systemd unit), so whatever is in work/ now was left by one that did not finish
    clear_work()
    lists = load_lists()
    for path in sorted((HOME / "spool").glob("*/*.pcap")):
        node = path.parent.name
        try:
            merge(node, traffic(path), {**zeek_logs(path), "blocked": blocked_answers(path)}, lists)
        except Exception as e:  # noqa: BLE001 - whatever one capture does wrong, the ones after it are still analysed
            # left in place for the next run; purge deletes what never succeeds
            print(f"{path.name}: {e}", file=sys.stderr)
            continue
        path.unlink()
    (HOME / "last-batch").touch()


def report(node, address):
    state = load_state(node, address)
    if not state["hours"] and not state["first"]:
        return {"node": node, "address": address, "empty": True}
    hours = []
    idle = total = 0
    for hour, (up, down) in sorted(state["hours"].items()):
        hours.append({"hour": hour, "up": up, "down": down, "mark": state["marks"].get(hour)})
        total += up + down
        local = dt.datetime.strptime(hour, "%Y-%m-%dT%H").replace(tzinfo=dt.UTC).astimezone(TZ)
        if local.hour in IDLE_HOURS:
            idle += up + down
    names = sorted(state["hours"])
    span = 1
    if names:
        low, high = (dt.datetime.strptime(h, "%Y-%m-%dT%H") for h in (names[0], names[-1]))
        span = int((high - low).total_seconds() // 3600) + 1
    dns = state["dns"]
    found = collections.Counter()
    entries = collections.Counter()
    findings = []
    for hit in sorted(state["hits"].values(), key=lambda h: (h["kind"] not in THREAT, -h["count"])):
        found[hit["kind"]] += hit["count"]
        entries[hit["kind"]] += 1
        if entries[hit["kind"]] <= MAX_FINDINGS:
            findings.append({"severity": "threat" if hit["kind"] in THREAT else "check",
                             **{k: hit[k] for k in ("kind", "name", "how", "count", "first", "last", "hours", "lists")},
                             **({"app": hit["app"]} if hit.get("app") else {})})
    if state["bypass"]:
        findings.append({"severity": "check", "kind": "bypass_dns", "count": state["bypass"]})
    checks = [{"id": kind, "count": found[kind]} for kind in FLAGGED] + [{"id": "bypass_dns", "count": state["bypass"]}]
    return {
        "node": node, "address": address, "first": state["first"], "last": state["last"], "hours": hours,
        "coverage": {"active_hours": len(hours), "total_hours": span},
        "dns": {"total": dns["total"], "nx_share": dns["nx"] / dns["total"] if dns["total"] else 0,
                "ads_share": dns["ads"] / dns["total"] if dns["total"] else 0},
        "idle_share": idle / total if total else 0,
        "checks": checks, "findings": findings,
        "more": {kind: n - MAX_FINDINGS for kind, n in entries.items() if n > MAX_FINDINGS},
    }


def summary(node, address):
    """What a group's leaders see of an inspection they asked for and the member agreed to (toomore/anoni-net-ws#483):
    the verdict, and the kinds of finding with their severity. The sites, how often and in which hours are the member's
    alone, as are the traffic and the DNS shares: #464 keeps a leader to states, without the sites or the times.
    The verdict is the report page's: a known threat if any finding is one, a check if there is any finding at all."""
    full = report(node, address)
    if full.get("empty"):
        return {"empty": True}
    kinds = {}
    # threats first, as the report lists them; a kind has one severity
    for f in sorted(full["findings"], key=lambda f: f["severity"] != "threat"):
        kinds.setdefault(f["kind"], f["severity"])
    verdict = "threat" if "threat" in kinds.values() else "check" if kinds else "clean"
    # not the report's first and last: they are to the second, and would tell a leader when the device was last used
    return {"verdict": verdict, "kinds": [{"kind": k, "severity": s} for k, s in kinds.items()],
            "coverage": full["coverage"]}


def seal(payload: bytes, public_key: str, info: bytes = b"vessel-inspection-report") -> dict:
    """Encrypt to the X25519 key the person's browser made, so that what the portal stores it cannot read: an ephemeral
    key, HKDF-SHA256 and AES-256-GCM, which the browser undoes with Web Crypto. A leader's summary has its own `info`,
    so that one cannot be passed off as the other."""
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF

    ephemeral = X25519PrivateKey.generate()
    shared = ephemeral.exchange(X25519PublicKey.from_public_bytes(base64.b64decode(public_key)))
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=info).derive(shared)
    iv = os.urandom(12)
    raw = ephemeral.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return {"epk": base64.b64encode(raw).decode(), "iv": base64.b64encode(iv).decode(),
            "ct": base64.b64encode(AESGCM(key).encrypt(iv, payload, None)).decode()}


def status():
    """For the portal's health check: when the analysis last ran, and how full the disk is."""
    usage = shutil.disk_usage(HOME)
    stamp = HOME / "last-batch"
    connected = HOME / "connected"
    return {"last_batch": stamp.stat().st_mtime if stamp.exists() else None, "disk_used": usage.used / usage.total,
            "waiting": sum(1 for _ in (HOME / "spool").glob("*/*.pcap")),
            "connected": connected.read_text().split() if connected.exists() else []}


def update_lists():
    (HOME / "lists").mkdir(parents=True, exist_ok=True, mode=0o700)
    downloads = {**{f"{kind}.txt": url for kind, url in SOURCES.items()}, f"{APPS}.csv": APPS_SOURCE}
    for name, url in downloads.items():
        path = HOME / "lists" / name
        part = path.with_suffix(".part")
        try:
            with urllib.request.urlopen(url, timeout=120) as response, part.open("wb") as f:
                shutil.copyfileobj(response, f)
            if part.stat().st_size < 1024:
                raise ValueError("too small")
        except (OSError, ValueError) as e:
            # the previous copy stays
            print(f"{name}: {e}", file=sys.stderr)
            part.unlink(missing_ok=True)
            continue
        os.replace(part, path)


def purge(days):
    clear_work()
    limit = time.time() - days * 86400
    for path in (HOME / "state").glob("*/*.json"):
        if path.stat().st_mtime < limit:
            path.unlink()
    # a capture that could not be analysed does not stay around for long
    for path in (HOME / "spool").glob("*/*"):
        if path.stat().st_mtime < time.time() - 86400:
            path.unlink()


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("update-lists")
    sub.add_parser("batch")
    for name in ("report", "summary", "clear"):
        p = sub.add_parser(name)
        p.add_argument("--node", required=True)
        p.add_argument("--address", required=True)
        if name != "clear":
            p.add_argument("--seal")
    sub.add_parser("status")
    sub.add_parser("purge").add_argument("--days", type=int, required=True)
    args = parser.parse_args()
    if args.cmd == "update-lists":
        update_lists()
    elif args.cmd == "batch":
        batch()
    elif args.cmd == "report":
        text = json.dumps(report(args.node, args.address), ensure_ascii=False)
        print(json.dumps(seal(text.encode(), args.seal)) if args.seal else text)
    elif args.cmd == "summary":
        text = json.dumps(summary(args.node, args.address), ensure_ascii=False)
        print(json.dumps(seal(text.encode(), args.seal, SUMMARY_INFO)) if args.seal else text)
    elif args.cmd == "status":
        print(json.dumps(status()))
    elif args.cmd == "clear":
        state_path(args.node, args.address).unlink(missing_ok=True)
    elif args.cmd == "purge":
        purge(args.days)


if __name__ == "__main__":
    main()
