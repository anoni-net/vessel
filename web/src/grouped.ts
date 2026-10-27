// Invite codes and account numbers are typed in groups of four, like Mullvad's account field:
// the separator appears as you type, pasting works with or without separators, and the caret
// stays after the character it followed. The backend strips separators again before checking.

const SIZE = 4;
const LENGTH = 16;

export interface Grouping {
  clean: (raw: string) => string;
  sep: string;
}

// Crockford base32 as the backend reads it: I and L are 1, O is 0
export const INVITE: Grouping = {
  clean: (raw) => raw.toUpperCase().replace(/[IL]/g, "1").replace(/O/g, "0").replace(/[^0-9A-Z]/g, ""),
  sep: "-",
};

export const ACCOUNT: Grouping = { clean: (raw) => raw.replace(/\D/g, ""), sep: " " };

export const groupedLength = (g: Grouping) => LENGTH + (LENGTH / SIZE - 1) * g.sep.length;

export function group(raw: string, g: Grouping): string {
  return (g.clean(raw).slice(0, LENGTH).match(/.{1,4}/g) ?? []).join(g.sep);
}

/** Regroup the field in place and return its new value. */
export function regroup(input: HTMLInputElement, g: Grouping): string {
  const caret = input.selectionStart ?? input.value.length;
  const before = Math.min(g.clean(input.value.slice(0, caret)).length, LENGTH);
  const value = group(input.value, g);
  input.value = value;
  // after the 4th character the caret stays before the separator, after the 5th it moves past it
  const pos = before + Math.floor(Math.max(before - 1, 0) / SIZE) * g.sep.length;
  if (document.activeElement === input) input.setSelectionRange(pos, pos);
  return value;
}
