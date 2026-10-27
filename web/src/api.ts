/** Calls to the portal backend. Errors come back as short codes that the pages translate. */

export class ApiError extends Error {
  constructor(public code: string, public status: number) {
    super(code);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
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
}

export const api = {
  redeem: (code: string) => call<{ account_number: string }>("POST", "/redeem", { code }).then((r) => r.data),
  login: (accountNumber: string) => call("POST", "/login", { account_number: accountNumber }),
  logout: () => call("POST", "/logout"),
  me: () => call<Me>("GET", "/me").then((r) => r.data),
  devices: () => call<Device[]>("GET", "/devices").then((r) => r.data),
  deleteDevice: (id: string) => call("DELETE", `/devices/${encodeURIComponent(id)}`),
  deleteAccount: () => call("DELETE", "/account"),
};
