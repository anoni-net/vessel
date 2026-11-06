// Saves a file made in this page: the device's config and the account number, which the server never has. Most
// browsers download it. Some cannot download from a page, Onion Browser on iOS among them, and show the file in
// place of the page instead; the config is shown only once, so it would be lost with the page. The link therefore
// opens in a new tab: where downloads work, the download attribute wins and no tab opens; elsewhere the file shows
// in a tab of its own and this page stays. The address is kept for a minute so that tab can still read it.
export function saveFile(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name, target: "_blank", rel: "noopener" });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
