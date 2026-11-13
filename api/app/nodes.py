"""Calling awgctl on a node over SSH. On the node the key is pinned to awgctl-remote, which allows only
add-pubkey, remove, suspend, resume, throttle on and off, list --json, usage --json and the inspection calls, and
reach --json, which reads the node's own check of the sites it can open (node/host/vessel-reach.py), and probe --csv,
which reads its hourly counts of what reached the AWG port from addresses that are not a device's
(node/host/vessel-probe-watch.sh)."""

import json
import os
import re
import shlex
import subprocess
from typing import Protocol


class NodeError(Exception):
    pass


# what may go into the command that reaches a host through a jump host (probe_controls)
ADDRESS = re.compile(r"^[A-Za-z0-9_.:-]+$")
JUMP = re.compile(r"^[a-z_][a-z0-9_-]*@[A-Za-z0-9_.:-]+$")


class Node(Protocol):
    def add_pubkey(self, host: str, device_id: str, public_key: str, psk: str, dns_filter: str) -> dict: ...
    def remove(self, host: str, device_id: str) -> None: ...
    def suspend(self, host: str, device_id: str) -> None: ...
    def resume(self, host: str, device_id: str) -> None: ...
    def throttle_on(self, host: str, device_id: str) -> None: ...
    def throttle_off(self, host: str, device_id: str) -> None: ...
    def usage(self, host: str) -> dict: ...
    def list_peers(self, host: str) -> list[dict]: ...
    def reach(self, host: str) -> dict: ...
    def probe(self, host: str, jump: str | None = None) -> str: ...
    def inspect_on(self, host: str, device_id: str, until: int, code: str) -> None: ...
    def inspect_off(self, host: str, device_id: str) -> None: ...
    def inspect_confirms(self, host: str) -> list[dict]: ...
    def inspect_ack(self, host: str, code: str) -> None: ...


class Analysis(Protocol):
    def report(self, node: str, address: str, public_key: str) -> dict: ...
    def summary(self, node: str, address: str, public_key: str) -> dict: ...
    def clear(self, node: str, address: str) -> None: ...
    def status(self) -> dict: ...
    def flush(self) -> None: ...


class SSHNode:
    def __init__(self, key_path: str, known_hosts: str, user: str = "root", timeout: float = 20):
        self.key_path, self.known_hosts, self.user, self.timeout = key_path, known_hosts, user, timeout

    def _command(self, host: str, *args: str, jump: str | None = None) -> list[str]:
        # -F /dev/null: ignore any ssh_config on the host, so nothing there can turn off key auth or add proxies
        options = [
            "-F", "/dev/null", "-i", self.key_path, "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
            "-o", "PubkeyAuthentication=yes",
            "-o", f"UserKnownHostsFile={self.known_hosts}", "-o", "StrictHostKeyChecking=yes",
            "-o", "ConnectTimeout=10",
        ]
        cmd = ["ssh", *options]
        if jump:
            # A host that is not on the tailnet, through one that is: the same key and known_hosts for both hops. On
            # the jump host the key may only forward to that host. ssh hands ProxyCommand to a shell, so only plain
            # addresses go into it.
            if not JUMP.match(jump) or not ADDRESS.match(host):
                raise NodeError("jump: not an address")
            cmd += ["-o", "ProxyCommand=" + shlex.join(["ssh", *options, "-W", "%h:%p", jump])]
        return [*cmd, f"{self.user}@{host}", " ".join(args)]

    def _run(self, host: str, *args: str, jump: str | None = None) -> str:
        cmd = self._command(host, *args, jump=jump)
        try:
            done = subprocess.run(cmd, check=False, capture_output=True, text=True, timeout=self.timeout)
        except subprocess.TimeoutExpired as e:
            raise NodeError("timeout") from e
        if done.returncode != 0:
            raise NodeError(done.stderr.strip() or f"exit {done.returncode}")
        return done.stdout

    def add_pubkey(self, host, device_id, public_key, psk, dns_filter):
        return json.loads(self._run(host, "add-pubkey", device_id, public_key, psk, dns_filter))

    def remove(self, host, device_id):
        try:
            self._run(host, "remove", device_id)
        except NodeError as e:
            # gone already is what remove wants; awgctl says "awgctl: <id> not found" (and applies first)
            if not str(e).endswith(f"{device_id} not found"):
                raise

    def suspend(self, host, device_id):
        try:
            self._run(host, "suspend", device_id)
        except NodeError as e:
            # a peer the node does not have cannot connect either
            if not str(e).endswith(f"{device_id} not found"):
                raise

    def resume(self, host, device_id):
        self._run(host, "resume", device_id)

    def throttle_on(self, host, device_id):
        try:
            self._run(host, "throttle", "on", device_id)
        except NodeError as e:
            # a peer the node does not have uses nothing to slow down
            if not str(e).endswith(f"{device_id} not found"):
                raise

    def throttle_off(self, host, device_id):
        try:
            self._run(host, "throttle", "off", device_id)
        except NodeError as e:
            # a peer that is gone has no limit left
            if not str(e).endswith(f"{device_id} not found"):
                raise

    def usage(self, host):
        return json.loads(self._run(host, "usage", "--json"))

    def list_peers(self, host):
        try:
            return json.loads(self._run(host, "list", "--json"))
        except ValueError as e:
            raise NodeError(f"list: {e}") from e

    def reach(self, host):
        try:
            return json.loads(self._run(host, "reach", "--json"))
        except ValueError as e:
            raise NodeError(f"reach: {e}") from e

    def probe(self, host, jump=None):
        return self._run(host, "probe", "--csv", jump=jump)

    def inspect_on(self, host, device_id, until, code):
        # the node starts only when it holds this code as confirmed by the device itself (node/awgctl, confirmed)
        self._run(host, "inspect", "on", device_id, str(until), code)

    def inspect_off(self, host, device_id):
        try:
            self._run(host, "inspect", "off", device_id)
        except NodeError as e:
            # a device that is gone has no rules left
            if not str(e).endswith(f"{device_id} not found"):
                raise

    def inspect_confirms(self, host):
        try:
            return json.loads(self._run(host, "inspect", "confirms", "--json"))
        except ValueError as e:
            raise NodeError(f"confirms: {e}") from e

    def inspect_ack(self, host, code):
        self._run(host, "inspect", "ack", code)


class SSHAnalysis:
    """The analysis host: the key is pinned to inspect/inspect-remote there."""

    def __init__(self, host: str, ssh: SSHNode):
        self.host, self.ssh = host, ssh

    def _json(self, *args: str) -> dict:
        try:
            return json.loads(self.ssh._run(self.host, *args))
        except ValueError as e:
            raise NodeError(f"analysis: {e}") from e

    def report(self, node, address, public_key):
        return self._json("report", node, address, public_key)

    def summary(self, node, address, public_key):
        return self._json("summary", node, address, public_key)

    def clear(self, node, address):
        self.ssh._run(self.host, "clear", node, address)

    def status(self):
        return self._json("status")

    def flush(self):
        self.ssh._run(self.host, "flush")


_node: Node | None = None
_analysis: Analysis | None = None


def get_node() -> Node:
    global _node
    if _node is None:
        _node = SSHNode(os.environ["VESSEL_SSH_KEY"], os.environ["VESSEL_SSH_KNOWN_HOSTS"])
    return _node


def get_analysis() -> Analysis | None:
    """None where no analysis host is set: inspection is not offered."""
    global _analysis
    host = os.environ.get("VESSEL_ANALYSIS_HOST")
    if _analysis is None and host:
        _analysis = SSHAnalysis(host, SSHNode(os.environ["VESSEL_SSH_KEY"], os.environ["VESSEL_SSH_KNOWN_HOSTS"]))
    return _analysis


def set_analysis(analysis: Analysis | None) -> None:
    """Tests swap in a fake one."""
    global _analysis
    _analysis = analysis


def set_node(node: Node | None) -> None:
    """Tests swap in a fake node."""
    global _node
    _node = node
