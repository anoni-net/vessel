"""A software passkey for tests: an ES256 key that answers WebAuthn create() and get() the way a browser would."""

import hashlib
import json
import os
import struct

import cbor2
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from webauthn.helpers import bytes_to_base64url


class SoftKey:
    def __init__(self, rp_id: str = "vessel.anoni.net", origin: str = "https://vessel.anoni.net"):
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.id = os.urandom(16)
        self.rp_id, self.origin = rp_id, origin
        self.user_handle: str | None = None

    def _client(self, kind: str, challenge: str, origin: str | None) -> bytes:
        return json.dumps({"type": kind, "challenge": challenge, "origin": origin or self.origin, "crossOrigin": False}).encode()

    def create(self, options: dict, origin: str | None = None) -> dict:
        self.user_handle = options["user"]["id"]
        n = self.key.public_key().public_numbers()
        cose = cbor2.dumps({1: 2, 3: -7, -1: 1, -2: n.x.to_bytes(32, "big"), -3: n.y.to_bytes(32, "big")})
        # user present, user verified, attested credential data included; zero AAGUID
        auth_data = (hashlib.sha256(self.rp_id.encode()).digest() + bytes([0x45]) + struct.pack(">I", 0)
                     + bytes(16) + struct.pack(">H", len(self.id)) + self.id + cose)
        cid = bytes_to_base64url(self.id)
        return {"id": cid, "rawId": cid, "type": "public-key", "clientExtensionResults": {}, "response": {
            "clientDataJSON": bytes_to_base64url(self._client("webauthn.create", options["challenge"], origin)),
            "attestationObject": bytes_to_base64url(cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth_data})),
            "transports": ["internal"],
        }}

    def get(self, options: dict, origin: str | None = None) -> dict:
        client = self._client("webauthn.get", options["challenge"], origin)
        auth_data = hashlib.sha256(self.rp_id.encode()).digest() + bytes([0x05]) + struct.pack(">I", 0)
        signature = self.key.sign(auth_data + hashlib.sha256(client).digest(), ec.ECDSA(hashes.SHA256()))
        cid = bytes_to_base64url(self.id)
        return {"id": cid, "rawId": cid, "type": "public-key", "clientExtensionResults": {}, "response": {
            "clientDataJSON": bytes_to_base64url(client), "authenticatorData": bytes_to_base64url(auth_data),
            "signature": bytes_to_base64url(signature), "userHandle": self.user_handle,
        }}
