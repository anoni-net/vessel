export function normalizePath(path: string): string {
  return path.endsWith("/") ? path : path + "/";
}
