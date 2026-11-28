/**
 * What a server that stopped half-way through writing leaves in its data folder: files are written under a name of their own and
 * renamed into place (storage.ts, accounts/storage.ts), and a clip or sound being received is such a file until it has all come.
 * A process that is killed, or a machine that loses power, leaves that file there, and nothing ever looks at it again. Nothing is
 * at work when the server starts, so it removes them then.
 *
 * Only the names this server gives such files are touched: `<16 hex>.tmp` (a clip or sound being received) and
 * `<name>.<12 hex>.tmp` (a file being written whole). Links are not followed, and nothing else in the folder is looked at twice.
 */
import { lstat, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const LEFTOVER = /^(?:[0-9a-f]{16}|.+\.[0-9a-f]{12})\.tmp$/;
/** rooms, their pictures and clips, accounts, spaces and their media: never deeper than this */
const MAX_DEPTH = 6;

/** Removes what an earlier run of the server left half-written under `dir`, and says how many files and bytes that was. */
export async function removeLeftovers(dir: string): Promise<{ files: number; bytes: number }> {
  const found = { files: 0, bytes: 0 };
  async function visit(folder: string, depth: number): Promise<void> {
    let entries;
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH) await visit(path, depth + 1);
      } else if (entry.isFile() && LEFTOVER.test(entry.name)) {
        const { size } = await lstat(path);
        await rm(path, { force: true });
        found.files++;
        found.bytes += size;
      }
    }
  }
  await visit(dir, 0);
  return found;
}
