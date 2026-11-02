// Passkeys in the browser: turning the backend's WebAuthn options (JSON, binary fields in base64url) into what
// navigator.credentials takes, and the browser's answer back into JSON for the backend (toomore/anoni-net-ws#444).
// Newer browsers do both with PublicKeyCredential.parse*OptionsFromJSON() and credential.toJSON(); the fallbacks
// cover the ones that do not have them yet.

type Json = Record<string, unknown>;
type Descriptor = { id: string; type: string; transports?: string[] };

/** Whether this browser can use passkeys at all. Tor Browser and old browsers cannot; the number still works. */
export const passkeysSupported = () => typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";

function decode(s: string): ArrayBuffer {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out.buffer;
}

function encode(buf: ArrayBuffer | null | undefined): string | undefined {
  if (!buf) return undefined;
  let s = "";
  for (const byte of new Uint8Array(buf)) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const descriptors = (list?: Descriptor[]) => (list ?? []).map((c) => ({ ...c, id: decode(c.id) }));

type Parsers = {
  parseCreationOptionsFromJSON?: (o: Json) => PublicKeyCredentialCreationOptions;
  parseRequestOptionsFromJSON?: (o: Json) => PublicKeyCredentialRequestOptions;
};

function creationOptions(o: Json): PublicKeyCredentialCreationOptions {
  const parse = (window.PublicKeyCredential as unknown as Parsers).parseCreationOptionsFromJSON;
  if (parse) return parse(o);
  const user = o.user as { id: string; name: string; displayName: string };
  return {
    ...(o as unknown as PublicKeyCredentialCreationOptions),
    challenge: decode(o.challenge as string),
    user: { ...user, id: decode(user.id) },
    excludeCredentials: descriptors(o.excludeCredentials as Descriptor[]) as PublicKeyCredentialDescriptor[],
  };
}

function requestOptions(o: Json): PublicKeyCredentialRequestOptions {
  const parse = (window.PublicKeyCredential as unknown as Parsers).parseRequestOptionsFromJSON;
  if (parse) return parse(o);
  return {
    ...(o as unknown as PublicKeyCredentialRequestOptions),
    challenge: decode(o.challenge as string),
    allowCredentials: descriptors(o.allowCredentials as Descriptor[]) as PublicKeyCredentialDescriptor[],
  };
}

function toJson(c: PublicKeyCredential): Json {
  const own = (c as unknown as { toJSON?: () => Json }).toJSON;
  if (typeof own === "function") return own.call(c);
  const response: Json = { clientDataJSON: encode(c.response.clientDataJSON) };
  if ("attestationObject" in c.response) {
    const r = c.response as AuthenticatorAttestationResponse;
    response.attestationObject = encode(r.attestationObject);
    response.transports = typeof r.getTransports === "function" ? r.getTransports() : [];
  } else {
    const r = c.response as AuthenticatorAssertionResponse;
    response.authenticatorData = encode(r.authenticatorData);
    response.signature = encode(r.signature);
    response.userHandle = encode(r.userHandle);
  }
  return { id: c.id, rawId: encode(c.rawId), type: c.type, response, clientExtensionResults: c.getClientExtensionResults() };
}

/** Make a passkey from the backend's creation options; the answer goes back to the backend as JSON. */
export async function createPasskey(options: Json): Promise<Json> {
  const c = await navigator.credentials.create({ publicKey: creationOptions(options) });
  return toJson(c as PublicKeyCredential);
}

/** Sign the backend's challenge with a passkey the person picks (or one of `allowCredentials`). */
export async function usePasskey(options: Json): Promise<Json> {
  const c = await navigator.credentials.get({ publicKey: requestOptions(options) });
  return toJson(c as PublicKeyCredential);
}

/** An error code for what the browser threw: closing the prompt is not a failure worth alarming anyone about. */
export function passkeyErrorCode(x: unknown): string | null {
  const name = x instanceof DOMException || x instanceof Error ? x.name : "";
  if (name === "NotAllowedError" || name === "AbortError") return "passkey_cancelled";
  // the same password manager or key already holds a passkey for this account
  if (name === "InvalidStateError") return "passkey_in_use";
  if (name === "NotSupportedError" || name === "SecurityError") return "passkey_unsupported";
  return null;
}
