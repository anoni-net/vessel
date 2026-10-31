import type { DnsFilter } from "../api.ts";

/** The DNS filters from no filtering up, each one adding a layer of protection to the one before. */
export const FILTERS: DnsFilter[] = ["none", "malware", "ads"];

/** One more filled bar per layer, so the filter's strength reads at a glance next to its name. */
export function Layers({ filter, small = false }: { filter: DnsFilter; small?: boolean }) {
  const level = FILTERS.indexOf(filter);
  return (
    <span class={`layers${small ? " layers--small" : ""}`} aria-hidden="true">
      {FILTERS.map((_, i) => <span class={i <= level ? "layers__on" : ""} />)}
    </span>
  );
}
