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

/** The app names the tunnel after the file, so keep it short and ASCII. */
export function configFileName(region: string, deviceId: string): string {
  return `vessel-${region}-${deviceId.replace(/^d-/, "").slice(0, 6)}.conf`;
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
