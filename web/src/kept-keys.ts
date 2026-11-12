// Where this browser keeps the keys of inspection reports (inspection-key.ts), and clearing them. Apart from the
// keys' own code, so the pages that only clear them (signing out, deleting a device) do not load the cryptography.

export const slot = (deviceId: string) => `vessel-inspection:${deviceId}`;
export const LEADER_SLOT = "vessel-leader-key";
const PREFIX = slot("");

function reportSlots(): string[] {
  try {
    return Object.keys(localStorage).filter((name) => name.startsWith(PREFIX));
  } catch {
    return [];
  }
}

/** What this browser holds: report keys, a leader's key. Signing out says so before it clears them. */
export function keysHeld(): { reports: boolean; leader: boolean } {
  let leader = false;
  try {
    leader = localStorage.getItem(LEADER_SLOT) !== null;
  } catch {
    /* no storage, nothing held */
  }
  return { reports: reportSlots().length > 0, leader };
}

/**
 * Signing out or deleting the account leaves no key behind: whoever uses this browser next would otherwise see
 * that a device was inspected, and hold the key to its report. A session that runs out on its own keeps them,
 * the person signs in again and reads the report.
 */
export function forgetAllKeys() {
  try {
    for (const name of reportSlots()) localStorage.removeItem(name);
    localStorage.removeItem(LEADER_SLOT);
  } catch {
    /* nothing was kept */
  }
}

/** Drop the report keys of devices the account no longer has: their reports went with them. */
export function forgetOtherDevices(deviceIds: readonly string[]) {
  const mine = new Set(deviceIds.map(slot));
  try {
    for (const name of reportSlots()) if (!mine.has(name)) localStorage.removeItem(name);
  } catch {
    /* nothing was kept */
  }
}

export function forget(deviceId: string) {
  try {
    localStorage.removeItem(slot(deviceId));
  } catch {
    /* nothing was kept */
  }
}
