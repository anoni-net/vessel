import { useEffect, useState } from "preact/hooks";
import { api, forgetAccount } from "./api.ts";

// Whether this browser has a session. The cookie is HttpOnly, so the page asks /api/me once when it
// loads, and pages update the answer when they sign in, redeem, sign out or get "signed_out" back.
//   null      not known yet: the header and home page keep the space for their links but show nothing, so a
//             reload does not flash "sign in" at someone who is signed in
//   "likely"  this browser had a session last time (HINT); shown as signed in until /api/me answers
//   true      /api/me confirmed it; pages that move signed-in visitors elsewhere wait for this
//   false     signed out
export type SessionState = boolean | "likely" | null;

let state: SessionState = null;
const listeners = new Set<(s: SessionState) => void>();

// Only decides what the first render after a reload shows; /api/me still decides, and signing out or a
// "signed_out" answer clears it. Kept in this browser's storage, which can be missing or throw.
const HINT = "vessel-signed-in";

function readHint(): boolean {
  try {
    return localStorage.getItem(HINT) === "1";
  } catch {
    return false;
  }
}

function writeHint(value: boolean) {
  try {
    if (value) localStorage.setItem(HINT, "1");
    else localStorage.removeItem(HINT);
  } catch {
    // no storage: every reload waits for /api/me instead
  }
}

function set(value: SessionState) {
  state = value;
  for (const f of listeners) f(value);
}

export function setSignedIn(value: boolean) {
  writeHint(value);
  if (!value) forgetAccount();
  set(value);
}

/** Run once after the first render, before the browser paints it (useLayoutEffect). */
export function checkSession() {
  if (state === null && readHint()) set("likely");
  // only a real account answer counts; an HTML fallback or an error page means signed out
  api.me().then((me) => setSignedIn(typeof me?.created_on === "string"), () => setSignedIn(false));
}

/** Signed in as far as the header and home page can tell: confirmed, or likely from the last visit. */
export const looksSignedIn = (s: SessionState) => s === true || s === "likely";

export function useSignedIn(): SessionState {
  const [value, setValue] = useState(state);
  useEffect(() => {
    listeners.add(setValue);
    setValue(state);
    return () => void listeners.delete(setValue);
  }, []);
  return value;
}
