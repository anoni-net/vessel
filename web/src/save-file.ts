// Saving what only this page has: the device's config and the account number, which the server never sees.
//
// Browsers that do not count the onion site as a secure connection (Onion Browser on iOS, which is WebKit) can neither
// download a file from the page nor reach the clipboard: a download replaces the page with the file, and target="_blank"
// on the link is ignored. The pages check savesInPlace() and say so before the button is pressed (#147).

/** Whether this browser downloads a file and stays on the page; false where the page is not a secure context. */
export const savesInPlace = () => typeof window === "undefined" || window.isSecureContext;

export function saveFile(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  if (!savesInPlace()) {
    // a tab of its own if the browser allows it; otherwise the file replaces this page, as the notice said
    if (!window.open(url, "_blank")) location.assign(url);
    return;
  }
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
}
