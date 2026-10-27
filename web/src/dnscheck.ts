// The DNS filter check on /dns/. Each test address is a real anoni.net name (deploy/nginx/vessel-dns.anoni.net.conf);
// Vessel's resolvers answer some of them with "no such domain" (node/unbound/*.conf):
//   0  never hidden: tells a working network from a broken one
//   1  hidden by every Vessel resolver: this browser's queries reach Vessel
//   2  hidden by the malware and ad filters
//   3  hidden by the ad filter only
// Nothing about the result is sent anywhere; the DNS filter is a device setting the database keeps.

export const CHECK_URL = (n: number) => `https://vessel-dns-${n}.anoni.net/check`;

export type Verdict = "offline" | "notVessel" | "none" | "malware" | "ads" | "mixed";

const TIMEOUT_MS = 6000;

/** true if the address answered */
async function reachable(n: number): Promise<boolean> {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(CHECK_URL(n), {
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: stop.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function verdict(ok: [boolean, boolean, boolean, boolean]): Verdict {
  const [control, vessel, malware, ads] = ok;
  if (!control) return "offline";
  if (vessel) return malware && ads ? "notVessel" : "mixed";
  if (malware && ads) return "none";
  if (!malware && ads) return "malware";
  if (!malware && !ads) return "ads";
  return "mixed";
}

export async function runCheck(): Promise<Verdict> {
  if (!(await reachable(0))) return "offline";
  const [vessel, malware, ads] = await Promise.all([reachable(1), reachable(2), reachable(3)]);
  return verdict([true, vessel, malware, ads]);
}
