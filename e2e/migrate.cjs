/*
 * Designs and a library that another version of Craftly stored, as a person meets them (docs/MIGRATIONS.md). Records are
 * written straight into the browser's IndexedDB, the way an older or a newer release would have left them: the frozen
 * designs of src/test/fixtures/schema (the format of release 1) and one that says it was saved by a version far ahead.
 *
 *   an old design opens whole, and opening it writes nothing
 *   a design from a newer release is refused with a screen that says so, and is left exactly as it was
 *   starring it still works (a library action patches its own fields), copying it is refused, and a backup holds it as stored
 *   another tab upgrades the database while an edit is waiting to be saved: the edit is written, this tab says so and lets
 *   go; after a reload the older code refuses to touch a library that a newer release upgraded
 */
const fs = require("node:fs");
const zlib = require("node:zlib");
const { launch, outDir, BASE } = require("./lib.cjs");

const OUT = outDir("migrate");
const results = [];
const logs = [];
let shotN = 0;

const minimal = require("../src/test/fixtures/schema/design-v1-minimal.json");
const full = require("../src/test/fixtures/schema/design-v1-full.json");
const BACKUP_PATH = OUT + "backup.zip";
const FUTURE_VERSION = 99;
const REPLACED = "Craftly was updated in another tab. Reload this tab to keep working.";

/** The same document with every object's keys in one order, so two copies compare equal whatever order they were written in. */
const canon = (value) => {
  const sort = (v) =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, sort(v[k])]),
          )
        : v;
  return JSON.stringify(sort(value));
};

/** The dashboard record of a design, as a release before `schema` was kept wrote it. */
const summaryOf = (design, extra = {}) => ({
  id: design.id,
  title: design.title,
  typeId: design.typeId,
  width: design.width,
  height: design.height,
  pageCount: design.pages.length,
  createdAt: design.createdAt,
  updatedAt: design.updatedAt,
  folderId: null,
  starred: false,
  trashedAt: null,
  ...extra,
});

const future = {
  ...minimal,
  id: "d_future",
  title: "From the future",
  version: FUTURE_VERSION,
  somethingNew: { nested: [1, 2, 3], text: "a field this release has never heard of" },
};

/** The file list of a ZIP read straight from its central directory, independent of the app that wrote it. */
function readZip(file) {
  const buf = fs.readFileSync(file);
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("not a ZIP: there is no end record");
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const nameLength = buf.readUInt16LE(at + 28);
    const local = buf.readUInt32LE(at + 42);
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(dataAt, dataAt + size);
    entries.push({ name: buf.toString("utf8", at + 46, at + 46 + nameLength), text: () => (method === 0 ? data : zlib.inflateRawSync(data)).toString("utf8") });
    at += 46 + nameLength + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return entries;
}

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  // what is expected to be reported while a library is being refused is not an error of the app (see the step that says so)
  let expectRefusals = false;
  const watch = (target, label) => {
    target.on("console", (m) => {
      if (m.type() !== "error") return;
      const text = m.text();
      if (expectRefusals && /MigrationError|newer version of Craftly|VersionError|Could not open|Failed to load resource/i.test(text)) return;
      logs.push(label + " console.error: " + text.slice(0, 240));
    });
    target.on("pageerror", (e) => logs.push(label + " PAGEERROR " + e.message.slice(0, 240)));
  };
  watch(page, "tab 1");

  const shot = (target, name) => target.screenshot({ path: OUT + String(++shotN).padStart(2, "0") + "-" + name + ".png" });
  const step = async (name, fn) => {
    try {
      const r = await fn();
      results.push("PASS " + name + (r ? "  " + r : ""));
    } catch (e) {
      results.push("FAIL " + name + "  -> " + String(e.message).split("\n")[0].slice(0, 260));
    }
  };
  const wait = (target, ms) => target.waitForTimeout(ms);
  /** Polls with page.evaluate: waitForFunction does not wait for the promise of an async predicate. */
  const until = async (target, check, arg, what, timeoutMs = 20000) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (await target.evaluate(check, arg)) return;
      await target.waitForTimeout(150);
    }
    throw new Error("timed out waiting for " + what);
  };

  /* ---- what is in the browser's database, read and written without the app's own code ---- */
  const readFrom = (target, store, id) =>
    target.evaluate(
      ([store, id]) =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open("craftly");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const request = db.transaction(store).objectStore(store).get(id);
            request.onsuccess = () => {
              db.close();
              resolve(request.result ?? null);
            };
            request.onerror = () => reject(request.error);
          };
        }),
      [store, id],
    );
  const seed = (target, records) =>
    target.evaluate(
      (records) =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open("craftly");
          open.onupgradeneeded = () => {
            open.transaction.abort(); // there is no library yet: the app has not been opened in this browser
          };
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction([...new Set(records.map((r) => r[0]))], "readwrite");
            for (const [store, value] of records) tx.objectStore(store).put(value);
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
      records,
    );
  const databaseInfo = (target) =>
    target.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open("craftly");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const info = { version: db.version, stores: Array.from(db.objectStoreNames).sort() };
            db.close();
            resolve(info);
          };
        }),
    );

  const home = async (target) => {
    await target.goto(BASE + "/#/", { waitUntil: "load" });
    await target.getByText("What will you design today?").waitFor({ timeout: 20000 });
    await until(target, async () => (await indexedDB.databases()).some((d) => d.name === "craftly"), undefined, "the library to exist");
  };
  const go = async (target, hash) => {
    await target.evaluate((h) => {
      location.hash = h;
    }, hash);
    await wait(target, 600);
  };
  const openEditor = async (target, id) => {
    await go(target, "#/design/" + id);
    await target.locator(".cf-workspace").waitFor({ timeout: 20000 });
  };

  /* ================= a design that release 1 stored ================= */
  await step("a design of the first release opens whole, with every field, and opening it writes nothing", async () => {
    await home(page);
    await seed(page, [
      ["designs", full],
      ["summaries", summaryOf(full)],
      ["designs", minimal],
      ["summaries", summaryOf(minimal)],
    ]);
    await openEditor(page, full.id);
    const title = await page.getByRole("textbox", { name: "Design title" }).inputValue();
    if (title !== full.title) throw new Error("the title is " + title);
    const open = await page.evaluate(() => ({ pages: window.__editor.getState().design.pages.length, version: window.__editor.getState().design.version }));
    if (open.pages !== full.pages.length) throw new Error(open.pages + " pages");
    if (open.version !== 1) throw new Error("the open design is at version " + open.version);
    await wait(page, 2500);
    if (canon(await readFrom(page, "designs", full.id)) !== canon(full)) throw new Error("the stored design is not what was stored");
    const summary = await readFrom(page, "summaries", full.id);
    if ("schema" in summary) throw new Error("opening wrote a dashboard record");
    await shot(page, "old-design");
    await openEditor(page, minimal.id);
    if ((await page.getByRole("textbox", { name: "Design title" }).inputValue()) !== minimal.title) throw new Error("the design with only the required fields did not open");
    return `${full.pages.length} pages, ${open.version === 1 ? "version 1" : ""}, nothing written`;
  });

  /* ================= a design that a newer release stored ================= */
  await step("a design saved by a newer release is refused with a screen that says so, and is left exactly as it was", async () => {
    await seed(page, [
      ["designs", future],
      ["summaries", summaryOf(future, { schema: FUTURE_VERSION })],
    ]);
    expectRefusals = true;
    await go(page, "#/design/" + future.id);
    await page.getByRole("heading", { name: "Update Craftly to open this design" }).waitFor({ timeout: 15000 });
    if (await page.locator(".cf-workspace").count()) throw new Error("the editor opened a design it cannot read");
    for (const name of ["Reload", "Back to home"]) await page.getByRole("button", { name }).waitFor({ timeout: 5000 });
    await shot(page, "newer-design");
    await wait(page, 2000);
    if (canon(await readFrom(page, "designs", future.id)) !== canon(future)) throw new Error("the design was changed");
    if ((await readFrom(page, "summaries", future.id)).schema !== FUTURE_VERSION) throw new Error("its dashboard record was changed");
    await page.getByRole("button", { name: "Back to home" }).click();
    await page.waitForFunction(() => location.hash === "#/" || location.hash === "", null, { timeout: 5000 });
    return "version " + FUTURE_VERSION + " refused, stored copy identical";
  });

  await step("starring it still works, and changes nothing else in it", async () => {
    await go(page, "#/projects");
    const card = page.getByRole("article", { name: "From the future" });
    await card.waitFor({ timeout: 15000 });
    await card.getByRole("button", { name: "Star" }).click();
    await until(
      page,
      async () =>
        await new Promise((resolve) => {
          const o = indexedDB.open("craftly");
          o.onsuccess = () => {
            const r = o.result.transaction("designs").objectStore("designs").get("d_future");
            r.onsuccess = () => {
              o.result.close();
              resolve(r.result?.starred === true);
            };
          };
        }),
      undefined,
      "the star to be stored",
    );
    const after = await readFrom(page, "designs", future.id);
    if (canon(after) !== canon({ ...future, starred: true })) throw new Error("something besides the star changed: " + canon(after).slice(0, 160));
    const summary = await readFrom(page, "summaries", future.id);
    if (summary.schema !== FUTURE_VERSION || summary.starred !== true) throw new Error("the dashboard record is " + JSON.stringify(summary).slice(0, 160));
    return "starred, version " + after.version + " and the new field intact";
  });

  await step("copying it is refused with the reason, and no copy is made", async () => {
    const count = () =>
      page.evaluate(
        () =>
          new Promise((resolve) => {
            const o = indexedDB.open("craftly");
            o.onsuccess = () => {
              const r = o.result.transaction("summaries").objectStore("summaries").count();
              r.onsuccess = () => {
                o.result.close();
                resolve(r.result);
              };
            };
          }),
      );
    const before = await count();
    const card = page.getByRole("article", { name: "From the future" });
    await card.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Make a copy" }).click();
    await page
      .getByText(/saved by a newer version of Craftly/)
      .first()
      .waitFor({ timeout: 10000 });
    await shot(page, "copy-refused");
    await wait(page, 500);
    if ((await count()) !== before) throw new Error("a copy was made");
    return "no copy, " + before + " designs";
  });

  await step("a backup holds it exactly as stored, so nothing the old tab cannot read is lost", async () => {
    await page.getByRole("button", { name: "Account" }).first().click();
    await page.getByRole("menuitem", { name: "Back up & restore" }).click();
    const dialog = page.getByRole("dialog", { name: "Back up & restore" });
    await dialog.waitFor({ timeout: 15000 });
    await wait(page, 600);
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), dialog.getByRole("button", { name: "Download backup" }).click()]);
    await download.saveAs(BACKUP_PATH);
    await dialog.getByText("Backup downloaded").waitFor({ timeout: 10000 });
    const entry = readZip(BACKUP_PATH).find((e) => e.name === "designs/d_future.json");
    if (!entry) throw new Error("the design is not in the backup");
    const stored = await readFrom(page, "designs", future.id);
    if (canon(JSON.parse(entry.text())) !== canon(stored)) throw new Error("the design in the backup is not the stored one");
    await dialog.getByRole("button", { name: "Close" }).click();
    await dialog.waitFor({ state: "detached", timeout: 5000 });
    return "designs/d_future.json, version " + stored.version;
  });
  expectRefusals = false;

  /* ================= another tab upgrades the database ================= */
  await step("another tab upgrades the database while an edit waits: the edit is written first, and this tab says so", async () => {
    await openEditor(page, minimal.id);
    await page.waitForFunction(() => window.__editor.getState().saveState === "saved", null, { timeout: 15000 });
    // a page of the same origin that runs none of the app: it is another tab that talks to the database
    const other = await ctx.newPage();
    await other.goto(BASE + "/manifest.webmanifest");
    // the title is written to the design when its field is left (Enter): from then on an edit waits for the autosave, 0.7 s away
    const title = page.getByRole("textbox", { name: "Design title" });
    await title.fill("Edited just before the upgrade");
    await title.press("Enter");
    const waiting = await page.evaluate(() => window.__editor.getState().saveState);
    if (waiting === "saved") throw new Error("the edit was saved before the upgrade began: this step would prove nothing");
    // what a newer release does the first time it changes the stores: it asks for a higher version of the database
    const upgrade = await other.evaluate(
      () =>
        new Promise((resolve) => {
          const started = performance.now();
          let blocked = false;
          const request = indexedDB.open("craftly", 3);
          request.onupgradeneeded = () => request.result.createObjectStore("added_by_a_newer_release");
          request.onblocked = () => {
            blocked = true;
          };
          request.onsuccess = () => {
            request.result.close();
            resolve({ ok: true, blocked, ms: Math.round(performance.now() - started) });
          };
          request.onerror = () => resolve({ ok: false, error: String(request.error) });
        }),
    );
    if (!upgrade.ok) throw new Error("the upgrade failed: " + upgrade.error);
    if (upgrade.ms > 8000) throw new Error("the upgrade waited " + upgrade.ms + " ms for the old tab");
    const written = await readFrom(other, "designs", minimal.id);
    if (written.title !== "Edited just before the upgrade") throw new Error("the edit was lost: the title is " + written.title);
    await page.getByText(REPLACED).waitFor({ timeout: 10000 });
    await page.getByRole("button", { name: "Reload" }).waitFor({ timeout: 5000 });
    await shot(page, "replaced");
    const info = await databaseInfo(other);
    if (info.version !== 3 || !info.stores.includes("added_by_a_newer_release")) throw new Error("the database is " + JSON.stringify(info));
    await other.close();
    return `upgrade took ${upgrade.ms} ms (${upgrade.blocked ? "held up by this tab until its edit was saved" : "not held up"}), edit written, notice shown`;
  });

  await step("after a reload the older code refuses to touch a library that a newer release upgraded", async () => {
    expectRefusals = true;
    const before = { future: canon(await readFrom(page, "designs", future.id)), edited: canon(await readFrom(page, "designs", minimal.id)) };
    await page.reload({ waitUntil: "load" });
    await page.getByRole("heading", { name: "Update Craftly to open this design" }).waitFor({ timeout: 20000 });
    await go(page, "#/");
    await page.getByText("This tab is older than your designs.").waitFor({ timeout: 20000 });
    await shot(page, "library-newer");
    await wait(page, 1500);
    const after = { future: canon(await readFrom(page, "designs", future.id)), edited: canon(await readFrom(page, "designs", minimal.id)) };
    if (after.future !== before.future || after.edited !== before.edited) throw new Error("the older code changed the library");
    const info = await databaseInfo(page);
    if (info.version !== 3) throw new Error("the database is at version " + info.version);
    expectRefusals = false;
    return "editor and dashboard say so, database still at version 3, records identical";
  });

  await step("no errors reached the console", async () => {
    if (logs.length) throw new Error(logs.slice(0, 4).join(" | "));
    return "clean";
  });

  console.log(results.join("\n"));
  if (results.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
  console.log("CONSOLE:", JSON.stringify(logs.slice(0, 8)));
  await browser.close();
})().catch((e) => {
  console.log("CRASH", e.message.split("\n")[0]);
  process.exit(1);
});
