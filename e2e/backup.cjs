/*
 * Back up and restore, as a person does it: make designs, a folder and an upload in one browser, download the backup,
 * open a second browser profile that has nothing, restore, and check what came back. Also: asking the browser to keep
 * the data at the first save, restoring twice, a file that is not a backup, a damaged backup and the dialog on a phone.
 */
const fs = require("node:fs");
const { launch, outDir, BASE } = require("./lib.cjs");

const OUT = outDir("backup");
const results = [];
const logs = [];
let shotN = 0;

// a 1 x 1 PNG: the upload only has to be a picture the browser can decode
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const PNG_PATH = OUT + "logo.png";
fs.writeFileSync(PNG_PATH, PNG);
const BACKUP_PATH = OUT + "backup.zip";
const DAMAGED_PATH = OUT + "damaged.zip";

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
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error("the file list is damaged at entry " + i);
    const nameLength = buf.readUInt16LE(at + 28);
    const local = buf.readUInt32LE(at + 42);
    entries.push({
      name: buf.toString("utf8", at + 46, at + 46 + nameLength),
      method: buf.readUInt16LE(at + 10),
      size: buf.readUInt32LE(at + 24),
      dataAt: local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28),
    });
    at += 46 + nameLength + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return { buf, entries };
}

(async () => {
  const browser = await launch();
  const watch = (page, label) => {
    page.on("console", (m) => {
      if (m.type() === "error") logs.push(label + " console.error: " + m.text().slice(0, 240));
    });
    page.on("pageerror", (e) => logs.push(label + " PAGEERROR " + e.message.slice(0, 240)));
  };
  const open = async (viewport = { width: 1440, height: 900 }, init) => {
    const ctx = await browser.newContext({ viewport, acceptDownloads: true });
    if (init) await ctx.addInitScript(init);
    const page = await ctx.newPage();
    return { ctx, page };
  };
  const shot = (page, name) => page.screenshot({ path: OUT + String(++shotN).padStart(2, "0") + "-" + name + ".png" });
  const step = async (name, fn) => {
    try {
      const r = await fn();
      results.push("PASS " + name + (r ? "  " + r : ""));
    } catch (e) {
      results.push("FAIL " + name + "  -> " + String(e.message).split("\n")[0].slice(0, 260));
    }
  };
  const wait = (page, ms) => page.waitForTimeout(ms);

  /* ---- the same moves as the other journeys ---- */
  const home = async (page) => {
    await page.goto(BASE + "/#/", { waitUntil: "load" });
    await page.getByText("What will you design today?").waitFor({ timeout: 20000 });
  };
  const go = async (page, hash) => {
    await page.evaluate((h) => {
      location.hash = h;
    }, hash);
    await wait(page, 600);
  };
  const newDesign = async (page) => {
    await home(page);
    await page
      .getByRole("button", { name: /^Presentation/ })
      .first()
      .click();
    await page.waitForURL(/#\/design\//, { timeout: 15000 });
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    await wait(page, 800);
  };
  const saved = (page) => page.waitForFunction(() => window.__editor.getState().saveState === "saved", null, { timeout: 15000 });
  const tab = async (page, name) => {
    const active = await page.evaluate(() => document.querySelector("[role=tab][aria-selected=true]")?.textContent?.trim() || "");
    const open = (await page.locator(".cf-sidepanel.is-open").count()) > 0;
    if (!(active === name && open)) await page.getByRole("tab", { name, exact: true }).click();
    await wait(page, 300);
  };
  const designId = (page) => page.evaluate(() => window.__editor.getState().design.id);

  /* ---- the dialog ---- */
  const openDialog = async (page) => {
    await page.getByRole("button", { name: "Account" }).first().click();
    await page.getByRole("menuitem", { name: "Back up & restore" }).click();
    const dialog = page.getByRole("dialog", { name: "Back up & restore" });
    await dialog.waitFor({ timeout: 15000 });
    return dialog;
  };
  const closeDialog = async (dialog) => {
    await dialog.getByRole("button", { name: "Close" }).click();
    await dialog.waitFor({ state: "detached", timeout: 5000 });
  };
  const choose = async (page, dialog, file) => {
    const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 10000 }), dialog.getByRole("button", { name: "Choose backup file" }).click()]);
    await chooser.setFiles(file);
  };
  const text = (dialog) => dialog.innerText();
  const need = (haystack, needle, where) => {
    if (!haystack.includes(needle)) throw new Error(`${where}: "${needle}" is missing from: ${haystack.replace(/\s+/g, " ").slice(0, 300)}`);
  };
  const readAssets = (page) =>
    page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open("craftly");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const all = request.result.transaction("assets", "readonly").objectStore("assets").getAll();
            all.onsuccess = () =>
              resolve(all.result.map((a) => ({ id: a.id, name: a.name, mime: a.mime, size: a.blob.size, type: a.blob.type, width: a.width, height: a.height })));
            all.onerror = () => reject(all.error);
          };
        }),
    );

  /* ================= the first browser: it has the designs ================= */
  const first = await open({ width: 1440, height: 900 }, () => {
    window.__persistCalls = 0;
    try {
      const storage = navigator.storage;
      const original = storage.persist.bind(storage);
      storage.persist = () => {
        window.__persistCalls += 1;
        return original();
      };
    } catch {
      /* a browser without the call has nothing to count */
    }
  });
  watch(first.page, "first");
  let firstDesign = "";

  await step("the first save asks the browser to keep the library, once", async () => {
    await newDesign(first.page);
    firstDesign = await designId(first.page);
    await first.page.waitForFunction(() => window.__persistCalls >= 1, null, { timeout: 8000 });
    await wait(first.page, 1500);
    const calls = await first.page.evaluate(() => window.__persistCalls);
    if (calls !== 1) throw new Error("persist() was called " + calls + " times");
    return "persist() called once";
  });

  await step("a design with a shape and an uploaded picture is saved with its preview", async () => {
    const page = first.page;
    await tab(page, "Elements");
    const back = page.getByRole("button", { name: "Back to all elements" });
    if (await back.isVisible().catch(() => false)) await back.click();
    await page.getByRole("button", { name: "Browse shapes" }).click();
    await wait(page, 600);
    await page.locator(".cf-ditem").first().click();
    await wait(page, 500);
    await tab(page, "Uploads");
    await page.locator("input[type=file]").first().setInputFiles(PNG_PATH);
    await wait(page, 1500);
    await page.locator(".cf-sidepanel .cf-ditem").first().click();
    await wait(page, 600);
    await saved(page);
    const types = await page.evaluate(() => window.__editor.getState().design.pages[0].elements.map((e) => e.type));
    if (!types.includes("shape") || !types.includes("image")) throw new Error("the page holds " + types);
    const uploads = await readAssets(page);
    if (uploads.length !== 1) throw new Error(uploads.length + " uploads");
    return types.join(" + ");
  });

  await step("a second design and a folder", async () => {
    await newDesign(first.page);
    await saved(first.page);
    await go(first.page, "#/projects");
    await first.page
      .getByRole("button", { name: /Create folder/ })
      .first()
      .click();
    const dlg = first.page.getByRole("dialog");
    await dlg.waitFor({ timeout: 4000 });
    await dlg.getByRole("textbox").first().fill("Campaign A");
    await dlg
      .getByRole("button", { name: /Create|Save|OK/i })
      .last()
      .click();
    await first.page.getByText("Campaign A").first().waitFor({ timeout: 5000 });
    return "2 designs, folder Campaign A";
  });

  await step("Back up & restore counts the library and downloads one file", async () => {
    const page = first.page;
    const dialog = await openDialog(page);
    await wait(page, 600);
    const idle = await text(dialog);
    need(idle, "2 designs", "counts");
    need(idle, "1 folder", "counts");
    need(idle, "1 upload", "counts");
    need(idle, "No backup yet", "before the first backup");
    await shot(page, "dialog");
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), dialog.getByRole("button", { name: "Download backup" }).click()]);
    const name = download.suggestedFilename();
    if (!/^Craftly backup \d{4}-\d{2}-\d{2}\.zip$/.test(name)) throw new Error("the file is called " + name);
    await download.saveAs(BACKUP_PATH);
    await dialog.getByText("Backup downloaded").waitFor({ timeout: 10000 });
    const { entries } = readZip(BACKUP_PATH);
    const names = entries.map((e) => e.name);
    const count = (re) => names.filter((n) => re.test(n)).length;
    if (names[0] !== "craftly-backup.json") throw new Error("the manifest is not first: " + names[0]);
    if (count(/^designs\/.+\.json$/) !== 2) throw new Error("designs in the file: " + count(/^designs\//));
    if (count(/^uploads\/.+\.png$/) !== 1) throw new Error("uploads in the file: " + count(/^uploads\//));
    if (count(/^previews\/.+\.jpg$/) < 1) throw new Error("no preview in the file");
    if (entries.some((e) => e.method !== 0)) throw new Error("an entry is compressed");
    const done = await text(dialog);
    need(done, name, "after the download");
    need(done, "2 designs", "after the download");
    await shot(page, "downloaded");
    return `${name}: ${names.length} files, ${fs.statSync(BACKUP_PATH).size} bytes`;
  });

  await step("the dialog remembers the backup it just made", async () => {
    const dialog = first.page.getByRole("dialog", { name: "Back up & restore" });
    await dialog.getByRole("button", { name: "Make another backup" }).click();
    await dialog.getByText("Last backup: just now").waitFor({ timeout: 5000 });
    await closeDialog(dialog);
    await go(first.page, "#/");
    const again = await openDialog(first.page);
    await again.getByText("Last backup: just now").waitFor({ timeout: 5000 });
    await closeDialog(again);
    return "Last backup: just now";
  });

  /* ================= a second browser profile: nothing in it ================= */
  const second = await open();
  watch(second.page, "second");

  await step("a browser with nothing in it: Restore reads the file and says what it will add", async () => {
    const page = second.page;
    await home(page);
    await go(page, "#/projects");
    const dialog = await openDialog(page);
    await wait(page, 500);
    need(await text(dialog), "Nothing to back up yet", "the empty browser");
    await choose(page, dialog, BACKUP_PATH);
    await dialog.getByRole("heading", { name: "Ready to restore" }).waitFor({ timeout: 15000 });
    const review = await text(dialog);
    need(review, "Will be added: 2 designs, 1 folder, 1 upload.", "the review");
    await shot(page, "review");
    return "Will be added: 2 designs, 1 folder, 1 upload.";
  });

  await step("Restore adds the designs with their previews, the folder and the upload, under their own ids", async () => {
    const page = second.page;
    const dialog = page.getByRole("dialog", { name: "Back up & restore" });
    await dialog.getByRole("button", { name: "Restore", exact: true }).click();
    await dialog.getByRole("heading", { name: "Restore finished" }).waitFor({ timeout: 30000 });
    need(await text(dialog), "Added: 2 designs, 1 folder, 1 upload.", "the result");
    await shot(page, "restored");
    await dialog.getByRole("button", { name: "Open Projects" }).click();
    await page.waitForFunction(() => location.hash === "#/projects", null, { timeout: 5000 });
    await page.locator(".cf-dcard").nth(1).waitFor({ timeout: 10000 });
    const cards = await page.locator(".cf-dcard").count();
    if (cards !== 2) throw new Error(cards + " design cards");
    await page.getByText("Campaign A").first().waitFor({ timeout: 5000 });
    await wait(page, 600);
    const pictures = await page.evaluate(() =>
      [...document.querySelectorAll(".cf-dcard__img")].map((img) => ({ ok: img.complete && img.naturalWidth > 0, src: img.src.slice(0, 22) })),
    );
    if (!pictures.length || pictures.some((p) => !p.ok || !p.src.startsWith("data:image/jpeg"))) throw new Error("previews: " + JSON.stringify(pictures));
    await shot(page, "projects");
    return `${cards} cards, ${pictures.length} with their preview`;
  });

  await step("the restored design opens, and its uploaded picture is whole", async () => {
    const page = second.page;
    await go(page, "#/design/" + firstDesign);
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    await wait(page, 800);
    const state = await page.evaluate(() => {
      const s = window.__editor.getState();
      return { id: s.design.id, types: s.design.pages[0].elements.map((e) => e.type), image: s.design.pages[0].elements.find((e) => e.type === "image")?.src };
    });
    if (state.id !== firstDesign) throw new Error("the design came back as " + state.id);
    if (!state.types.includes("shape") || !state.types.includes("image")) throw new Error("the page holds " + state.types);
    const uploads = await readAssets(page);
    if (uploads.length !== 1 || uploads[0].size !== PNG.length || uploads[0].type !== "image/png" || "asset:" + uploads[0].id !== state.image) {
      throw new Error("the upload: " + JSON.stringify(uploads) + " for " + state.image);
    }
    await tab(page, "Uploads");
    await wait(page, 600);
    const shown = await page.locator(".cf-sidepanel .cf-ditem").count();
    if (shown < 1) throw new Error("the Uploads tab shows nothing");
    return `same id, ${uploads[0].size} byte upload`;
  });

  await step("restoring the same file again changes nothing, and says so", async () => {
    const page = second.page;
    await go(page, "#/projects");
    const dialog = await openDialog(page);
    await choose(page, dialog, BACKUP_PATH);
    await dialog.getByRole("heading", { name: "Nothing to restore" }).waitFor({ timeout: 15000 });
    need(await text(dialog), "Everything in this backup is already here.", "the second restore");
    if ((await dialog.getByRole("button", { name: "Restore", exact: true }).count()) !== 0) throw new Error("it still offers to restore");
    await closeDialog(dialog);
    const cards = await page.locator(".cf-dcard").count();
    if (cards !== 2) throw new Error(cards + " design cards after the second restore");
    return "nothing to restore, still 2 designs";
  });

  await step("a file that is not a backup is refused in words", async () => {
    const page = second.page;
    const dialog = await openDialog(page);
    await choose(page, dialog, PNG_PATH);
    const alert = dialog.getByRole("alert");
    await alert.waitFor({ timeout: 10000 });
    const said = await alert.innerText();
    need(said, "That file is not a Craftly backup.", "the refusal");
    await shot(page, "not-a-backup");
    await dialog.getByRole("button", { name: "Try again" }).click();
    await dialog.getByRole("button", { name: "Choose backup file" }).waitFor({ timeout: 5000 });
    await closeDialog(dialog);
    return "That file is not a Craftly backup.";
  });

  /* ================= a third browser, on a phone, and a damaged backup ================= */
  const phone = await open({ width: 390, height: 844 });
  watch(phone.page, "phone");

  await step("a damaged backup: the rest still comes back, and the dialog fits a phone", async () => {
    const { buf, entries } = readZip(BACKUP_PATH);
    const victim = entries.find((e) => /^designs\//.test(e.name));
    const damaged = Buffer.from(buf);
    damaged[victim.dataAt + 1] ^= 0xff;
    fs.writeFileSync(DAMAGED_PATH, damaged);

    const page = phone.page;
    await home(page);
    const dialog = await openDialog(page);
    await wait(page, 500);
    const box = await dialog.boundingBox();
    const overflow = await page.evaluate(() => {
      const d = document.querySelector("[role=dialog]");
      return { dialog: d.scrollWidth - d.clientWidth, page: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    if (!box || box.x < -1 || box.x + box.width > 391) throw new Error("the dialog is at x " + (box && box.x) + " and " + (box && box.width) + " wide");
    if (overflow.dialog > 1 || overflow.page > 1) throw new Error("sideways overflow " + JSON.stringify(overflow));
    await shot(page, "phone");

    await choose(page, dialog, DAMAGED_PATH);
    await dialog.getByRole("heading", { name: "Ready to restore" }).waitFor({ timeout: 15000 });
    await dialog.getByRole("button", { name: "Restore", exact: true }).click();
    await dialog.getByRole("heading", { name: "Restore finished" }).waitFor({ timeout: 30000 });
    const result = await text(dialog);
    need(result, "Added: 1 design, 1 folder, 1 upload.", "the damaged restore");
    need(result, "1 item could not be read, because the backup file is damaged.", "the damaged restore");
    await shot(page, "phone-restored");
    await dialog.getByRole("button", { name: "Open Projects" }).click();
    await page.locator(".cf-dcard").first().waitFor({ timeout: 10000 });
    const cards = await page.locator(".cf-dcard").count();
    if (cards !== 1) throw new Error(cards + " design cards");
    return "1 of 2 designs restored, the damaged one reported";
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
