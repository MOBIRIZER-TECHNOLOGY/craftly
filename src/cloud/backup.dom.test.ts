/**
 * A backup is of the library, not of the device's account (docs/ACCOUNTS.md, docs/BACKUP.md): the session (`meta` key
 * `cloudSession`, the token that lets anybody holding it in), the sync state (the `sync` store) and the cursors of the changes
 * feed (`cloudCursors`) stay out of it. A design of a space is in it as a design, and comes back on this device only.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createDesign } from "@/core/factory";
import { listDesigns, saveDesign, setNewRecordSpace } from "@/core/library";
import { dbPut, metaSet } from "@/core/persistence";
import { createBackup, restoreBackup } from "@/export/backup";
import { openZip } from "@/export/zipRead";
import { wipeDatabase } from "@/test/logicDb";
import type { SyncRecord } from "@/core/types";

const TOKEN = "T".repeat(43);

beforeEach(async () => {
  await wipeDatabase();
});

describe("a backup and the account of this device", () => {
  it("leaves out the session, the sync records and the cursors", async () => {
    const design = createDesign({ title: "Synced poster", width: 100, height: 100 });
    await saveDesign(design);
    const sync: SyncRecord = { id: design.id, space: "space_of_ann_000001", serverRev: 4, syncedRevision: "r", syncedMeta: null };
    await dbPut("sync", sync);
    await metaSet("cloudSession", { server: "https://accounts.example.org", token: TOKEN, user: { id: "space_of_ann_000001", email: "ann@example.org", name: "Ann" } });
    await metaSet("cloudCursors", { space_of_ann_000001: 12 });

    const { blob } = await createBackup();
    const archive = await openZip(blob);
    const texts = await Promise.all(archive.entries.filter((entry) => entry.name.endsWith(".json")).map((entry) => archive.text(entry)));
    const all = texts.join("\n");
    expect(all).toContain("Synced poster");
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain("cloudSession");
    expect(all).not.toContain("cloudCursors");
    expect(all).not.toContain("serverRev");
    expect(all).not.toContain("space_of_ann_000001");
  });

  it("brings a design of a space back as a design of this device only", async () => {
    const design = createDesign({ title: "Team flyer", width: 100, height: 100 });
    setNewRecordSpace("space_of_a_team_0001");
    try {
      await saveDesign(design);
    } finally {
      setNewRecordSpace(null);
    }
    expect((await listDesigns())[0].space).toBe("space_of_a_team_0001");
    const { blob } = await createBackup();
    await wipeDatabase();
    await restoreBackup(blob);
    const [restored] = await listDesigns();
    expect(restored.title).toBe("Team flyer");
    expect(restored).not.toHaveProperty("space");
  });
});
