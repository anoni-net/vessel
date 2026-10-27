// Key generation and the QR code are only needed on the new-device page, so they load with it. The devices
// page asks for it ahead of time, and once loaded it stays here, so going to the page shows it at once.

type Page = () => preact.JSX.Element;

let newDevice: Page | null = null;
let pending: Promise<Page> | null = null;

export const loadedNewDevice = (): Page | null => newDevice;

export function loadNewDevice(): Promise<Page> {
  pending ??= import("./new-device.tsx").then(
    (m) => (newDevice = m.NewDevice),
    (x) => {
      pending = null; // try again next time
      throw x;
    },
  );
  return pending;
}

/** Run `f` when the browser has nothing else to do. */
export function whenIdle(f: () => void): void {
  if ("requestIdleCallback" in window) requestIdleCallback(() => f(), { timeout: 2000 });
  else setTimeout(f, 300);
}
