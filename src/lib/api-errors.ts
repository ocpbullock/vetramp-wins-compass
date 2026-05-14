// Map backend errors (HTTP status + message) into user-friendly toast strings.
// Use friendlyError() instead of toast.error(e.message) in the proposal pipeline.

export interface FriendlyErrorInput {
  status?: number;
  message?: string;
  code?: string;
}

export function friendlyError(input: FriendlyErrorInput | unknown): string {
  if (!navigator.onLine) {
    return "You're offline. Reconnect and try again.";
  }
  const i = (input || {}) as FriendlyErrorInput;
  const status = i.status;
  const msg = (i.message || "").toLowerCase();
  const code = (i.code || "").toLowerCase();

  if (code === "ai_unavailable" || /ai service is temporarily/i.test(i.message || "")) {
    return "AI service is temporarily unavailable. Your work is saved — try again in a few minutes.";
  }
  if (status === 429 || /rate.?limit/.test(msg)) {
    return "Rate limited — wait a moment and try again.";
  }
  if (status === 402 || /budget|credits/.test(msg)) {
    return "AI budget exceeded — check Settings.";
  }
  if (status === 413 || /too large|payload/.test(msg)) {
    return "Document too large — try smaller or fewer files.";
  }
  if (status === 504 || /timeout|timed out/.test(msg)) {
    return "Request timed out — try with fewer/smaller documents.";
  }
  if (status === 503) {
    return "Service temporarily unavailable — your work is saved. Try again shortly.";
  }
  if (status && status >= 500) {
    return "Something went wrong on our end. Your work is saved — try again.";
  }
  return i.message || "Something went wrong. Try again.";
}

/** Convert a thrown Error or fetch Response into the friendly string. */
export async function friendlyFromResponse(res: Response, fallbackMsg?: string): Promise<string> {
  let body: any = null;
  try { body = await res.clone().json(); } catch {}
  return friendlyError({
    status: res.status,
    message: body?.error || fallbackMsg || res.statusText,
    code: body?.code,
  });
}

export function friendlyFromError(e: unknown): string {
  if (e instanceof Error) return friendlyError({ message: e.message });
  return friendlyError(e);
}
