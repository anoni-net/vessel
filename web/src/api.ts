/** Calls to the portal backend. Errors come back as short codes that the pages translate. */
import type { Reach, ReachHistory } from "./reach.ts";

export class ApiError extends Error {
  constructor(public code: string, public status: number) {
    super(code);
  }
}

/**
 * The last account and device list, kept in this tab's memory (never in storage) so a signed-in page can show
 * them at once while it asks again. Any change (signing in or out, redeeming, adding or deleting) drops them.
 */
export const last: { me?: Me; devices?: Device[]; passkeys?: Passkey[]; months?: UsageMonths; invites?: Invites } = {};

export function forgetAccount(): void {
  delete last.me;
  delete last.devices;
  delete last.passkeys;
  delete last.months;
  delete last.invites;
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
  /** null for a personal account; an older backend does not send it */
  group?: { role: "leader" | "member"; label: string; device_revoked_on: string | null; closing_on?: string | null } | null;
}

export type GroupIssue = "not_connected" | "suspended" | "new_config" | "blocked_many";

export interface GroupDevice {
  id: string;
  name: string;
  region: string;
  dns_filter: DnsFilter;
  status: DeviceStatus;
  expires_on: string;
  issues: GroupIssue[];
}

export interface GroupAccount {
  label: string;
  role: "leader" | "member";
  joined_on: string;
  devices: GroupDevice[];
}

export interface GroupInvite {
  id: number;
  label: string;
  created_at: string;
  expires_at: string;
  expired: boolean;
}

export interface Group {
  code: string;
  ends_on: string;
  /** the day the group and its accounts are deleted; null while it is not closing */
  closing_on: string | null;
  account_limit: number;
  device_limit: number;
  places_left: number;
  invite_days: number;
  accounts: GroupAccount[];
  invites: GroupInvite[];
}

export interface MadeGroupInvite {
  id: number;
  label: string;
  code: string;
  expires_at: string;
}

export type DnsFilter = "none" | "malware" | "ads";
export type DeviceStatus = "pending" | "active" | "suspended" | "revoking";

/** What OONI's public measurements say about the visitor's network, from /api/network */
export interface NetworkReport {
  asn: number | null;
  name: string | null;
  days: number;
  tests: { id: NetworkTest; level: "ok" | "some" | "most" | "few" | "unknown"; measurements: number; anomaly_pct: number; confirmed: number }[];
  /** "host:port" of the STUN server for the UDP check, Cloudflare's public one unless the backend names another; null when it is turned off */
  stun: string | null;
}
export type NetworkTest = "web_connectivity" | "signal" | "telegram" | "whatsapp" | "tor";

export interface BlocklistAnswer {
  /** the host name the backend read from what was typed */
  domain: string;
  /** Quad9 blocks it, which both filters forward to; null when Quad9 did not answer */
  quad9: boolean | null;
  /** on the malware list: blocked by both filters */
  malware: boolean;
  /** on the 165 list of scam sites Taiwan's ISPs stop resolving: blocked by both filters */
  tw165: boolean;
  /** on MODA's list of fake shops Taiwan's ISPs stop resolving: blocked by both filters */
  twmoda: boolean;
  /** on Echap's list of stalkerware domains: blocked by both filters */
  stalkerware: boolean;
  /** on DNSBunker's CTI list of active malicious domains: blocked by both filters */
  cti: boolean;
  /** on the ad list: blocked by the ads filter */
  ads: boolean;
}

export interface BlocklistSummary {
  lists: { id: "malware" | "tw165" | "twmoda" | "stalkerware" | "cti" | "ads"; domains: number; only_here: number }[];
  /** the names the malware filter blocks, all its lists together */
  malware_filter: number;
  ads_filter: number;
  /** the names on the two HaGeZi lists together */
  hagezi: number;
  as_of: string;
}

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
  /** lookups a blocklist stopped this month: the malware list, and the ad list too for the ads filter */
  blocked: number;
  /** whether the device has ever completed a handshake with its node */
  connected: boolean;
  /** made before its region moved to a new host: the config stops working after this day (or already has) */
  moved_until: string | null;
  /** the config has the private IPv6 address (anoni-net/vessel#122); without it, iOS sends IPv6 around the tunnel */
  ipv6: boolean;
  /** the relay route it connects through, or null for a direct connection (missing from an older backend) */
  relay?: string | null;
  /** the device inspection, if there is one (missing from an older backend) */
  inspection?: "confirming" | "active" | "ending" | "ended" | null;
}

export interface Inspection {
  status: "none" | "confirming" | "active" | "ending" | "ended";
  consent_version: string;
  days: number;
  report_days: number;
  started_at?: string | null;
  ends_at?: string | null;
  /** ciphertext, for the key this browser made */
  report?: { epk: string; iv: string; ct: string } | null;
  report_until?: string | null;
  /** while it waits for the device: how long the confirmation link is still good for */
  confirm_seconds?: number;
}

/** The node's answer: every config field except the private key and the preshared key. */
export interface NodeConfig {
  interface: Record<string, string>;
  peer: Record<string, string>;
}

export interface Region {
  id: string;
  open: boolean;
  /** the node has no address left; an older backend does not send it */
  full?: boolean;
}

/** A relay route (anoni-net/vessel#136): an entry that forwards to `region`'s node, which stays the exit. */
export interface Relay {
  id: string;
  region: string;
  open: boolean;
}

export type NodeState = "ok" | "down" | "unknown";
export type NoticeKind = "restart" | "maintenance" | "outage";

export interface Status {
  regions: { id: string; state: NodeState }[];
  /** newest first, the last 30 days; region null means every city, ends_at null means still going on */
  notices: { region: string | null; kind: NoticeKind; starts_at: string; ends_at: string | null }[];
  /** which common sites each city's node can open, checked by the node every hour; cities without a recent check are
   *  left out (see reach.ts) */
  reach?: Reach[];
  /** the last day of each site that some node had trouble with, an hour to a slot (see reach.ts) */
  reach_history?: ReachHistory;
}

export interface Passkey {
  id: number;
  /** the name the person gave it, or "" */
  label: string;
  created_on: string;
}

export interface UsageMonth {
  /** the first day of the month */
  month: string;
  used_bytes: number;
  /** lookups the scam and malware list blocked */
  blocked: number;
  /** lookups the ads and trackers list blocked */
  blocked_ads: number;
}

export interface UsageMonths {
  /** the strongest DNS filter on the account's devices now */
  filter: DnsFilter;
  /** since the account was made, the last twelve months, newest first */
  months: UsageMonth[];
}

/** Why the account cannot make an invite now, the first that applies (api/app/invites.py), or null if it can. */
export type InviteBlock = "off" | "full" | "too_new" | "not_connected" | "none_left" | null;

export interface Invites {
  /** how many an account may make in all; 0 when the service has them off */
  per_account: number;
  /** how many of this account's were used */
  used: number;
  left: number;
  reason: InviteBlock;
  /** the day the account may start inviting */
  eligible_on: string;
  /** how long an invite works */
  days: number;
  /** the unused ones, oldest first; the codes themselves were shown once, when made */
  open: { id: number; created_at: string; expires_at: string }[];
}

type WebAuthnJson = Record<string, unknown>;

export interface NewDevice {
  name: string;
  region: string;
  dns_filter: DnsFilter;
  public_key: string;
  preshared_key: string;
  /** a relay route of `region`; the backend puts the relay's address into the config */
  relay?: string;
}

export const api = {
  redeem: (code: string) => call<{ account_number: string; group_role?: string | null }>("POST", "/redeem", { code }).then((r) => r.data),
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
  inspection: (id: string) => call<Inspection>("GET", `/devices/${encodeURIComponent(id)}/inspection`).then((r) => r.data),
  startInspection: (id: string, body: { consent_version: string; public_key: string }) =>
    call<{ code: string; url: string; minutes: number }>("POST", `/devices/${encodeURIComponent(id)}/inspection`, body).then((r) => r.data),
  stopInspection: (id: string) => call("DELETE", `/devices/${encodeURIComponent(id)}/inspection`),
  renewInspection: (id: string) =>
    call<{ code: string; url: string; minutes: number }>("POST", `/devices/${encodeURIComponent(id)}/inspection/code`).then((r) => r.data),
  deleteAccount: () => call("DELETE", "/account"),
  usageMonths: () =>
    call<UsageMonths>("GET", "/usage/months").then((r) => {
      if (Array.isArray(r.data?.months)) last.months = r.data;
      return r.data;
    }),
  passkeys: () =>
    call<Passkey[]>("GET", "/passkeys").then((r) => {
      if (Array.isArray(r.data)) last.passkeys = r.data;
      return r.data;
    }),
  passkeyOptions: () => call<WebAuthnJson>("POST", "/passkeys/options").then((r) => r.data),
  addPasskey: (credential: WebAuthnJson, label: string) =>
    call<Passkey[]>("POST", "/passkeys", { credential, label }).then((r) => r.data),
  deletePasskey: (id: number) => call<Passkey[]>("DELETE", `/passkeys/${id}`).then((r) => r.data),
  /** sign-in with a passkey: needs no session and no account number */
  passkeyLoginOptions: () => call<WebAuthnJson>("POST", "/passkeys/login/options").then((r) => r.data),
  passkeyLogin: (credential: WebAuthnJson) => call("POST", "/passkeys/login", { credential }),
  /** a new account number, confirmed with one of the account's passkeys; shown once */
  rotateOptions: () => call<WebAuthnJson>("POST", "/account/number/options").then((r) => r.data),
  rotateNumber: (credential: WebAuthnJson) =>
    call<{ account_number: string }>("POST", "/account/number", { credential }).then((r) => r.data),
  /** confirming it is the person, before a step that needs a recent sign-in (pages/reverify.tsx) */
  verifyOptions: () => call<WebAuthnJson>("POST", "/account/verify/options").then((r) => r.data),
  verify: (proof: { account_number: string } | { credential: WebAuthnJson }) => call("POST", "/account/verify", proof),
  invites: () =>
    call<Invites>("GET", "/invites").then((r) => {
      if (Array.isArray(r.data?.open)) last.invites = r.data;
      return r.data;
    }),
  /** a new invite; its code comes back this once */
  makeInvite: () => call<{ code: string; id: number; created_at: string; expires_at: string }>("POST", "/invites").then((r) => r.data),
  withdrawInvite: (id: number) => call<Invites>("DELETE", `/invites/${id}`).then((r) => r.data),
  group: () => call<Group>("GET", "/group").then((r) => r.data),
  /** what the leaders see about this account */
  myGroupView: () => call<GroupAccount>("GET", "/group/mine").then((r) => r.data),
  /** one invite per alias; the codes come back this once */
  makeGroupInvites: (labels: string[]) =>
    call<{ invites: MadeGroupInvite[]; days: number }>("POST", "/group/invites", { labels }).then((r) => r.data),
  withdrawGroupInvite: (id: number) => call("DELETE", `/group/invites/${id}`),
  revokeGroupDevice: (id: string) => call("DELETE", `/group/devices/${id}`),
  /** deletes the member's account; needs a recent sign-in (pages/reverify.tsx) */
  removeGroupMember: (label: string) => call("POST", "/group/members/remove", { label }),
  regions: () => call<Region[]>("GET", "/regions").then((r) => r.data),
  /** the open relay routes, without their addresses */
  relays: () => call<Relay[]>("GET", "/relays").then((r) => r.data),
  /** whether this request came through a Vessel node; needs no session */
  exit: () => call<{ region: string | null; ipv6: boolean; previous?: boolean }>("GET", "/exit").then((r) => r.data),
  /** the visitor's network and OONI's measurements of it; needs no session */
  network: () => call<NetworkReport>("GET", "/network").then((r) => r.data),
  /** which DNS filters block a site; needs no session, and the domain is not kept */
  blocklist: (domain: string) =>
    call<BlocklistAnswer>("POST", "/blocklist", { domain }).then((r) => r.data),
  /** public, no session */
  status: () => call<Status>("GET", "/status").then((r) => r.data),
  blocklistSummary: () => call<BlocklistSummary>("GET", "/blocklist/lists").then((r) => r.data),
  createDevice: (body: NewDevice) =>
    call<{ id: string; status: "active" | "pending"; config?: NodeConfig }>("POST", "/devices", body).then((r) => r.data),
  /** 200 with the config, or 202 while the node is still adding the device */
  deviceConfig: (id: string) =>
    call<{ status: "active" | "pending"; config?: NodeConfig }>("GET", `/devices/${encodeURIComponent(id)}/config`).then((r) => r.data),
};
