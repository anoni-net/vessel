"""What a node may put in a device's config. The node's answer becomes a file the device's VPN app imports, and on
Linux wg-quick runs PostUp and its kin as root, so a node that was broken into could otherwise run code on every
device made there, or swap in a private key of its own. Only the fields AmneziaWG's clients read get through, and no
value may start a new line. web/src/wgconfig.ts keeps the same lists for the browser (tests/test_clientconfig.py
checks that they match); a new client parameter on the nodes goes into both before the nodes hand it out."""

INTERFACE = frozenset({
    "Address", "DNS", "MTU",
    "Jc", "Jmin", "Jmax", "S1", "S2", "S3", "S4", "H1", "H2", "H3", "H4", "I1", "I2", "I3", "I4", "I5",
    "HeaderProtectionKey", "RekeyAfterTime", "RekeyTimeout", "RejectAfterTime", "KeepaliveTimeout",
    "MaxHandshakeAttempts", "RandomTrailers", "DisableCookies",
})
PEER = frozenset({"PublicKey", "AllowedIPs", "Endpoint", "PersistentKeepalive"})
MAX_VALUE = 4096


class ConfigError(ValueError):
    """A node's answer that may not go into a config; app/jobs.py tries the job again, then gives up."""


def check(config: object) -> dict:
    """The node's answer to add-pubkey, or ConfigError naming the first field that may not go into a config."""
    if not isinstance(config, dict):
        raise ConfigError("config is not an object")
    for section, allowed in (("interface", INTERFACE), ("peer", PEER)):
        fields = config.get(section)
        if not isinstance(fields, dict):
            raise ConfigError(f"config has no {section}")
        for key, value in fields.items():
            if key not in allowed:
                raise ConfigError(f"{section} field not allowed: {str(key)[:40]}")
            if not isinstance(value, str) or len(value) > MAX_VALUE or any(c in value for c in "\r\n\0"):
                raise ConfigError(f"{section} value not allowed: {key}")
    return config
