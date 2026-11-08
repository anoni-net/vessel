/**
 * Where keyboard and screen reader users go on when what they were on is gone: the page after a link, the next step
 * of a form, the list after a delete. Without this, focus falls back to the body and the next Tab starts wherever the
 * browser guesses (WCAG 2.4.3).
 */

const FOCUSABLE = "a[href], button, input, select, textarea, summary, [tabindex]";

/**
 * Focus an element that is not a control by itself; it gets tabindex=-1, so Tab still skips it. `scroll` brings it
 * into view; a page's heading does not need it, as the page has just scrolled to the top or to the link's target.
 */
export function focusOn(el: Element | null | undefined, scroll = false): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (!el.matches(FOCUSABLE)) el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: !scroll });
  return true;
}

/**
 * After the next render: what `find` returns. With `ifLost`, only when focus has fallen back to the body, so someone
 * who moved on while the server answered stays where they are.
 */
export function focusLater(find: () => Element | null, ifLost = false): void {
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (ifLost && active && active !== document.body) return;
    focusOn(find(), true);
  });
}

/**
 * After the next render: the element with `id` if there is one, else the page's h1. A page still loading has no h1
 * yet, so `main` holds focus meanwhile and hands it to the h1 once it shows up, unless the person has moved on.
 */
export function focusHeading(id?: string): void {
  requestAnimationFrame(() => {
    if (id && focusOn(document.getElementById(id))) return;
    if (focusOn(document.querySelector("main h1"))) return;
    const main = document.querySelector("main");
    if (!focusOn(main)) return;
    let frames = 60;
    const wait = () => {
      if (document.activeElement !== main) return;
      if (focusOn(document.querySelector("main h1"))) return;
      if (--frames > 0) requestAnimationFrame(wait);
    };
    requestAnimationFrame(wait);
  });
}
