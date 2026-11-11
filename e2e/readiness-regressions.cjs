const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const { launch, joinIfAsked, BASE } = require("./lib.cjs");

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const imageFile = { name: "audit.png", mimeType: "image/png", buffer: PNG };
const status = (page, state) => page.waitForFunction((value) => window.__editor?.getState().saveState === value, state);
const workspace = (page) => page.locator(".cf-workspace").waitFor();
const edit = (page, name) => page.evaluate((value) => window.__editor.getState().actions.setTitle(value), name);
const title = (page) => page.getByRole("textbox", { name: "Design title" });
const snapshot = (page) => page.evaluate(() => window.__editor.getState().design);
const badge = (page, value) => page.waitForFunction((text) => document.querySelector(".cf-live-badge")?.textContent === text, value);
const share = async (page) => {
  await page.getByRole("button", { name: "Share", exact: true }).click();
  return page.getByRole("dialog", { name: "Share design" });
};
const create = async (page) => {
  await page.goto(BASE + "/#/");
  await page
    .getByRole("button", { name: /^Presentation/ })
    .first()
    .click();
  await workspace(page);
  return page.url();
};
const dashboardImport = async (page, project) => {
  await page.getByRole("button", { name: "Account" }).first().click();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("menuitem", { name: "Import project file" }).click()]);
  await chooser.setFiles({ name: "regression.craftly", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
};

async function upload(page, file) {
  const tab = page.getByRole("tab", { name: "Uploads", exact: true });
  if (!(await page.locator(".cf-sidepanel input[type=file]").count())) await tab.click();
  await page.locator(".cf-sidepanel input[type=file]").first().setInputFiles(file);
  await page
    .locator(".cf-sidepanel")
    .getByRole("button", { name: "Add " + file.name.replace(/\.[^.]+$/, "") + " to the page" })
    .click();
  await page.waitForFunction(() => window.__editor.getState().design.pages[0].elements.some((el) => el.type === "image"));
}

async function idb(page, operation, id) {
  return page.evaluate(
    async ({ operation, id }) => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open("craftly");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const stores = operation === "asset" || operation === "removeAsset" ? ["assets"] : ["designs", "summaries"];
      const mode = operation.startsWith("remove") ? "readwrite" : "readonly";
      try {
        return await new Promise((resolve, reject) => {
          const tx = db.transaction(stores, mode);
          let result;
          for (const name of stores) {
            const store = tx.objectStore(name);
            const req = mode === "readonly" ? store.get(id) : store.delete(id);
            req.onsuccess = () => {
              result ??= req.result;
            };
          }
          tx.oncomplete = () => resolve(result ? { title: result.title, size: result.size } : null);
          tx.onabort = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    },
    { operation, id },
  );
}

(async () => {
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, serviceWorkers: "block" });
  context.setDefaultTimeout(14000);
  const failed = [];
  const step = async (ids, fn) => {
    try {
      await fn();
      console.log("PASS", ids);
    } catch (error) {
      failed.push(ids);
      console.error("FAIL", ids, error.message);
    }
  };
  try {
    await step("1/2 stale edits cannot overwrite or resurrect", async () => {
      const a = await context.newPage();
      const url = await create(a);
      const b = await context.newPage();
      await b.goto(url);
      await workspace(b);
      await edit(a, "Latest tab A");
      await status(a, "saved");
      await edit(b, "Unsaved tab B");
      await status(b, "error");
      await b.getByText(/changed in another tab/).waitFor();
      const design = await snapshot(b);
      assert.equal((await idb(a, "design", design.id)).title, "Latest tab A");
      assert.equal(await title(b).inputValue(), "Unsaved tab B");
      const [recovery] = await Promise.all([b.waitForEvent("download"), b.getByRole("button", { name: "Download copy" }).click()]);
      assert.equal(JSON.parse(await readFile(await recovery.path(), "utf8")).design.title, "Unsaved tab B");
      await idb(a, "removeDesign", design.id);
      await edit(b, "Edit after permanent deletion");
      await status(b, "error");
      await b.getByText(/deleted in another tab/).waitFor();
      assert.equal(await idb(a, "design", design.id), null);
      await a.close();
      await b.close();
    });

    await step("7 save failure blocks navigation and retains edits", async () => {
      const p = await context.newPage();
      const url = await create(p);
      await p.evaluate(() => {
        const put = IDBObjectStore.prototype.put;
        window.__restorePut = () => {
          IDBObjectStore.prototype.put = put;
        };
        IDBObjectStore.prototype.put = function (...args) {
          if (this.name === "designs") throw new DOMException("Injected write failure", "QuotaExceededError");
          return put.apply(this, args);
        };
        window.__editor.getState().actions.setTitle("Keep this edit");
      });
      await p.getByRole("button", { name: "Home", exact: true }).click();
      await p.getByRole("dialog", { name: "Leave with unsaved changes?" }).waitFor();
      await p.getByRole("button", { name: "Stay in editor" }).click();
      assert.equal(p.url(), url);
      assert.equal(await title(p).inputValue(), "Keep this edit");
      await p.evaluate(() => window.__restorePut());
      await p.getByRole("button", { name: "Home", exact: true }).click();
      await p.getByText("What will you design today?").waitFor();
      await p.goto(url);
      await workspace(p);
      assert.equal(await title(p).inputValue(), "Keep this edit");
      await p.close();
    });

    await step("13/14 downloads report missing images and a corrected project imports cleanly", async () => {
      const p = await context.newPage();
      await create(p);
      await upload(p, imageFile);
      const design = await snapshot(p);
      const asset = design.pages[0].elements.find((el) => el.type === "image").src.slice(6);
      await status(p, "saved");
      await idb(p, "removeAsset", asset);
      const panel = await share(p);
      await panel.getByRole("button", { name: "Download", exact: true }).click();
      await p.locator(".cf-dl").getByRole("button", { name: "Download", exact: true }).click();
      await p.getByText(/images could not be loaded on page/).waitFor();
      await p.goto(BASE + "/#/");
      await p.getByText("What will you design today?").waitFor();
      const project = { craftly: 1, design, assets: { [asset]: { name: "Audit image", mime: "image/png", width: 1, height: 1, dataUrl: "data:image/png;base64,***" } } };
      await dashboardImport(p, project);
      await p.getByText(/Could not read 1 embedded image.*Audit image/).waitFor();
      assert.ok(p.url().endsWith("#/"));
      project.assets[asset].dataUrl = "data:image/png;base64," + PNG.toString("base64");
      await dashboardImport(p, project);
      await workspace(p);
      const imported = await snapshot(p);
      assert.notEqual(imported.id, design.id);
      assert.equal((await idb(p, "asset", imported.pages[0].elements.find((el) => el.type === "image").src.slice(6))).size, PNG.length);
      await p.close();
    });

    await step("5/6/10/11/12 owner, portable project, offline reload, rejection, and shared images", async () => {
      const a = await context.newPage();
      await create(a);
      await upload(a, imageFile);
      const panel = await share(a);
      await panel.getByRole("textbox", { name: "Server address" }).fill(process.env.LIVE_BASE);
      await panel.getByRole("button", { name: "Start live session" }).click();
      const invite = panel.getByRole("textbox", { name: "Edit link" });
      await invite.waitFor();
      const join = await invite.inputValue();
      const original = await snapshot(a);
      const link = original.live;
      const [portable] = await Promise.all([a.waitForEvent("download"), panel.getByRole("button", { name: "Save project file" }).click()]);
      const clean = JSON.parse(await readFile(await portable.path(), "utf8"));
      assert.equal(clean.design.live, undefined);
      assert.ok(!JSON.stringify(clean).includes(link.ownerKey));
      // An older project carrying credentials must also open as an independent copy.
      const importer = await context.newPage();
      let attempted = false;
      importer.on("websocket", () => {
        attempted = true;
      });
      await importer.goto(BASE + "/#/");
      await importer.getByText("What will you design today?").waitFor();
      await dashboardImport(importer, { ...clean, design: { ...clean.design, live: link } });
      await workspace(importer);
      assert.equal((await snapshot(importer)).live, undefined);
      assert.equal(attempted, false);
      await importer.close();

      const peer = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
      peer.setDefaultTimeout(16000);
      try {
        let offline = false;
        let rejectEdit = false;
        const sockets = new Set();
        await peer.routeWebSocket("**/ws?room=*", (ws) => {
          if (offline) return ws.close();
          const upstream = ws.connectToServer();
          sockets.add(ws);
          ws.onMessage((data) => {
            const message = JSON.parse(data.toString());
            if (rejectEdit && message.t === "ops") {
              rejectEdit = false;
              upstream.send(JSON.stringify({ ...message, ops: [{ k: "invalid-for-test" }] }));
            } else upstream.send(data);
          });
        });
        const b = await peer.newPage();
        await b.goto(join);
        await joinIfAsked(b);
        await workspace(b);
        await badge(b, "Live");
        const photo = original.pages[0].elements.find((el) => el.type === "image").src.slice(6);
        for (let i = 0; i < 80 && !(await idb(b, "asset", photo)); i++) await b.waitForTimeout(100);
        assert.equal((await idb(b, "asset", photo))?.size, PNG.length, "the guest receives the owner's image");
        const [photoDownload] = await Promise.all([
          (async () => {
            const download = b.waitForEvent("download");
            const guestPanel = await share(b);
            await guestPanel.getByRole("button", { name: "Download", exact: true }).click();
            await b.locator(".cf-dl").getByRole("button", { name: "Download", exact: true }).click();
            return download;
          })(),
        ]);
        assert.match(photoDownload.suggestedFilename(), /\.png$/);
        await b.keyboard.press("Escape");
        await upload(b, { ...imageFile, name: "peer-upload.png" });
        const peerPhoto = (await snapshot(b)).pages[0].elements.find((el) => el.type === "image" && el.src !== "asset:" + photo).src.slice(6);
        await a.waitForFunction((id) => window.__editor.getState().design.pages[0].elements.some((el) => el.src === "asset:" + id), peerPhoto);
        for (let i = 0; i < 30 && !(await idb(a, "asset", peerPhoto)); i++) await a.waitForTimeout(100);
        assert.equal((await idb(a, "asset", peerPhoto)).size, PNG.length);
        console.log("PASS 6 portable files and 12 shared image downloads in both directions");
        assert.equal((await fetch(process.env.LIVE_BASE + "/api/rooms/" + link.room, { method: "DELETE", headers: { "x-craftly-key": link.key } })).status, 403);
        const guestUrl = b.url();
        offline = true;
        for (const socket of sockets) await socket.close();
        await badge(b, "Reconnecting...");
        await edit(b, "Offline draft survives");
        await status(b, "saved");
        await b.reload();
        await workspace(b);
        assert.equal(await title(b).inputValue(), "Offline draft survives");
        offline = false;
        await badge(b, "Live");
        await a.waitForFunction(() => window.__editor.getState().design.title === "Offline draft survives");
        console.log("PASS 10 disconnected edit survives browser reload and reaches owner");

        rejectEdit = true;
        await edit(b, "Recovery draft");
        await b.getByText(/server refused an edit.*recovery copy/i).waitFor();
        assert.equal(await title(b).inputValue(), "Offline draft survives");
        await b.getByRole("button", { name: "Home", exact: true }).click();
        await b.getByText("What will you design today?").waitFor();
        await b.getByText("Recovery draft (unsent changes)", { exact: true }).waitFor();
        console.log("PASS 11 rejection explains the reason and stores a recovery copy");

        if (!(await panel.isVisible())) await share(a);
        await panel.getByRole("button", { name: "Stop sharing" }).click();
        await panel.getByRole("group", { name: "Stop sharing" }).getByRole("button", { name: "Stop sharing" }).click();
        await panel.getByRole("button", { name: "Start live session" }).waitFor();
        assert.equal((await fetch(process.env.LIVE_BASE + "/api/rooms/" + link.room, { method: "DELETE", headers: { "x-craftly-key": link.ownerKey } })).status, 404);
        assert.ok(guestUrl.includes("#/design/"));
        console.log("PASS 5 invite denied and owner stops room from browser");
      } finally {
        await peer.close();
      }
    });
  } finally {
    await browser.close();
  }
  process.exitCode = failed.length ? 1 : 0;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
