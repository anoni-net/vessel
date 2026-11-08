#!/usr/bin/env python3
"""Can people on this node open common sites? Run every hour by vessel-reach.timer.

Some sites refuse addresses abroad or in data centres: a Taiwanese bank, the vehicle registry, a shop. From a node
in Tokyo they time out or answer 403 while the node in Taipei opens them, and someone on Vessel cannot tell that
from a broken connection. This asks each site in reach-sites.tsv once, the way a visitor's device would: inside the
container's network, so the request leaves from the node's public address, and with the node's unfiltered resolver
(10.8.1.1), so a filter list does not count as a block. Nothing of any user is involved.

Each site ends up as
  ok         answered 2xx or 3xx with text only the real page has
  challenge  a bot check (Cloudflare, Akamai, Google's /sorry/): a browser may pass it, curl cannot tell
  blocked    anything else: a timeout, a refused connection, 403, or a page without the site's text
A site counts as blocked only after two runs in a row, so one slow answer does not show up on the status page.
The result goes to /opt/vessel-node/reach.json, which the portal reads through awgctl-remote (reach --json)."""

import json
import os
import subprocess
import sys
import tempfile
import time
from datetime import UTC, datetime

D = "/opt/vessel-node"
SITES = f"{D}/reach-sites.tsv"
OUT = f"{D}/reach.json"
RAW = f"{D}/reach.raw.json"
RESOLVER = "10.8.1.1"
TIMEOUT = 15
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36"
CHALLENGE = ("just a moment", "attention required", "cf-chl", "challenge validation", "/sorry/index", "unusual traffic")


def sites(path: str = SITES) -> list[tuple[str, str, str]]:
    rows = []
    for line in open(path, encoding="utf-8"):
        if line.strip() and not line.startswith("#"):
            site, url, expect = line.rstrip("\n").split("\t")
            rows.append((site, url, expect))
    return rows


def classify(exit_code: int, status: int, headers: str, body: str, expect: str) -> str:
    """One answer as ok, challenge or blocked; see the module's description."""
    if exit_code != 0:
        return "blocked"
    head, text = headers.lower(), body.lower()
    if "cf-mitigated: challenge" in head or any(mark in text for mark in CHALLENGE):
        return "challenge"
    return "ok" if 200 <= status < 400 and expect.lower() in text else "blocked"


def settle(raw: dict[str, str], previous_raw: dict[str, str], previous: dict[str, str]) -> dict[str, str]:
    """A block counts once it is seen twice in a row; until then the site keeps the state it had."""
    return {site: state if state != "blocked" or previous_raw.get(site) == "blocked" else previous.get(site, "ok")
            for site, state in raw.items()}


def ask(pid: str, resolv: str, url: str, expect: str) -> str:
    with tempfile.TemporaryDirectory() as tmp:
        headers, body = os.path.join(tmp, "h"), os.path.join(tmp, "b")
        # a mount namespace of its own, so the bind mount points only this curl at the node's resolver
        command = ["nsenter", "-t", pid, "-n", "unshare", "-m", "--", "sh", "-c",
                   'mount --bind "$0" /etc/resolv.conf && exec "$@"', resolv,
                   "curl", "-4", "-sS", "-L", "--max-redirs", "8", "--max-time", str(TIMEOUT), "--compressed",
                   "-A", UA, "-H", "Accept-Language: zh-TW,zh;q=0.9,en;q=0.8",
                   "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                   "-D", headers, "-o", body, "-w", "%{http_code}", url]
        run = subprocess.run(command, capture_output=True, text=True, timeout=TIMEOUT + 10)
        status = int(run.stdout.strip() or 0) if run.stdout.strip().isdigit() else 0

        def read(path: str, limit: int) -> str:
            try:
                with open(path, "rb") as f:
                    return f.read(limit).decode("utf-8", "replace")
            except OSError:
                return ""

        return classify(run.returncode, status, read(headers, 20000), read(body, 400000), expect)


def load(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def write(path: str, data: dict) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)


def main() -> None:
    pid = subprocess.run(["docker", "inspect", "-f", "{{.State.Pid}}", "vessel-node"],
                         capture_output=True, text=True).stdout.strip()
    if not pid.isdigit() or pid == "0":
        sys.exit("vessel-reach: the vessel-node container is not running")
    with tempfile.NamedTemporaryFile("w", suffix=".resolv.conf", delete=False) as f:
        f.write(f"nameserver {RESOLVER}\n")
        resolv = f.name
    os.chmod(resolv, 0o644)
    try:
        raw = {}
        for site, url, expect in sites():
            try:
                raw[site] = ask(pid, resolv, url, expect)
            except subprocess.TimeoutExpired:
                raw[site] = "blocked"
            time.sleep(1)
    finally:
        os.unlink(resolv)
    previous = load(OUT).get("sites", {})
    states = settle(raw, load(RAW), previous)
    write(RAW, raw)
    write(OUT, {"checked_at": datetime.now(UTC).isoformat(timespec="seconds"), "sites": states})
    print(" ".join(f"{site}={state}" for site, state in states.items() if state != "ok") or "all ok")


if __name__ == "__main__":
    main()
