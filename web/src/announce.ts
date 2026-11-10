/**
 * Says something to screen readers without moving focus: a copy that worked, a deleted device, the result of a check
 * (WCAG 4.1.3). One polite live region for the whole site, in index.html outside the app, so it is in the page before
 * anything is said in it and stays through a change of page; a region added together with its words is often not read.
 */
export function announce(text: string): void {
  const region = document.getElementById("announce");
  if (!region) return;
  region.textContent = "";
  // a moment later, so the same words twice in a row are read again
  setTimeout(() => { region.textContent = text; }, 100);
}
