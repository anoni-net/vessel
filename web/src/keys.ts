import { x25519 } from "@noble/curves/ed25519.js";

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

export interface KeyPair {
  privateKey: string;
  publicKey: string;
}

/** A WireGuard key pair, generated in the browser. The private key never leaves this page. */
export function generateKeyPair(): KeyPair {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  // clamp like `wg genkey`; X25519 clamps anyway, so the public key is the same either way
  secret[0] &= 248;
  secret[31] = (secret[31] & 127) | 64;
  return { privateKey: b64(secret), publicKey: b64(x25519.getPublicKey(secret)) };
}

export function generatePresharedKey(): string {
  return b64(crypto.getRandomValues(new Uint8Array(32)));
}
