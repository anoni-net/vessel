#!/usr/bin/env python3
"""Turn the spooled captures into per-device results, then delete the captures (toomore/anoni-net-ws#480).

  analyze.py update-lists              download the lists to compare against
  analyze.py batch                     process finished captures; nothing of them stays but the counts below
  analyze.py report --node N --address A [--seal PUBLIC_KEY]
  analyze.py status
  analyze.py clear --node N --address A
  analyze.py purge --days D

What is kept for a device: traffic per hour, DNS totals, names that hit a list, names that do not exist. The sites it
visited are not kept: a report that lists them would be a tool for whoever holds someone else's phone (#461)."""

import argparse
import base64
import collections
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
MAX_NX_NAMES = 500
SOURCES = {
    "stalkerware": "https://raw.githubusercontent.com/AssoEchap/stalkerware-indicators/master/generated/hosts",
    "malware": "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/rpz/tif.mini.txt",
    "cti": "https://raw.githubusercontent.com/DNSBunker/CTI/refs/heads/main/domains.txt",
    "ads": "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/rpz/pro.txt",
}
THREAT = {"stalkerware"}
FLAGGED = ("stalkerware", "malware", "cti")


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
    return lists


def listed(name, names):
    labels = (name or "").lower().rstrip(".").split(".")
    return any(".".join(labels[i:]) in names for i in range(len(labels) - 1))


def kind_of(name, lists):
    return next((kind for kind in FLAGGED if listed(name, lists[kind])), None)


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


def traffic(path):
    """Bytes per device and hour, from the length in each IP header: it is still there in a packet cut to its start,
    which Zeek's own counts for QUIC are not."""
    totals = collections.defaultdict(lambda: [0, 0])
    with open(path, "rb") as f:
        header = f.read(24)
        if len(header) < 24:
            return totals
        link = struct.unpack("<I", header[20:24])[0]
        while len(record := f.read(16)) == 16:
            ts, _, length = struct.unpack("<IIIxxxx", record)
            ip = ip_packet(link, f.read(length))
            if not ip or len(ip) < 20 or ip[0] >> 4 != 4:
                continue
            size = struct.unpack(">H", ip[2:4])[0]
            src, dst = ".".join(map(str, ip[12:16])), ".".join(map(str, ip[16:20]))
            if src.startswith(SUBNET) and src not in RESOLVERS:
                totals[(src, hour_of(ts))][0] += size
            elif dst.startswith(SUBNET) and dst not in RESOLVERS:
                totals[(dst, hour_of(ts))][1] += size
    return totals


def zeek_logs(path):
    with tempfile.TemporaryDirectory(dir=HOME) as work:
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
    if path.exists():
        return json.loads(path.read_text())
    return {"node": node, "address": address, "hours": {}, "marks": {}, "dns": {"total": 0, "nx": 0, "ads": 0}, "nx_names": {},
            "hits": {}, "bypass": 0, "first": None, "last": None}


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

    def note_hit(row, name, how):
        kind = kind_of(name, lists)
        if not kind:
            return
        state = get(row["id.orig_h"])
        hit = state["hits"].setdefault(f"{kind}|{name}", {"kind": kind, "name": name, "how": how, "count": 0, "first": row["ts"]})
        hit["count"] += 1
        mark(state, row["ts"], "x" if kind in THREAT else "!")

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
        state["dns"]["total"] += 1
        if row.get("rcode_name") == "NXDOMAIN":
            state["dns"]["nx"] += 1
            state["nx_names"][name] = state["nx_names"].get(name, 0) + 1
        if listed(name, lists["ads"]):
            state["dns"]["ads"] += 1
        note_hit(row, name, "DNS")
    for log, field, how in (("ssl", "server_name", "SNI"), ("quic", "server_name", "SNI"), ("http", "host", "HTTP")):
        for row in logs[log]:
            if ours(row) and row.get(field):
                note_hit(row, row[field].lower(), how)
    for row in logs["conn"]:
        if not ours(row):
            continue
        state = get(row["id.orig_h"])
        seen(state, row["ts"])
        if row.get("id.resp_p") in (53, 853) and row.get("id.resp_h") not in RESOLVERS:
            state["bypass"] += 1
            mark(state, row["ts"], "!")
    for state in states.values():
        if len(state["nx_names"]) > MAX_NX_NAMES:
            state["nx_names"] = dict(collections.Counter(state["nx_names"]).most_common(MAX_NX_NAMES))
        save_state(state)


def batch():
    lists = load_lists()
    for path in sorted((HOME / "spool").glob("*/*.pcap")):
        node = path.parent.name
        try:
            merge(node, traffic(path), zeek_logs(path), lists)
        except (subprocess.CalledProcessError, OSError, ValueError) as e:
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
    findings = []
    for hit in sorted(state["hits"].values(), key=lambda h: (h["kind"] not in THREAT, -h["count"])):
        found[hit["kind"]] += hit["count"]
        findings.append({"severity": "threat" if hit["kind"] in THREAT else "check", **hit})
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
        "nx_names": [{"name": n, "count": c} for n, c in collections.Counter(state["nx_names"]).most_common(50)],
    }


def seal(payload: bytes, public_key: str) -> dict:
    """Encrypt to the X25519 key the person's browser made, so that what the portal stores it cannot read: an ephemeral
    key, HKDF-SHA256 and AES-256-GCM, which the browser undoes with Web Crypto."""
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF

    ephemeral = X25519PrivateKey.generate()
    shared = ephemeral.exchange(X25519PublicKey.from_public_bytes(base64.b64decode(public_key)))
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=b"vessel-inspection-report").derive(shared)
    iv = os.urandom(12)
    raw = ephemeral.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return {"epk": base64.b64encode(raw).decode(), "iv": base64.b64encode(iv).decode(),
            "ct": base64.b64encode(AESGCM(key).encrypt(iv, payload, None)).decode()}


def status():
    """For the portal's health check: when the analysis last ran, and how full the disk is."""
    usage = shutil.disk_usage(HOME)
    stamp = HOME / "last-batch"
    return {"last_batch": stamp.stat().st_mtime if stamp.exists() else None, "disk_used": usage.used / usage.total,
            "waiting": sum(1 for _ in (HOME / "spool").glob("*/*.pcap"))}


def update_lists():
    (HOME / "lists").mkdir(parents=True, exist_ok=True, mode=0o700)
    for kind, url in SOURCES.items():
        path = HOME / "lists" / f"{kind}.txt"
        part = path.with_suffix(".part")
        try:
            with urllib.request.urlopen(url, timeout=120) as response, part.open("wb") as f:
                shutil.copyfileobj(response, f)
            if part.stat().st_size < 1024:
                raise ValueError("too small")
        except (OSError, ValueError) as e:
            # the previous copy stays
            print(f"{kind}: {e}", file=sys.stderr)
            part.unlink(missing_ok=True)
            continue
        os.replace(part, path)


def purge(days):
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
    for name in ("report", "clear"):
        p = sub.add_parser(name)
        p.add_argument("--node", required=True)
        p.add_argument("--address", required=True)
        if name == "report":
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
    elif args.cmd == "status":
        print(json.dumps(status()))
    elif args.cmd == "clear":
        state_path(args.node, args.address).unlink(missing_ok=True)
    elif args.cmd == "purge":
        purge(args.days)


if __name__ == "__main__":
    main()
