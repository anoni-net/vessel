import { x25519 } from "@noble/curves/ed25519.js";

// A device inspection's report is sealed to a key made here (anoni-net/vessel inspect/analyze.py, `seal`): the
// portal stores only ciphertext. The private key stays in this browser, and the person can copy it to read the
// report elsewhere, or after the browser has cleared its storage.

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const slot = (deviceId: string) => `vessel-inspection:${deviceId}`;
const INFO = new TextEncoder().encode("vessel-inspection-report");
// a group leader's summary is sealed with its own info (inspect/analyze.py, SUMMARY_INFO), so one cannot pass for the other
const SUMMARY_INFO = new TextEncoder().encode("vessel-inspection-summary");
const LEADER_SLOT = "vessel-leader-key";

export interface Sealed { epk: string; iv: string; ct: string }
export interface Kept { key: string; url?: string; minutes?: number }

export function newKey(): { key: string; publicKey: string } {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  return { key: b64(secret), publicKey: b64(x25519.getPublicKey(secret)) };
}

export function isKey(text: string): boolean {
  return /^[A-Za-z0-9+/]{43}=$/.test(text);
}

export function keep(deviceId: string, value: Kept) {
  try {
    localStorage.setItem(slot(deviceId), JSON.stringify(value));
  } catch {
    /* private browsing: the page has already shown the key to copy */
  }
}

export function kept(deviceId: string): Kept | null {
  try {
    return JSON.parse(localStorage.getItem(slot(deviceId)) ?? "null");
  } catch {
    return null;
  }
}

export function forget(deviceId: string) {
  try {
    localStorage.removeItem(slot(deviceId));
  } catch {
    /* nothing was kept */
  }
}

/** The public half of a key, to tell which key something was sealed to. */
export function publicOf(key: string): string {
  return b64(x25519.getPublicKey(unb64(key)));
}

/**
 * A group leader's key for the summaries of the inspections they ask for (toomore/anoni-net-ws#483): one per leader,
 * not per device. The portal has the public half; the leader copies the private half to read the summaries elsewhere.
 */
export function keepLeaderKey(key: string) {
  try {
    localStorage.setItem(LEADER_SLOT, key);
  } catch {
    /* private browsing: the page has already shown the key to copy */
  }
}

export function leaderKey(): string | null {
  try {
    const key = localStorage.getItem(LEADER_SLOT);
    return key && isKey(key) ? key : null;
  } catch {
    return null;
  }
}

/** The report, or a rejected promise when this key does not open it. */
export function openReport<T>(sealed: Sealed, key: string): Promise<T> {
  return open<T>(sealed, key, INFO);
}

/** A leader's summary, or a rejected promise when this key does not open it. */
export function openSummary<T>(sealed: Sealed, key: string): Promise<T> {
  return open<T>(sealed, key, SUMMARY_INFO);
}

async function open<T>(sealed: Sealed, key: string, info: Uint8Array): Promise<T> {
  const shared = x25519.getSharedSecret(unb64(key), unb64(sealed.epk));
  const base = await crypto.subtle.importKey("raw", shared.slice(), "HKDF", false, ["deriveKey"]);
  const aes = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: info.slice() }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"],
  );
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(sealed.iv) }, aes, unb64(sealed.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}
