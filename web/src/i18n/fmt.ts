// On its own, without the messages, so a module that only fills in words can be loaded by the tests in Node.

/** Fill {name} placeholders. */
export function fmt(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
