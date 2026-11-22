// Shared error extraction helpers for stores and scenes.

/** Returns a readable message string from any thrown value. */
export function errorMessageOf(error: unknown, fallback = ""): string {
  if (error instanceof Error) return error.message || String(error);
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === "string") return msg;
  }
  if (error === undefined || error === null) return fallback;
  try {
    return String(error);
  } catch {
    return fallback;
  }
}
