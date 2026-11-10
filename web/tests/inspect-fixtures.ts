import { createCipheriv, hkdfSync, randomBytes } from "node:crypto";
import { x25519 } from "@noble/curves/ed25519.js";

/** The key the page keeps for a report, and which `seal` seals to. */
export const KEY = "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=";

/** The same sealing as inspect/analyze.py's `seal`, for reports made up in the tests. */
export function seal(report: object) {
  const secret = randomBytes(32);
  const shared = x25519.getSharedSecret(secret, x25519.getPublicKey(Buffer.from(KEY, "base64")));
  const key = Buffer.from(hkdfSync("sha256", shared, new Uint8Array(0), "vessel-inspection-report", 32));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(report)), cipher.final(), cipher.getAuthTag()]);
  return { epk: Buffer.from(x25519.getPublicKey(secret)).toString("base64"), iv: iv.toString("base64"), ct: ct.toString("base64") };
}

const site = (kind: string, severity: string, i: number) => ({ severity, kind, name: `s${i}.example`, how: "DNS", count: 500 - i, first: 1762128000 });

/** A report with every part filled in: both kinds of finding, every step of the hours, both marks, names left out. */
export const FULL_REPORT = {
  first: 1762128000, last: 1762300800,
  hours: Array.from({ length: 48 }, (_, i) => {
    const up = 10 ** (3 + (i % 7));
    const day = 9 + Math.floor(i / 24);
    return { hour: `2026-11-${String(day).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}`, up, down: up * 3, mark: i % 24 === 7 ? "x" : i % 24 === 13 ? "!" : null };
  }),
  coverage: { active_hours: 48, total_hours: 48 },
  dns: { total: 12000, nx_share: 0.12, ads_share: 0.3 }, idle_share: 0.4,
  checks: [{ id: "stalkerware", count: 7 }, { id: "malware", count: 0 }, { id: "cti", count: 500 }, { id: "bypass_dns", count: 9 }],
  findings: [site("stalkerware", "threat", 0), site("stalkerware", "threat", 1), ...Array.from({ length: 4 }, (_, i) => site("cti", "check", i + 2)),
    { severity: "check", kind: "bypass_dns", count: 9 }],
  more: { cti: 4 },
  nx_names: [{ name: "gone.example", count: 12 }],
};
