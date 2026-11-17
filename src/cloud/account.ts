/**
 * The account of this device (docs/ACCOUNTS.md, "Client"): signing up, in and out, redeeming an invite, moving designs that are on
 * this device only into the account, and `useAccount` for the screens. Loaded only when a person opens an account screen or is
 * signed in; the session itself is kept by state.ts.
 */
import { listDesigns, listFolders, notifyLibrary } from "@/core/library";
import { listAssets } from "@/core/assets";
import { dbGetAll, metaSet, writeTransaction } from "@/core/persistence";
import type { DesignSummary, Folder, SyncRecord } from "@/core/types";
import { collectAssetIds } from "@/export/projectFormat";
import { getStoredDesign } from "@/core/library";
import * as api from "./api";
import type { Conn } from "./api";
import { CURSORS_KEY, FOLDERS_KEY, saveSession, setActiveSpace, updateSession, useCloud, type CloudSession, type SessionTeam } from "./state";
import { countWaiting, requestSync, startSync, stopSync, syncNow } from "./sync";
import type { CloudTeam } from "./validate";

/** A name for this device that a person recognises in their list of devices and in "(edited on …)": the browser and the system. */
export function deviceName(agent = typeof navigator === "undefined" ? "" : navigator.userAgent): string {
  const browser = /Edg\//.test(agent) ? "Edge" : /Firefox\//.test(agent) ? "Firefox" : /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "Browser";
  const system = /Android/.test(agent)
    ? "Android"
    : /iPhone|iPad/.test(agent)
      ? "iOS"
      : /Windows/.test(agent)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(agent)
          ? "macOS"
          : /Linux/.test(agent)
            ? "Linux"
            : "";
  return system ? `${browser} on ${system}` : browser;
}

/** The connection of the person who is signed in; null when nobody is. */
export function currentConn(): Conn | null {
  const session = useCloud.getState().session;
  return session ? { server: session.server, token: session.token } : null;
}

const teamsOf = (teams: CloudTeam[]): SessionTeam[] => teams.map((t) => ({ id: t.id, name: t.name, role: t.role }));

async function begin(server: string, signed: { token: string; user: CloudSession["user"]; team?: CloudTeam }): Promise<void> {
  let teams: SessionTeam[] = signed.team ? teamsOf([signed.team]) : [];
  try {
    teams = teamsOf((await api.getMe({ server, token: signed.token })).teams);
  } catch {
    // the teams come with the first sync
  }
  await saveSession({ server, token: signed.token, user: signed.user, device: deviceName(), teams, activeSpace: signed.team?.id ?? signed.user.id });
  startSync();
}

/** Makes an account on `server` and signs this device in. The recovery code is shown once, by the caller. */
export async function signUpAccount(server: string, body: { email: string; password: string; name: string; code?: string }) {
  const signed = await api.signUp({ server, token: null }, body);
  await begin(server, signed);
  return { recoveryCode: signed.recoveryCode, team: signed.team };
}

export async function signInAccount(server: string, email: string, password: string): Promise<void> {
  const signed = await api.signIn({ server, token: null }, { email, password, device: deviceName() });
  await begin(server, signed);
}

/** Joins the team of an invite; the dashboard then shows the team's space. */
export async function redeemInvite(code: string): Promise<CloudTeam> {
  const conn = currentConn();
  if (!conn) throw new api.CloudError("session", 401, "not signed in");
  const team = await api.redeemInvite(conn, code);
  await updateSession((session) => ({ ...session, teams: [...session.teams.filter((t) => t.id !== team.id), { id: team.id, name: team.name, role: team.role }] }));
  await setActiveSpace(team.id);
  requestSync();
  return team;
}

/** The designs on this device that are in no account (the ones "Move into your account" offers), newest first. */
export async function localOnlyDesigns(): Promise<DesignSummary[]> {
  return (await listDesigns()).filter((summary) => !summary.space);
}

/**
 * Moves designs that are on this device only into the person's own space: they are sent with the next sync, as new designs (a
 * different design under the same id on the server is sent as a copy with a new id). Their folders go with them.
 */
export async function moveIntoAccount(ids: readonly string[]): Promise<void> {
  const session = useCloud.getState().session;
  if (!session || !ids.length) return;
  const space = session.user.id;
  const wanted = new Set(ids);
  const [summaries, folders] = await Promise.all([listDesigns(), listFolders()]);
  const byId = new Map(folders.map((f) => [f.id, f]));
  const movedFolders = new Map<string, Folder>();
  for (const summary of summaries) {
    if (!wanted.has(summary.id) || summary.space) continue;
    for (let at = summary.folderId, n = 0; at && n < 100; n++) {
      const folder = byId.get(at);
      if (!folder || folder.space) break;
      movedFolders.set(folder.id, folder);
      at = folder.parentId;
    }
  }
  await writeTransaction(["summaries", "folders"], async (tx) => {
    for (const summary of summaries) if (wanted.has(summary.id) && !summary.space) tx.objectStore("summaries").put({ ...summary, space });
    for (const folder of movedFolders.values()) tx.objectStore("folders").put({ ...folder, space });
  });
  notifyLibrary();
  requestSync();
}

/**
 * Signs this device out. What waits is sent first. Then either the account's designs stay here as designs of this device only
 * (`keepCopies`), or they are removed from this device (the default: a shared computer keeps nothing of the account). Designs that
 * were never moved into the account stay in every case. The session ends on the server too when it can be reached.
 */
export async function signOutAccount(options: { keepCopies: boolean }): Promise<void> {
  const session = useCloud.getState().session;
  if (!session) return;
  await syncNow().catch(() => null);
  stopSync();
  await api.signOut({ server: session.server, token: session.token }).catch(() => undefined);

  const [summaries, folders, records, assets] = await Promise.all([listDesigns(), listFolders(), dbGetAll<SyncRecord>("sync"), listAssets()]);
  const ofAccount = summaries.filter((s) => s.space);
  const stays = summaries.filter((s) => !s.space);
  // the uploads that the designs which stay use are kept, whoever's they were
  const used = new Set<string>();
  if (!options.keepCopies) {
    for (const summary of stays) {
      const design = await getStoredDesign(summary.id);
      if (design) for (const id of collectAssetIds(design)) used.add(id);
    }
  }
  await writeTransaction(["designs", "summaries", "folders", "sync", "versions", "assets"], async (tx) => {
    for (const record of records) tx.objectStore("sync").delete(record.id);
    if (options.keepCopies) {
      for (const summary of ofAccount) {
        const { space: _space, ...rest } = summary;
        tx.objectStore("summaries").put(rest);
      }
      for (const folder of folders.filter((f) => f.space)) {
        const { space: _space, ...rest } = folder;
        tx.objectStore("folders").put(rest);
      }
      for (const asset of assets.filter((a) => a.space)) {
        const { space: _space, ...rest } = asset;
        tx.objectStore("assets").put(rest);
      }
      return;
    }
    const gone = new Set(ofAccount.map((s) => s.id));
    for (const id of gone) {
      tx.objectStore("designs").delete(id);
      tx.objectStore("summaries").delete(id);
    }
    const versions = tx.objectStore("versions");
    for (const key of await new Promise<IDBValidKey[]>((resolve, reject) => {
      const request = versions.getAllKeys();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    })) {
      const designId = String(key).slice(0, String(key).lastIndexOf(":"));
      if (gone.has(designId)) versions.delete(key);
    }
    for (const folder of folders) if (folder.space) tx.objectStore("folders").delete(folder.id);
    for (const asset of assets) if (asset.space && !used.has(asset.id)) tx.objectStore("assets").delete(asset.id);
  });
  await metaSet(CURSORS_KEY, {});
  await metaSet(FOLDERS_KEY, {});
  await saveSession(null);
  notifyLibrary();
}

export { countWaiting };
