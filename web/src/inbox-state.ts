/**
 * What the inbox has that is new, for the count beside its link. Announcements read are kept by the server, a number
 * and no time (app/inbox.py). Notes are worked out from the account's state each time, and which of them were seen is
 * kept here, in this browser only: the keys name devices and dates, so signing out clears them (session.ts), like the
 * report keys, and the next person at a shared computer does not learn that a device was inspected.
 */
import { useEffect, useState } from "preact/hooks";
import { type Me, last, meListeners } from "./api.ts";

const SEEN = "vessel-inbox-seen";

/** The keys of the notes this browser has shown. */
export function seenNotes(): Set<string> {
  try {
    const kept = JSON.parse(localStorage.getItem(SEEN) ?? "[]");
    return new Set(Array.isArray(kept) ? kept.filter((k) => typeof k === "string") : []);
  } catch {
    return new Set();
  }
}

/** The notes the inbox shows now are seen; keys of notes that have gone are dropped with them. */
export function markSeen(keys: string[]): void {
  try {
    if (keys.length) localStorage.setItem(SEEN, JSON.stringify(keys));
    else localStorage.removeItem(SEEN);
  } catch {
    // no storage: the notes count as new on every visit
  }
}

export function forgetSeen(): void {
  try {
    localStorage.removeItem(SEEN);
  } catch {
    // nothing kept
  }
}

export function newCount(me: Me | undefined): { messages: number; notes: number } {
  if (!me?.inbox) return { messages: 0, notes: 0 };
  const known = seenNotes();
  return { messages: me.inbox.unread, notes: me.inbox.notes.filter((k) => !known.has(k)).length };
}

/** The count, from the last answer of /api/me, kept up to date as pages ask it again. */
export function useInboxCount(): { messages: number; notes: number } {
  const [count, setCount] = useState(() => newCount(last.me));
  useEffect(() => {
    const update = () => setCount(newCount(last.me));
    meListeners.add(update);
    update();
    return () => void meListeners.delete(update);
  }, []);
  return count;
}
