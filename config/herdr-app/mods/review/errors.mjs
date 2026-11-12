// Errors with no UI or herdr dependencies. Host calls can reject with null or a string; a bare `throw null` reaches
// Herdr as `Null"null"` and stops a hot reload, so whatever is thrown on goes through asError first.

/** Any thrown value as an Error that says where it came from. An Error stays as it is. */
export function asError(value, where = "review") {
  if (value instanceof Error) return value;
  if (value && typeof value === "object" && typeof value.message === "string") {
    const e = new Error(value.message);
    if (value.stack) e.stack = String(value.stack);
    return e;
  }
  return new Error(`${where}: ${value === null || value === undefined ? "a host call failed without a reason" : String(value)}`);
}

/** A host call that may reject with anything: its value, or `fallback` when it fails. */
export async function attempt(promise, fallback = null) {
  try { return await promise; } catch { return fallback; }
}
