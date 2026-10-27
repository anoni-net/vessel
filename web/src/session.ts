import { useEffect, useState } from "preact/hooks";
import { api, forgetAccount } from "./api.ts";

// Whether this browser has a session. The cookie is HttpOnly, so the page asks /api/me once when it
// loads, and pages update the answer when they sign in, redeem, sign out or get "signed_out" back.
// null until the first answer: the header and home page show the signed-out links meanwhile.
type State = boolean | null;

let state: State = null;
const listeners = new Set<(s: State) => void>();

export function setSignedIn(value: boolean) {
  state = value;
  if (!value) forgetAccount();
  for (const f of listeners) f(value);
}

export function checkSession() {
  // only a real account answer counts; an HTML fallback or an error page means signed out
  api.me().then((me) => setSignedIn(typeof me?.created_on === "string"), () => setSignedIn(false));
}

export function useSignedIn(): State {
  const [value, setValue] = useState(state);
  useEffect(() => {
    listeners.add(setValue);
    setValue(state);
    return () => void listeners.delete(setValue);
  }, []);
  return value;
}
