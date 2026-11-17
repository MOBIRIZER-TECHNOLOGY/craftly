/**
 * Signing out in a browser whose database keeps no Blob (WebKit's private windows): the uploads are stored with their bytes
 * (`storableAsset`), and what sign-out puts back must be stored so too. The fake database takes a Blob and keeps nothing of it, so
 * here it refuses one, as WebKit does, before anything asks whether it keeps them (which is asked once per page).
 */
import { afterEach, beforeEach, expect, it } from "vitest";
import { cacheSharedAsset, getAsset, listAssets, prepareAssetFromFile } from "@/core/assets";
import { boot, closeAll, PNG, signUp, type Booted } from "@/server/accounts/testServer";
import { wipeDatabase } from "@/test/logicDb";
import { signOutAccount } from "./account";
import { saveSession, useCloud } from "./state";
import { stopSync } from "./sync";

for (const method of ["put", "add"] as const) {
  const original = IDBObjectStore.prototype[method];
  IDBObjectStore.prototype[method] = function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
    if (value && typeof value === "object" && (value as { blob?: unknown }).blob instanceof Blob) throw new DOMException("A Blob cannot be stored here", "DataCloneError");
    return original.call(this, value, key);
  };
}

let b: Booted;
let space = "";

beforeEach(async () => {
  await wipeDatabase();
  b = await boot();
  const person = await signUp(b, { name: "Ann" });
  space = person.user.id;
  await saveSession({ server: b.base, token: person.token, user: person.user, device: "Test laptop", teams: [], activeSpace: space });
});

afterEach(async () => {
  stopSync();
  await saveSession(null);
  await closeAll();
});

it("keeps the account's uploads, with their bytes, when copies are kept", async () => {
  const bytes = Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0));
  const asset = await prepareAssetFromFile(new File([bytes], "dot.png", { type: "image/png" }), "a_from_server");
  await cacheSharedAsset({ ...asset, space });
  expect((await getAsset(asset.id))?.space).toBe(space);

  await signOutAccount({ keepCopies: true });
  expect(useCloud.getState().session).toBeNull();
  const kept = (await listAssets()).find((a) => a.id === asset.id);
  expect(kept?.space).toBeUndefined();
  expect(new Uint8Array(await kept!.blob.arrayBuffer())).toEqual(bytes);
});
