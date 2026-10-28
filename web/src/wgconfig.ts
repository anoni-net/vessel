import qrcode from "qrcode-generator";
import type { NodeConfig } from "./api.ts";

/** Put the browser's private key and preshared key into the node's answer. */
export function buildConfig(node: NodeConfig, privateKey: string, presharedKey: string): string {
  const lines = ["[Interface]", `PrivateKey = ${privateKey}`];
  for (const [k, v] of Object.entries(node.interface)) lines.push(`${k} = ${v}`);
  lines.push("", "[Peer]");
  for (const [k, v] of Object.entries(node.peer)) lines.push(`${k} = ${v}`);
  lines.push(`PresharedKey = ${presharedKey}`, "");
  return lines.join("\n");
}

// The app names the tunnel after the file. On Android the name must match [a-zA-Z0-9_=+.-]{1,15}, the Linux
// limit for interface names, or the import fails with "invalid name"; iOS has no such limit.
const TUNNEL_NAME_MAX = 15;

export function configFileName(region: string, deviceId: string): string {
  const base = `vessel-${region.replace(/[^a-zA-Z0-9_=+.-]/g, "")}-`;
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
