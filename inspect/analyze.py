#!/usr/bin/env python3
"""Turn the spooled captures into per-device results, then delete the captures (toomore/anoni-net-ws#480).

  analyze.py update-lists              download the lists to compare against
  analyze.py batch                     process finished captures; nothing of them stays but the counts below
  analyze.py report --node N --address A [--seal PUBLIC_KEY]
  analyze.py summary --node N --address A [--seal PUBLIC_KEY]
  analyze.py status
  analyze.py clear --node N --address A
  analyze.py purge --days D

What is kept for a device: traffic per hour, DNS totals, and the list entries it hit (names, and the server addresses
a list knows) with the hours they came up in, and how often and in which hours its lookups went around Vessel.
The sites it visited are not kept, nor the names that did not exist: a report that lists them would be a tool for
whoever holds someone else's phone (#461). To find connections that come back at a steady interval, the times a
destination was last connected to are kept, the destination hashed with a key made for the inspection; the key is in
the state alone, never in a report, and goes with it."""

import argparse
import ipaddress
import hashlib
import hmac
import math
import secrets
import statistics
import base64
import collections
import csv
import datetime as dt
import json
import os
import re
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
# Zeek 9.0.1, what the lts tag was on 2026-11-12. Zeek reads every captured packet as root: the digest keeps a moved
# tag from changing what runs here. To upgrade, pull the new image, run the tests against it, then change this.
ZEEK_IMAGE = "zeek/zeek@sha256:524cb0ce29f26a6a954fb9c357a8f92b95812476d8240f0ece26617ace249dd0"
SUBNET = "10.8.1."
RESOLVERS = {"10.8.1.1", "10.8.1.253", "10.8.1.254"}
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
# Encrypted DNS servers (DoH, DoT, DoQ), by name and by address, from HaGeZi's list of them: a browser's "secure DNS"
# or an app with its own resolver reaches these over port 443, where it looks like any other HTTPS. Its lookups go
# around the node's resolver as the ones to port 53 and 853 do, so they are counted with them.
DOH = "doh"
DOH_SOURCES = {
    "doh.txt": "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/rpz/doh.txt",
    "doh-ips.txt": "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/ips/doh.txt",
}
# Domains that are not bad in themselves and are often abused: dynamic DNS (a home NAS, a router, a camera, or a
# scammer's short-lived server) and hosting anyone can put a site on for free. HaGeZi's lists of them, kept apart from
# SOURCES: they are not kinds of finding, and a hit on one is only counted, never named.
CAUTION_SOURCES = {
    "dyndns": "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/rpz/dyndns.txt",
    "hoster": "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/rpz/hoster.txt",
}
CAUTION = "caution"
# Apple's own resolvers and iCloud Private Relay are on that list too. An iPhone reaches them by itself: nothing the
# person or an app set up, and nothing to look for in the settings, so they are left out. 17.0.0.0/8 is Apple's.
DOH_SYSTEM = ("apple.com", "aaplimg.com", "icloud.com")
DOH_SYSTEM_ADDRESSES = "17."
# Mercenary spyware (Pegasus, Predator and the like): the network indicators that investigations have published, as the
# Mobile Verification Toolkit collects them. Its index lists one STIX2 file per investigation; update-lists turns their
# domains and addresses into one `type,indicator,app` table, the name being the investigation's. Echap's stalkerware is
# in the index too, and is left out: it is compared on its own, above. These indicators are what was known when each
# investigation came out, and such servers move often: a hit is worth expert help, and no hit says little.
SPYWARE = "spyware"
SPYWARE_INDEX = "https://raw.githubusercontent.com/mvt-project/mvt-indicators/main/indicators.yaml"
SPYWARE_SKIP = {"AssoEchap"}
SPYWARE_MIN = 100  # fewer indicators than this in all is a broken download
ADDRESSES = "addresses"
NAMES = "names"
# One visit to a site looks a listed name up as A, AAAA and HTTPS, and then connects with SNI: a hit seen again this
# soon after it was last counted is the same visit (toomore/anoni-net-ws#480)
VISIT_SECONDS = 60
# Names that never leave the device's own network or the operating system: reverse lookups, Bonjour's
# lb._dns-sd._udp.<address>.in-addr.arpa and DDR's _dns.resolver.arpa (all under .arpa), mDNS and home-router names,
# the reserved test and invalid names, onion addresses, and Tailscale's MagicDNS. They say nothing about the sites a
# device reaches, most of them do not exist on purpose, and their names give away the person's own network, so they
# are left out of the DNS counts and are not compared with the lists. A name without a dot is a search-domain guess.
SYSTEM_SUFFIXES = ("arpa", "local", "localdomain", "internal", "lan", "home", "invalid", "test", "onion", "ts.net")
# Plain HTTP the operating system sends by itself, and that is plain by design: certificate status (OCSP, CRL) and the
# checks for a sign-in page on a Wi-Fi network. They carry nothing of the person's, and every device makes them, so they
# are left out of the count of connections without encryption.
PLAIN_SYSTEM_LABEL = re.compile(r"^(ocsp|crl)[0-9]*$")
PLAIN_SYSTEM_SUFFIXES = ("o.lencr.org", "c.lencr.org", "pki.goog", "ctldl.windowsupdate.com")
PLAIN_SYSTEM_HOSTS = {
    "captive.apple.com", "captive.g.aaplimg.com", "connectivitycheck.gstatic.com", "connectivitycheck.android.com",
    "clients1.google.com", "clients3.google.com", "www.msftconnecttest.com", "www.msftncsi.com", "detectportal.firefox.com",
    "nmcheck.gnome.org", "connectivity-check.ubuntu.com", "network-test.debian.org",
}
PLAIN_SYSTEM_PATHS = {"/generate_204", "/gen_204", "/hotspot-detect.html", "/library/test/success.html"}
# Encryption that is no longer safe, as Zeek names the version a connection settled on: an app not updated in years, or a
# server that offers nothing newer. DTLS is left out, its versions number differently.
OLD_TLS = {"SSLv2", "SSLv3", "TLSv10", "TLSv11"}
# The TCP ports a phone or computer uses every day: the web, mail, push notifications (Apple 5223, Google 5228-5230) and
# XMPP. A connection made to any other port is counted, and only counted: the port itself would say what the device was
# used for (a game, SSH, BitTorrent) to whoever holds it.
USUAL_TCP_PORTS = {80, 443, 853, 993, 995, 465, 587, 143, 110, 5222, 5223, 5228, 5229, 5230, 8080, 8443}
# A TCP connection that came to something, as Zeek's conn_state names it, and one that did not: no answer, or refused
TCP_MADE = {"SF", "S1", "S2", "S3", "RSTO", "RSTR"}
TCP_FAILED = {"S0", "REJ"}
# The local networks a device may try to reach through the tunnel: a home or an office. The node drops these. The
# shared address space (100.64.0.0/10, Tailscale's too), link-local and multicast are not counted.
LOCAL_NETWORKS = tuple(ipaddress.ip_network(n) for n in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"))
# Second-level labels under a two-part top-level domain (com.tw, co.uk): the label before them is the one a person registers
SECOND_LEVELS = {"com", "net", "org", "gov", "edu", "ac", "co", "or", "ne", "go"}
# A lookup that may carry data out: a name this long, a label this long (63 is the most a label may be), or a TXT lookup.
# Antivirus apps ask about files with names as long, so these are only counted.
LONG_NAME = 100
LONG_LABEL = 50
# Connections that come back at a steady interval: what malware reporting home does, and also mail, weather and chat
# apps checking in. A connection counts from its handshake alone (a TCP SYN, a QUIC Initial): one that runs on into the
# next 15-minute capture is not a new one there. The operating systems' own services check in by design and are left
# out by name before anything is kept.
TIMER_SERVICES = ("apple.com", "icloud.com", "mzstatic.com", "aaplimg.com", "google.com", "googleapis.com", "gstatic.com",
                  "android.com", "gvt1.com", "gvt2.com", "1e100.net", "microsoft.com", "windows.com", "windowsupdate.com")
TIMER_STARTS = 48       # the last starts kept of a destination
TIMER_MAX = 2000        # destinations kept for a device; past this, new ones are not
TIMER_MIN_STARTS = 8    # starts it takes to tell an interval
TIMER_GAPS = (60, 6 * 3600)  # the interval, in seconds, that counts as steady: once a minute to once in six hours
TIMER_NEAR = 0.15       # a gap within this share of the median one is on time
TIMER_ON_TIME = 0.7     # and this share of the gaps on time makes it steady: a phone asleep for an hour breaks a few
THREAT = {"spyware", "stalkerware"}
FLAGGED = ("spyware", "stalkerware", "malware", "cti")
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
    apps, addresses = load_table(APPS)
    campaigns, servers = load_table(SPYWARE)
    lists[SPYWARE] = set(campaigns) - excluded
    # what a report calls a hit of each kind: the stalkerware it belongs to, or the investigation the indicator is from
    lists[NAMES] = {"stalkerware": apps, SPYWARE: campaigns}
    # the servers a list knows by address alone, by kind: a device that reaches one without looking a name up
    lists[ADDRESSES] = {SPYWARE: servers, "stalkerware": addresses}
    lists[DOH], lists[DOH + "_ips"] = load_doh()
    lists[CAUTION] = {}
    for kind in CAUTION_SOURCES:
        path = HOME / "lists" / f"{kind}.txt"
        lists[CAUTION][kind] = ({name for parts in words(path) if (name := clean(parts[0]))} - excluded) if path.exists() else set()
    return lists


def load_doh():
    """The names and the addresses of encrypted DNS servers; empty where they have not been downloaded."""
    names, addresses = set(), set()
    path = HOME / "lists" / "doh.txt"
    if path.exists():
        for parts in words(path):
            name = clean(parts[0])
            if name and not any(name == s or name.endswith("." + s) for s in DOH_SYSTEM):
                names.add(name)
    path = HOME / "lists" / "doh-ips.txt"
    if path.exists():
        for parts in words(path):
            if parts[0].count(".") == 3 and parts[0].replace(".", "").isdigit() and not parts[0].startswith(DOH_SYSTEM_ADDRESSES):
                addresses.add(parts[0])
    return names, addresses


def load_apps():
    """Domain to stalkerware name, from Echap's network.csv; empty where it has not been downloaded."""
    return load_table(APPS)[0]


def address(word):
    """An IPv4 address on the internet as it is written in a list, or None: a range, a private address or anything
    else is not one. A list that named a private address would match a home router."""
    parts = word.strip().split(".")
    if len(parts) != 4 or not all(p.isdigit() and len(p) <= 3 and int(p) <= 255 for p in parts):
        return None
    a, b = int(parts[0]), int(parts[1])
    private = a in (0, 10, 127) or a >= 224 or (a == 100 and 64 <= b <= 127) or (a == 169 and b == 254) \
        or (a == 172 and 16 <= b <= 31) or (a == 192 and b == 168)
    return None if private else ".".join(str(int(p)) for p in parts)


def load_table(name):
    """(domain to name, address to name) from a `type,indicator,app` table like Echap's network.csv: the names a
    report gives its hits, and the server addresses the list knows, which no file of names has. An address without
    a name is kept with None."""
    path = HOME / "lists" / f"{name}.csv"
    names, addresses = {}, {}
    if path.exists():
        with open(path, encoding="utf-8", errors="replace", newline="") as f:
            for row in csv.DictReader(f):
                app = (row.get("app") or "").strip()
                if row.get("type") == "domain" and (domain := clean(row.get("indicator") or "")) and app:
                    names.setdefault(domain, app)
                elif row.get("type") == "ipv4" and (ip := address(row.get("indicator") or "")):
                    addresses.setdefault(ip, app or None)
    return names, addresses


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
    return next(((kind, entry) for kind in FLAGGED if (entry := entry_of(name, lists.get(kind, ())))), None)


def lists_of(name, lists):
    """Every list that covers a name, the ad list included: what the lists themselves say about a site, so that a report
    can tell an ad network that is also on a malware list from a site only a malware list knows (toomore/anoni-net-ws#480).
    Nothing about the device is learnt from it."""
    return {kind for kind in (SPYWARE, *SOURCES) if listed(name, lists.get(kind, ()))}


def system_name(name):
    name = name.lower().rstrip(".")
    return "." not in name or any(name == s or name.endswith("." + s) for s in SYSTEM_SUFFIXES)


def plain_system(row):
    """Whether a plain HTTP request is one the operating system sends by itself (PLAIN_SYSTEM_* above)."""
    # the Host header may carry a port; an IPv6 address in brackets has no name to go by
    host = (row.get("host") or "").lower()
    host = "" if host.startswith("[") else host.split(":", 1)[0]
    if PLAIN_SYSTEM_LABEL.match(host.split(".")[0]) or host in PLAIN_SYSTEM_HOSTS:
        return True
    if any(host == s or host.endswith("." + s) for s in PLAIN_SYSTEM_SUFFIXES):
        return True
    return (row.get("uri") or "").split("?", 1)[0] in PLAIN_SYSTEM_PATHS


def registered_label(name):
    """The label a person registers: the one before the top-level domain, or before a two-part one (example.com.tw)."""
    labels = name.lower().rstrip(".").split(".")
    if len(labels) < 2:
        return None
    if len(labels) >= 3 and len(labels[-1]) == 2 and labels[-2] in SECOND_LEVELS:
        return labels[-3]
    return labels[-2]


def random_looking(name):
    """Whether the registered label of a name looks made up by a program: long, letters and digits only, the letters
    hardly repeating, and few vowels or digits mixed in. Only that label is looked at: a CDN's subdomains are hashes."""
    label = registered_label(name)
    if not label or len(label) < 10 or label.startswith("xn--") or not label.isalnum() or label.isdigit():
        return False
    entropy = -sum(n / len(label) * math.log2(n / len(label)) for n in collections.Counter(label).values())
    vowels = sum(c in "aeiou" for c in label) / len(label)
    digits = sum(c.isdigit() for c in label)
    return entropy >= 3.0 and (vowels <= 0.2 or digits >= 3)


def steady(times):
    """The interval in seconds a destination's connections keep to, or None: the median gap between its starts, within
    TIMER_GAPS, with most of the gaps near it. The median and not the mean, so that a night asleep does not hide it."""
    if len(times) < TIMER_MIN_STARTS:
        return None
    gaps = [b - a for a, b in zip(times, times[1:])]
    median = statistics.median(gaps)
    if not TIMER_GAPS[0] <= median <= TIMER_GAPS[1]:
        return None
    return median if sum(abs(g - median) <= TIMER_NEAR * median for g in gaps) >= TIMER_ON_TIME * len(gaps) else None


def is_local(ip):
    """Whether an address is on a home or office network (LOCAL_NETWORKS), the tunnel's own included."""
    try:
        return any(ipaddress.ip_address(ip) in n for n in LOCAL_NETWORKS)
    except ValueError:
        return False


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
                "hits": {}, "bypass": 0, "bypass_hours": [], "bypass_last": None, "bypass_filled": True, "plain": 0, "old_tls": 0, "ads_bytes": 0,
                "odd_ports": 0, "local": 0, "tcp": [0, 0],
                "random_nx": 0, "carry": 0, "dyndns": 0, "hoster": 0,
                # the key the destinations are hashed with, and their last connection times
                "key": secrets.token_hex(32), "timers": {}, "timers_full": False,
                "first": None, "last": None}
    state = json.loads(path.read_text())
    # an older state kept the names that did not exist; they go with the next write
    state.pop("nx_names", None)
    state.setdefault("bypass_hours", [])
    state.setdefault("bypass_last", None)
    # connections without encryption were not counted when it began: not known, rather than none
    state.setdefault("plain", None)
    state.setdefault("old_tls", None)
    state.setdefault("ads_bytes", None)
    state.setdefault("odd_ports", None)
    state.setdefault("local", None)
    state.setdefault("tcp", None)
    state.setdefault("random_nx", None)
    state.setdefault("carry", None)
    state.setdefault("dyndns", None)
    state.setdefault("hoster", None)
    # an inspection that began before connection times were kept has no key, and nothing is kept for it
    state.setdefault("timers", None)
    for hit in state["hits"].values():
        hit.setdefault("last", hit["first"])
        hit.setdefault("hours", [hour_of(hit["first"])])
        hit.setdefault("counted", hit["last"])
        # an older state did not say which other lists its names were on; nothing is guessed for it
        hit.setdefault("lists", [hit["kind"]])
        # nor how many of its visits the node's lists stopped: unknown for good, as the visits before are not known
        hit.setdefault("blocked", None)
    # An older state counted the lookups around Vessel without their hours, so an inspection that began before the
    # hours were kept had a count and nothing to draw. It did mark those hours for a check ("!"), as a listed site
    # does: the marked hours no site accounts for are the lookups'. Done once, as later the hours are kept directly.
    # An hour that also had a known threat is marked for the threat and is not found again, and when the last lookup
    # was is not known.
    if not state.setdefault("bypass_filled", False):
        if state["bypass"]:
            sites = {hour for hit in state["hits"].values() for hour in hit["hours"]}
            marked = {hour for hour, sign in state["marks"].items() if sign == "!" and hour not in sites}
            state["bypass_hours"] = sorted(set(state["bypass_hours"]) | marked)
        state["bypass_filled"] = True
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
            app = app_of(name, lists.get(NAMES, {}).get(matched[0], {}))
            # a lookup the node's own lists answered for: the device got no address from Vessel
            stopped = how == "DNS" and (row["id.orig_h"], name) in logs.get("blocked", ())
            candidates.append((row["ts"], row["id.orig_h"], *matched, how, lists_of(name, lists), app, stopped))

    def count_hit(ts, address, kind, entry, how, on, app, stopped):
        """A visit counts once: Zeek's rows come in no set order, so they are sorted before they get here. `on` is every
        list the name seen covers; a hit is a list entry, so its lists are those of all the names it came from. `app`
        is the stalkerware the name belongs to, kept from the first name that had one.

        `blocked` counts the visits Vessel stopped: every row of the visit a lookup the node's lists answered for. One
        lookup answered, or a connection by SNI, HTTP or address, and the visit went through: the device then had the
        address from somewhere, or reached the server. `stopped` says so for the visit counted last, as its rows come."""
        state = get(address)
        hit = state["hits"].setdefault(f"{kind}|{entry}", {"kind": kind, "name": entry, "how": how, "count": 0, "first": ts,
                                                           "last": ts, "hours": [], "counted": None, "lists": [kind],
                                                           "blocked": 0, "stopped": False})
        hit["lists"] = sorted(set(hit["lists"]) | on | {kind})
        if app and not hit.get("app"):
            hit["app"] = app
        if hit["counted"] is None or abs(ts - hit["counted"]) >= VISIT_SECONDS:
            hit["count"] += 1
            if hit["blocked"] is not None and stopped:
                hit["blocked"] += 1
            # a visit before the one counted last (a capture that came late) is counted, and leaves the last one open
            if hit["counted"] is None or ts > hit["counted"]:
                hit["stopped"] = stopped
            hit["counted"] = max(hit["counted"] or ts, ts)
        elif hit.get("stopped") and not stopped:
            if hit["blocked"] is not None:
                hit["blocked"] -= 1
            hit["stopped"] = False
        hit["first"] = min(hit["first"], ts)
        hit["last"] = max(hit["last"], ts)
        hit["hours"] = sorted(set(hit["hours"]) | {hour_of(ts)})
        mark(state, ts, "x" if kind in THREAT else "!")

    def bypassed(row):
        state = get(row["id.orig_h"])
        state["bypass"] += 1
        # the hours are the ones already marked on the device's hours: kept apart, they are drawn by day like a site's
        state["bypass_hours"] = sorted(set(state["bypass_hours"]) | {hour_of(row["ts"])})
        state["bypass_last"] = max(state["bypass_last"] or 0, row["ts"])
        mark(state, row["ts"], "!")

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
            # a made-up name that does not exist: what malware looking for its control server asks for
            if state["random_nx"] is not None and random_looking(name):
                state["random_nx"] += 1
        if state["carry"] is not None and (row.get("qtype_name") == "TXT" or len(name) >= LONG_NAME
                                           or max(map(len, name.split("."))) >= LONG_LABEL):
            state["carry"] += 1
        if listed(name, lists["ads"]):
            state["dns"]["ads"] += 1
        note_hit(row, name, "DNS")
    # connections to an encrypted DNS server: by the name the connection asks for, once each
    around = set()
    named = set()
    for log, field, how in (("ssl", "server_name", "SNI"), ("quic", "server_name", "SNI"), ("http", "host", "HTTP")):
        for row in logs[log]:
            if ours(row) and row.get(field):
                note_hit(row, row[field].lower(), how)
                if how == "SNI":
                    # Zeek's id for the connection, the same in its conn log
                    uid = row.get("uid") or object()
                    named.add(uid)
                    if listed(row[field].lower(), lists.get(DOH, ())) and uid not in around:
                        around.add(uid)
                        bypassed(row)
    # connections without encryption: each one once, however many requests it carried; not where they went
    plain = collections.defaultdict(set)
    for row in logs["http"]:
        if ours(row) and not plain_system(row):
            plain[row["id.orig_h"]].add(row.get("uid") or object())
    for address, connections in plain.items():
        state = get(address)
        if state["plain"] is not None:
            state["plain"] += len(connections)
    # connections that settled on an old version of TLS: each one once, and not where they went
    old_tls = collections.defaultdict(set)
    for row in logs["ssl"]:
        if ours(row) and row.get("version") in OLD_TLS:
            old_tls[row["id.orig_h"]].add(row.get("uid") or object())
    for address, connections in old_tls.items():
        state = get(address)
        if state["old_tls"] is not None:
            state["old_tls"] += len(connections)
    # The traffic of connections to ad and tracking services, from the IP headers' lengths as the hours' traffic is (Zeek's
    # *_ip_bytes stay whole in a packet cut to its start). A connection is named by its SNI or HTTP Host, or else by the
    # lookup in the same capture that answered with its address: a name looked up earlier and cached is not known, so
    # the share is if anything low. Only the bytes are kept.
    named_by = {}
    for log, field in (("ssl", "server_name"), ("quic", "server_name"), ("http", "host")):
        for row in logs[log]:
            if ours(row) and row.get(field) and row.get("uid"):
                named_by.setdefault(row["uid"], row[field].lower().split(":")[0])
    answered = {}
    for row in logs["dns"]:
        if ours(row) and row.get("query"):
            for answer in row.get("answers") or ():
                answered[(row["id.orig_h"], answer)] = row["query"].lower()
    ads_bytes = collections.Counter()
    for row in logs["conn"]:
        if not ours(row):
            continue
        name = named_by.get(row.get("uid")) or answered.get((row["id.orig_h"], row.get("id.resp_h")))
        if name and listed(name, lists["ads"]):
            ads_bytes[row["id.orig_h"]] += (row.get("orig_ip_bytes") or 0) + (row.get("resp_ip_bytes") or 0)
    for address, size in ads_bytes.items():
        state = get(address)
        if state["ads_bytes"] is not None:
            state["ads_bytes"] += size
    # When each destination was connected to, for the steady intervals: the destination named as for the ad traffic, or
    # by its address, then hashed with the inspection's key. Only handshakes count, and not the system's own services.
    starts = [row for row in logs["conn"] if row.get("proto") == "tcp" and (row.get("history") or "").startswith("S")]
    for row in [*starts, *logs["quic"]]:
        if not ours(row) or row.get("id.resp_h") in RESOLVERS or is_local(row.get("id.resp_h")):
            continue
        state = get(row["id.orig_h"])
        if state["timers"] is None:
            continue
        name = named_by.get(row.get("uid")) or answered.get((row["id.orig_h"], row.get("id.resp_h"))) or row.get("id.resp_h") or ""
        if any(name == s or name.endswith("." + s) for s in TIMER_SERVICES):
            continue
        tag = hmac.new(bytes.fromhex(state["key"]), name.encode(), hashlib.sha256).hexdigest()[:32]
        times = state["timers"].get(tag)
        if times is None:
            if len(state["timers"]) >= TIMER_MAX:
                state["timers_full"] = True
                continue
            times = state["timers"][tag] = []
        at = int(row["ts"])
        if at not in times:
            times.append(at)
            times.sort()
            del times[:-TIMER_STARTS]
    # Visits to dynamic DNS and to hosting that is often abused, by the names looked up and connected to, a visit once
    # as a site's is (VISIT_SECONDS); the names are not kept
    seen_caution = []
    for log, field in (("dns", "query"), ("ssl", "server_name"), ("quic", "server_name"), ("http", "host")):
        for row in logs[log]:
            if not ours(row) or not row.get(field):
                continue
            name = row[field].lower().split(":")[0]
            if name == AD_BLOCK_TARGET or system_name(name):
                continue
            for kind, names in lists.get(CAUTION, {}).items():
                if entry := entry_of(name, names):
                    seen_caution.append((row["ts"], row["id.orig_h"], kind, entry))
    last_visit = {}
    for ts, device, kind, entry in sorted(seen_caution):
        state = get(device)
        if state[kind] is None or ts - last_visit.get((device, kind, entry), -VISIT_SECONDS) < VISIT_SECONDS:
            continue
        last_visit[(device, kind, entry)] = ts
        state[kind] += 1
    # How the device's connections went: to a port outside the everyday ones, to a local network, and the TCP
    # connections that got no answer or were refused (those to a local network apart: the node drops them)
    for row in logs["conn"]:
        if not ours(row) or row.get("id.resp_h") in RESOLVERS:
            continue
        state = get(row["id.orig_h"])
        if state["local"] is None:
            continue
        local = is_local(row.get("id.resp_h"))
        if local:
            state["local"] += 1
        elif row.get("proto") == "tcp":
            state["tcp"][0] += 1
            if row.get("conn_state") in TCP_FAILED:
                state["tcp"][1] += 1
            elif row.get("conn_state") in TCP_MADE and row.get("id.resp_p") not in USUAL_TCP_PORTS:
                state["odd_ports"] += 1
    # A server a list knows by its address. A device that looked up a listed name and then connected has the name's
    # hit already: the address is the same visit, and is not listed as a second site.
    by_name = collections.defaultdict(list)
    for ts, device, kind, *_ in candidates:
        by_name[(device, kind)].append(ts)
    for row in logs["conn"]:
        if not ours(row):
            continue
        for kind, addresses in lists.get(ADDRESSES, {}).items():
            ip = row.get("id.resp_h")
            if ip in addresses and not any(abs(row["ts"] - ts) < VISIT_SECONDS for ts in by_name[(row["id.orig_h"], kind)]):
                candidates.append((row["ts"], row["id.orig_h"], kind, ip, "IP", {kind}, addresses[ip], False))
                break
    # sorted() keeps DNS ahead of SNI and HTTP at the same moment, so a visit's first row names how it was seen
    for candidate in sorted(candidates, key=lambda c: c[0]):
        count_hit(*candidate)
    for row in logs["conn"]:
        if not ours(row):
            continue
        state = get(row["id.orig_h"])
        seen(state, row["ts"])
        if row.get("id.resp_p") in (53, 853) and row.get("id.resp_h") not in RESOLVERS:
            bypassed(row)
        # or by its address, where the connection gave no name: an address with a name may be a site next to the server
        elif row.get("id.resp_p") == 443 and row.get("id.resp_h") in lists.get(DOH + "_ips", ()) and row.get("uid") not in named:
            bypassed(row)
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
    # the hours stay in UTC: the share of the night is counted in the reader's browser, on the reader's clock
    for hour, (up, down) in sorted(state["hours"].items()):
        hours.append({"hour": hour, "up": up, "down": down, "mark": state["marks"].get(hour)})
    names = sorted(state["hours"])
    span = 1
    if names:
        low, high = (dt.datetime.strptime(h, "%Y-%m-%dT%H") for h in (names[0], names[-1]))
        span = int((high - low).total_seconds() // 3600) + 1
    dns = state["dns"]
    found = collections.Counter()
    entries = collections.Counter()
    findings = []
    for hit in sorted(state["hits"].values(), key=lambda h: (h["kind"] not in THREAT, FLAGGED.index(h["kind"]), -h["count"])):
        found[hit["kind"]] += hit["count"]
        entries[hit["kind"]] += 1
        if entries[hit["kind"]] <= MAX_FINDINGS:
            findings.append({"severity": "threat" if hit["kind"] in THREAT else "check",
                             **{k: hit[k] for k in ("kind", "name", "how", "count", "first", "last", "hours", "lists")},
                             **({"app": hit["app"]} if hit.get("app") else {}),
                             # absent where the inspection began before it was counted
                             **({"blocked": hit["blocked"]} if hit.get("blocked") is not None else {})})
    if state["bypass"]:
        findings.append({"severity": "check", "kind": "bypass_dns", "count": state["bypass"],
                         **({"hours": state["bypass_hours"]} if state["bypass_hours"] else {}),
                         # hours found in an older state's marks come without the time of the last lookup
                         **({"last": state["bypass_last"]} if state["bypass_hours"] and state["bypass_last"] else {})})
    checks = [{"id": kind, "count": found[kind]} for kind in FLAGGED] + [{"id": "bypass_dns", "count": state["bypass"]}]
    return {
        "node": node, "address": address, "first": state["first"], "last": state["last"], "hours": hours,
        "coverage": {"active_hours": len(hours), "total_hours": span},
        "dns": {"total": dns["total"], "nx_share": dns["nx"] / dns["total"] if dns["total"] else 0,
                "ads_share": dns["ads"] / dns["total"] if dns["total"] else 0},
        "lists_at": lists_at(),
        "checks": checks, "findings": findings,
        # absent where the inspection began before it was counted
        **({"plain": state["plain"]} if state["plain"] is not None else {}),
        **({"old_tls": state["old_tls"]} if state["old_tls"] is not None else {}),
        # how the device's connections went; absent where the inspection began before they were counted
        **({"odd_ports": state["odd_ports"], "local": state["local"],
            "tcp": {"total": state["tcp"][0], "failed": state["tcp"][1]}} if state["local"] is not None else {}),
        # how many destinations came back at a steady interval, and about how often (the median of theirs, in minutes)
        **({"timers": {"count": len(found := [g for t in state["timers"].values() if (g := steady(t))]),
                       "minutes": round(statistics.median(found) / 60) if found else None}}
           if state["timers"] is not None else {}),
        # visits to dynamic DNS and to hosting that is often abused
        **({"dyndns": state["dyndns"], "hoster": state["hoster"]} if state["dyndns"] is not None else {}),
        # lookups for made-up names that do not exist, and lookups that may carry data out
        **({"random_nx": state["random_nx"], "carry": state["carry"]} if state["random_nx"] is not None else {}),
        # of all the traffic in the hours above, the share that went to ad and tracking services
        **({"ads_traffic_share": min(state["ads_bytes"] / total, 1) if (total := sum(u + d for u, d in state["hours"].values())) else 0}
           if state["ads_bytes"] is not None else {}),
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


def list_files():
    """Every file update-lists downloads, and where it comes from."""
    return {**{f"{kind}.txt": url for kind, url in SOURCES.items()}, f"{APPS}.csv": APPS_SOURCE, **DOH_SOURCES,
            **{f"{kind}.txt": url for kind, url in CAUTION_SOURCES.items()},
            f"{SPYWARE}.csv": SPYWARE_INDEX}


def lists_at():
    """When the oldest of the lists was last downloaded, or None while one of them is missing. A capture is compared
    with the lists as they are when it is analysed and then deleted, so a list that stopped updating is not made up for
    later: the portal's health check warns about it, and a report says how old its lists were."""
    paths = [HOME / "lists" / name for name in list_files()]
    return min(int(p.stat().st_mtime) for p in paths) if all(p.exists() for p in paths) else None


def status():
    """For the portal's health check: when the analysis last ran, how full the disk is, and how old the lists are."""
    usage = shutil.disk_usage(HOME)
    stamp = HOME / "last-batch"
    connected = HOME / "connected"
    return {"last_batch": stamp.stat().st_mtime if stamp.exists() else None, "disk_used": usage.used / usage.total,
            "waiting": sum(1 for _ in (HOME / "spool").glob("*/*.pcap")),
            "connected": connected.read_text().split() if connected.exists() else [],
            "lists_at": lists_at()}


def spyware_sources(index):
    """(name, URL of its STIX2 file) of each investigation in MVT's index. The index is YAML of one shape, read here
    line by line so that the host needs no YAML library; only files on GitHub are taken, from the address the index
    gives, with nothing in it that could point elsewhere."""
    sources = []
    for entry in re.split(r"(?m)^\s*-\s*$", index):
        keys = dict(re.findall(r"(?m)^\s+(name|owner|repo|branch|path):\s*(.+?)\s*$", entry))
        if not all(k in keys for k in ("name", "owner", "repo", "branch", "path")) or keys["owner"] in SPYWARE_SKIP:
            continue
        where = [keys["owner"], keys["repo"], keys["branch"], *keys["path"].split("/")]
        if not all(re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]*", part) for part in where):
            raise ValueError(f"index: {keys['name']}")
        sources.append((keys["name"].strip("\"' ").removesuffix(" Indicators of Compromise").strip(),
                        "https://raw.githubusercontent.com/" + "/".join(where)))
    return sources


def spyware_rows(index_url):
    """(type, indicator, name) of every domain and address in the investigations of MVT's index. Any of them missing
    fails the whole download, so that the table is never a part of what it was."""
    with urllib.request.urlopen(index_url, timeout=120) as response:
        sources = spyware_sources(response.read().decode("utf-8", "replace"))
    rows = []
    for name, url in sources:
        with urllib.request.urlopen(url, timeout=120) as response:
            bundle = json.load(response)
        for item in bundle.get("objects", []):
            found = re.fullmatch(r"\[(domain-name|ipv4-addr):value\s*=\s*'([^']+)'\]", item.get("pattern", "")) if item.get("type") == "indicator" else None
            if found and found[1] == "domain-name" and (domain := clean(found[2])):
                rows.append(("domain", domain, name))
            elif found and found[1] == "ipv4-addr" and (ip := address(found[2])):
                rows.append(("ipv4", ip, name))
    if len(rows) < SPYWARE_MIN:
        raise ValueError("too few indicators")
    return rows


def update_lists():
    """Download the lists; a list that could not be downloaded keeps its previous copy. Returns the files that failed."""
    (HOME / "lists").mkdir(parents=True, exist_ok=True, mode=0o700)
    failed = []
    for name, url in list_files().items():
        path = HOME / "lists" / name
        part = path.with_suffix(".part")
        try:
            if name == f"{SPYWARE}.csv":
                with part.open("w", encoding="utf-8", newline="") as f:
                    csv.writer(f).writerows([("type", "indicator", "app"), *spyware_rows(url)])
            else:
                with urllib.request.urlopen(url, timeout=120) as response, part.open("wb") as f:
                    shutil.copyfileobj(response, f)
                if part.stat().st_size < 1024:
                    raise ValueError("too small")
        except (OSError, ValueError) as e:
            # the previous copy stays
            print(f"{name}: {e}", file=sys.stderr)
            part.unlink(missing_ok=True)
            failed.append(name)
            continue
        os.replace(part, path)
    return failed


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
        # a failure shows in the timer's unit; the lists that did download are in place
        sys.exit(1 if update_lists() else 0)
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
