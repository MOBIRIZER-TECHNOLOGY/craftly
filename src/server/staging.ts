/**
 * What is being received now: the clips and sounds that are on their way into the storage, by room or space. A clip is
 * weighed against the room's or space's limit before a byte of it is read, and it is put in place only once it has come
 * whole, so without this, fifty uploads of 100 MiB started at once into one room would each find the room empty, and fill the
 * disk with half-received files before any was weighed again. Each upload reserves its declared size here for as long as it
 * is on its way, and the room's or space's limit counts what is reserved; all uploads together may hold at most
 * `MAX_STAGING_MB` (docs/DEPLOY.md, section 2.3).
 */
export interface Staging {
  /** What is reserved for this room or space now, in bytes. */
  reserved(key: string): number;
  /**
   * Reserves `bytes` for an upload into `key`; false when the server holds as much as it may on its way already (the upload
   * is then refused, to be tried again later). Give it back with `release` whatever becomes of the upload.
   */
  reserve(key: string, bytes: number): boolean;
  release(key: string, bytes: number): void;
  /** All that is reserved, in bytes. */
  total(): number;
}

export function createStaging(limit: number): Staging {
  const byKey = new Map<string, number>();
  let total = 0;
  return {
    reserved: (key) => byKey.get(key) ?? 0,
    reserve(key, bytes) {
      if (total + bytes > limit) return false;
      total += bytes;
      byKey.set(key, (byKey.get(key) ?? 0) + bytes);
      return true;
    },
    release(key, bytes) {
      const left = (byKey.get(key) ?? 0) - bytes;
      if (left > 0) byKey.set(key, left);
      else byKey.delete(key);
      total = Math.max(0, total - bytes);
    },
    total: () => total,
  };
}
