/**
 * Writes the open design before something replaces the page under it (a reload for a new version, src/serviceWorker.ts) or
 * closes the database under it (another tab upgraded it, src/databaseNotices.ts), and waits for the write or `timeoutMs`.
 * Only an open editor has anything unsaved, and its store is loaded already; the dashboard writes each change as it is made.
 */
export async function settleSaves(timeoutMs: number, leavingEditor = false): Promise<"saved" | "error" | "timeout"> {
  if (!leavingEditor && !window.location.hash.startsWith("#/design/")) return "saved";
  try {
    const { requestSave, waitForSaved } = await import("@/core/saveNow");
    requestSave();
    return await waitForSaved(timeoutMs);
  } catch {
    return "error";
  }
}
