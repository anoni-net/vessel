import { useEffect, useState } from "preact/hooks";

/** Client-side navigation: every page is index.html, the path picks the page. */
export function navigate(to: string, replace = false): void {
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
  const id = to.includes("#") ? to.slice(to.indexOf("#") + 1) : "";
  // wait for the new page to render before looking for the anchor
  if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
  else window.scrollTo(0, 0);
}

export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const update = () => setPath(location.pathname);
    window.addEventListener("popstate", update);
    // follow same-origin links without a full reload
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element).closest("a");
      if (!a || a.target || a.hasAttribute("download") || a.origin !== location.origin) return;
      if (a.pathname === location.pathname && a.hash) return;
      e.preventDefault();
      navigate(a.pathname + a.search + a.hash);
    };
    document.addEventListener("click", click);
    return () => {
      window.removeEventListener("popstate", update);
      document.removeEventListener("click", click);
    };
  }, []);
  return path;
}
