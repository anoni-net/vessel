import qrcode from "qrcode-generator";
import type { NodeConfig } from "./api.ts";

// The fields a node may put in a config, the same lists as api/app/clientconfig.py, which checks the node's answer
// first. Anything else (PostUp runs as root on Linux, a second PrivateKey would replace the browser's) is refused.
export const INTERFACE_FIELDS = new Set([
  "Address", "DNS", "MTU",
  "Jc", "Jmin", "Jmax", "S1", "S2", "S3", "S4", "H1", "H2", "H3", "H4", "I1", "I2", "I3", "I4", "I5",
  "HeaderProtectionKey", "RekeyAfterTime", "RekeyTimeout", "RejectAfterTime", "KeepaliveTimeout",
  "MaxHandshakeAttempts", "RandomTrailers", "DisableCookies",
]);
export const PEER_FIELDS = new Set(["PublicKey", "AllowedIPs", "Endpoint", "PersistentKeepalive"]);

function fields(section: Record<string, string>, allowed: Set<string>): string[] {
  return Object.entries(section).map(([k, v]) => {
    if (!allowed.has(k) || typeof v !== "string" || /[\r\n\0]/.test(v)) throw new Error("config_invalid");
    return `${k} = ${v}`;
  });
}

/** Put the browser's private key and preshared key into the node's answer. */
export function buildConfig(node: NodeConfig, privateKey: string, presharedKey: string): string {
  return [
    "[Interface]", `PrivateKey = ${privateKey}`, ...fields(node.interface, INTERFACE_FIELDS),
    "", "[Peer]", ...fields(node.peer, PEER_FIELDS), `PresharedKey = ${presharedKey}`, "",
  ].join("\n");
}

// The app names the tunnel after the file. On Android the name must match [a-zA-Z0-9_=+.-]{1,15}, the Linux
// limit for interface names, or the import fails with "invalid name"; iOS has no such limit.
const TUNNEL_NAME_MAX = 15;

/** A relay route's device is named after the route (vessel-twsg-…), so it stands apart from a direct one. */
export function configFileName(region: string, deviceId: string, relay?: string): string {
  const base = `vessel-${(relay ? relay.replace(/[^a-zA-Z0-9]/g, "") : region.replace(/[^a-zA-Z0-9_=+.-]/g, ""))}-`;
  const id = deviceId.replace(/^d-/, "");
  return `${(base + id).slice(0, TUNNEL_NAME_MAX)}.conf`;
}

export function qrSvg(text: string): string {
  const qr = qrcode(0, "L");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
}

export type Platform = "android" | "apple" | "windows";

export function detectPlatform(ua = navigator.userAgent): Platform {
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod|macintosh|mac os x/i.test(ua)) return "apple";
  return /windows/i.test(ua) ? "windows" : "android";
}
