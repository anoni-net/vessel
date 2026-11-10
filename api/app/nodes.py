"""Calling awgctl on a node over SSH. On the node the key is pinned to awgctl-remote, which allows only
add-pubkey, remove, suspend, resume, throttle on and off, list --json, usage --json and the inspection calls, and
reach --json, which reads the node's own check of the sites it can open (node/host/vessel-reach.py)."""

import json
import os
import subprocess
from typing import Protocol


class NodeError(Exception):
    pass


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
    def inspect_on(self, host: str, device_id: str, until: int) -> None: ...
    def inspect_off(self, host: str, device_id: str) -> None: ...
    def inspect_confirms(self, host: str) -> list[dict]: ...
    def inspect_ack(self, host: str, code: str) -> None: ...


class Analysis(Protocol):
    def report(self, node: str, address: str, public_key: str) -> dict: ...
    def clear(self, node: str, address: str) -> None: ...
    def status(self) -> dict: ...
    def flush(self) -> None: ...


class SSHNode:
    def __init__(self, key_path: str, known_hosts: str, user: str = "root", timeout: float = 20):
        self.key_path, self.known_hosts, self.user, self.timeout = key_path, known_hosts, user, timeout

    def _run(self, host: str, *args: str) -> str:
        # -F /dev/null: ignore any ssh_config on the host, so nothing there can turn off key auth or add proxies
        cmd = [
            "ssh", "-F", "/dev/null", "-i", self.key_path, "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
            "-o", "PubkeyAuthentication=yes",
            "-o", f"UserKnownHostsFile={self.known_hosts}", "-o", "StrictHostKeyChecking=yes",
            "-o", "ConnectTimeout=10", f"{self.user}@{host}", " ".join(args),
        ]
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


    def inspect_on(self, host, device_id, until):
        self._run(host, "inspect", "on", device_id, str(until))

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
