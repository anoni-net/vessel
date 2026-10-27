"""Calling awgctl on a node over SSH. On the node the key is pinned to awgctl-remote, which allows only
add-pubkey, remove, list --json and usage --json."""

import json
import os
import subprocess
from typing import Protocol


class NodeError(Exception):
    pass


class Node(Protocol):
    def add_pubkey(self, host: str, device_id: str, public_key: str, psk: str, dns_filter: str) -> dict: ...
    def remove(self, host: str, device_id: str) -> None: ...
    def usage(self, host: str) -> dict: ...


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
            if "not found" not in str(e):
                raise

    def usage(self, host):
        return json.loads(self._run(host, "usage", "--json"))


_node: Node | None = None


def get_node() -> Node:
    global _node
    if _node is None:
        _node = SSHNode(os.environ["VESSEL_SSH_KEY"], os.environ["VESSEL_SSH_KNOWN_HOSTS"])
    return _node


def set_node(node: Node | None) -> None:
    """Tests swap in a fake node."""
    global _node
    _node = node
