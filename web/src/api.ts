/** Calls to the portal backend. Errors come back as short codes that the pages translate. */

export class ApiError extends Error {
  constructor(public code: string, public status: number) {
    super(code);
  }
}

/**
 * The last account and device list, kept in this tab's memory (never in storage) so a signed-in page can show
 * them at once while it asks again. Any change (signing in or out, redeeming, adding or deleting) drops them.
 */
export const last: { me?: Me; devices?: Device[] } = {};

export function forgetAccount(): void {
  delete last.me;
  delete last.devices;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  if (method !== "GET") forgetAccount();
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      // other anoni.net subdomains count as the same site; this header is what the backend checks instead
      headers: { "X-Vessel-Request": "1", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("network", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(typeof data?.error === "string" ? data.error : "unknown", res.status);
  return { status: res.status, data: data as T };
}

export interface Me {
  created_on: string;
  last_login_on: string | null;
  device_limit: number;
  monthly_quota_bytes: number;
  used_bytes: number;
  /** when the worker last read the nodes this account's devices are on; null before the first read */
  usage_as_of: string | null;
}

export type DnsFilter = "none" | "malware" | "ads";
export type DeviceStatus = "pending" | "active" | "suspended" | "revoking";

export interface Device {
  id: string;
  name: string;
  region: string;
  dns_filter: DnsFilter;
  status: DeviceStatus;
  created_on: string;
  expires_on: string;
  /** this month, on this device */
  used_bytes: number;
  /** lookups the malware list blocked this month; only counted for devices with a DNS filter */
  blocked: number;
  /** whether the device has ever completed a handshake with its node */
  connected: boolean;
}

/** The node's answer: every config field except the private key and the preshared key. */
export interface NodeConfig {
  interface: Record<string, string>;
  peer: Record<string, string>;
}

export interface Region {
  id: string;
  open: boolean;
}

export type NodeState = "ok" | "down" | "unknown";
export type NoticeKind = "restart" | "maintenance" | "outage";

export interface Status {
  regions: { id: string; state: NodeState }[];
  /** newest first, the last 30 days; region null means every city, ends_at null means still going on */
  notices: { region: string | null; kind: NoticeKind; starts_at: string; ends_at: string | null }[];
}

export interface NewDevice {
  name: string;
  region: string;
  dns_filter: DnsFilter;
  public_key: string;
  preshared_key: string;
}

export const api = {
  redeem: (code: string) => call<{ account_number: string }>("POST", "/redeem", { code }).then((r) => r.data),
  login: (accountNumber: string) => call("POST", "/login", { account_number: accountNumber }),
  logout: () => call("POST", "/logout"),
  me: () =>
    call<Me>("GET", "/me").then((r) => {
      // an HTML fallback parses as {}; keep only a real answer
      if (typeof r.data?.created_on === "string") last.me = r.data;
      return r.data;
    }),
  devices: () =>
    call<Device[]>("GET", "/devices").then((r) => {
      if (Array.isArray(r.data)) last.devices = r.data;
      return r.data;
    }),
  deleteDevice: (id: string) => call("DELETE", `/devices/${encodeURIComponent(id)}`),
  deleteAccount: () => call("DELETE", "/account"),
  regions: () => call<Region[]>("GET", "/regions").then((r) => r.data),
  /** whether this request came through a Vessel node; needs no session */
  exit: () => call<{ region: string | null; ipv6: boolean }>("GET", "/exit").then((r) => r.data),
  /** public, no session */
  status: () => call<Status>("GET", "/status").then((r) => r.data),
  createDevice: (body: NewDevice) =>
    call<{ id: string; status: "active" | "pending"; config?: NodeConfig }>("POST", "/devices", body).then((r) => r.data),
  /** 200 with the config, or 202 while the node is still adding the device */
  deviceConfig: (id: string) =>
    call<{ status: "active" | "pending"; config?: NodeConfig }>("GET", `/devices/${encodeURIComponent(id)}/config`).then((r) => r.data),
};
