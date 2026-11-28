/**
 * Where the accounts are kept: people, the email that names each, their sessions, teams, one-time codes, and the spaces that hold
 * designs, folders and uploads. Two kinds, one interface: `MemoryAccounts` for tests and `FileAccounts`, which keeps everything
 * under one folder (`DATA_DIR/accounts/`) the way `FileStorage` keeps rooms: one JSON file per record, written whole under another
 * name and renamed into place, so that a crash leaves the old file or the new one and never half of one.
 *
 *   users/<userId>.json                         a person (UserRecord)
 *   emails/<sha256(email)>.json                 { userId }, made with "fail if it exists", so one email is one account
 *   sessions/<sha256(token)>.json               a session (SessionRecord); the token itself is nowhere
 *   teams/<teamId>.json                         a team (TeamRecord)
 *   codes/<sha256(code)>.json                   a sign-up code, a team's invite, or a reset (CodeRecord)
 *   spaces/<spaceId>/manifest.json              what a space holds (Manifest)
 *   spaces/<spaceId>/designs/<sha256(id)>/<rev>.json  each kept revision of a design with its thumbnail, the current one too
 *   spaces/<spaceId>/assets/<sha256(id)>.json   an upload
 *   spaces/<spaceId>/media/<sha256(id)>.bin     a clip or a sound, its bytes as they came (what it is: `Manifest.media`)
 *
 * Every id that becomes part of a name is checked against a pattern first, and the ids that come from a browser (designs,
 * folders, uploads) are not used as names at all but hashed: they may differ only in capitals, which some file systems do not
 * tell apart, and a design id may hold a colon, which Windows does not allow in a name. A file that is there and cannot be read
 * as what it should hold is an error ("damaged"), never a record that is not there: whoever asks must not be told that a person
 * or a design is gone because a disk failed.
 *
 * The storage checks the form of what it reads and the names it writes; what the records mean (who may, how many, which
 * revision) is the business of the routes (`routes.ts`, `spaces.ts`, `teams.ts`).
 */
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { link, mkdir, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { SharedAsset, StagedMedia } from "../storage";
import { isTeamRole as isRole, type TeamRole } from "./roles";

/* ---------------- records ---------------- */

export interface UserRecord {
  id: string;
  /** as it was typed, trimmed and in small letters: the name a person signs in with */
  email: string;
  name: string;
  /** `scrypt$15$8$1$<salt>$<hash>` (passwords.ts) */
  pw: string;
  /** hex SHA-256 of the recovery code that was shown once at sign-up */
  recoveryHash: string;
  disabled: boolean;
  createdAt: number;
  /**
   * The person's sessions: the id shown to them (to end one) and the SHA-256 of its token, which names its file. Kept here, and
   * not found by reading every session, so that listing them, capping them at 20 and ending all of them at a reset is a read of
   * this one file. A session file that is not listed here does not let anybody in.
   */
  sessions: Record<string, string>;
  /**
   * The teams the person is in. Only an index for `GET /api/me`: the team's own record says who is in it and is what every
   * request is checked against, so this may list a team the person has just left (it is written after the team, and left out
   * when the team does not name them), never miss one they are in (it is written before the team on joining).
   */
  teams: string[];
}

export interface SessionRecord {
  /** what the person sees and names to end it; not the token, and not the hash of it */
  id: string;
  userId: string;
  device: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
}

export interface InviteRecord {
  id: string;
  /** hex SHA-256 of the code, which was shown once */
  hash: string;
  role: TeamRole;
  usesLeft: number;
  expiresAt: number;
  createdAt: number;
}

export interface TeamRecord {
  id: string;
  name: string;
  createdAt: number;
  members: Record<string, TeamRole>;
  invites: InviteRecord[];
}

/** A one-time code, found by its hash: the hash is all that is kept of it. */
export type CodeRecord =
  | { kind: "signup"; usesLeft: number; expiresAt: number; createdAt: number }
  | { kind: "invite"; teamId: string; inviteId: string }
  | { kind: "reset"; userId: string; expiresAt: number; createdAt: number };

export interface VersionEntry {
  rev: number;
  bytes: number;
  at: number;
}

export interface DesignEntry {
  rev: number;
  /** the `seq` of the last change of the details (title, folder, star, trash) */
  metaSeq: number;
  /** the `seq` of the last change of anything: what the changes feed is ordered by */
  seq: number;
  title: string;
  folderId: string | null;
  starred: boolean;
  trashedAt: number | null;
  /** when it was deleted: a tombstone, whose content is kept until it is purged (90 days later) */
  deletedAt?: number;
  /** the bytes of the design's file now */
  bytes: number;
  updatedAt: number;
  /** the revisions before this one that are kept, oldest first */
  versions: VersionEntry[];
}

export interface FolderEntry {
  name: string;
  parentId: string | null;
  createdAt: number;
  seq: number;
  deletedAt?: number;
}

export interface AssetEntry {
  mime: string;
  bytes: number;
  seq: number;
  createdAt: number;
}

export interface Manifest {
  /** goes up by one with every change of the space; the cursor of the changes feed */
  seq: number;
  designs: Record<string, DesignEntry>;
  folders: Record<string, FolderEntry>;
  assets: Record<string, AssetEntry>;
  /**
   * The clips and sounds of the space (docs/ACCOUNTS.md, "Clips and sounds"): apart from the pictures, so that a browser from
   * before them, which fetches every upload of the feed as a picture, never meets one. None in a manifest written before them.
   */
  media?: Record<string, MediaEntry>;
}

export interface MediaEntry {
  mime: string;
  bytes: number;
  /** hex SHA-256 of the bytes: the same clip sent again is known from another under its id */
  sha256: string;
  seq: number;
  createdAt: number;
}

export interface StoredDesign {
  rev: number;
  /** the design as it was sent and checked (an object, kept as JSON) */
  design: Record<string, unknown>;
  thumbnail: string | null;
}

export const emptyManifest = (): Manifest => ({ seq: 0, designs: {}, folders: {}, assets: {} });

/** A person, a team, a space: made by the server, long enough not to be guessed, and safe as a file name. */
export const SERVER_ID = /^[A-Za-z0-9_-]{16,64}$/;
const HEX_HASH = /^[0-9a-f]{64}$/;
const hashName = (text: string) => createHash("sha256").update(text).digest("hex");

/* ---------------- the interface ---------------- */

export interface AccountStorage {
  loadUser(id: string): Promise<UserRecord | null>;
  saveUser(user: UserRecord): Promise<void>;
  removeUser(id: string): Promise<void>;
  /** Every person's id, without reading any of them. */
  listUsers(): Promise<string[]>;
  /** Claims an email for a person. False when another person has it: the storage refuses, not a check before the write. */
  claimEmail(email: string, userId: string): Promise<boolean>;
  emailOwner(email: string): Promise<string | null>;
  releaseEmail(email: string): Promise<void>;
  loadSession(tokenHash: string): Promise<SessionRecord | null>;
  saveSession(tokenHash: string, session: SessionRecord): Promise<void>;
  removeSession(tokenHash: string): Promise<void>;
  loadTeam(id: string): Promise<TeamRecord | null>;
  saveTeam(team: TeamRecord): Promise<void>;
  removeTeam(id: string): Promise<void>;
  loadCode(codeHash: string): Promise<CodeRecord | null>;
  saveCode(codeHash: string, code: CodeRecord): Promise<void>;
  removeCode(codeHash: string): Promise<void>;
  /** What a space holds; an empty one when it holds nothing yet. */
  loadManifest(space: string): Promise<Manifest>;
  saveManifest(space: string, manifest: Manifest): Promise<void>;
  /**
   * A revision of a design. Every revision is a file of its own, the current one too, and the manifest says which is current:
   * a save writes the new revision and then the manifest, so a crash between the two leaves the manifest naming the revision
   * before, whose file is still there, and never a manifest and a design that disagree.
   */
  loadVersion(space: string, id: string, rev: number): Promise<StoredDesign | null>;
  /** The text is `JSON.stringify` of a `StoredDesign`, made by the caller, which measured it. */
  saveVersion(space: string, id: string, rev: number, text: string): Promise<void>;
  /** Every revision of a design. */
  removeDesign(space: string, id: string): Promise<void>;
  removeVersion(space: string, id: string, rev: number): Promise<void>;
  loadAsset(space: string, id: string): Promise<SharedAsset | null>;
  saveAsset(space: string, id: string, asset: SharedAsset): Promise<void>;
  removeAsset(space: string, id: string): Promise<void>;
  /**
   * Receives the bytes of a clip or a sound of a space as they come, counting and hashing them: null when there are more than
   * `limit` (what had come is thrown away). It is the space's only once `commitMedia` has put it in place.
   */
  stageMedia(space: string, source: AsyncIterable<Buffer | Uint8Array>, limit: number): Promise<StagedMedia | null>;
  commitMedia(space: string, id: string, staged: StagedMedia): Promise<void>;
  dropMedia(staged: StagedMedia): Promise<void>;
  /** The bytes of a clip or a sound of a space, from the start (asked only for one its manifest has). */
  mediaStream(space: string, id: string): Readable;
  removeMedia(space: string, id: string): Promise<void>;
  /** Everything of a space: its manifest, designs, revisions, uploads, clips and sounds. */
  removeSpace(space: string): Promise<void>;
  checkWritable(): Promise<void>;
}

/* ---------------- what is read is checked ---------------- */

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const isText = (v: unknown): v is string => typeof v === "string";
const nullable = <T>(v: unknown, check: (v: unknown) => v is T): v is T | null => v === null || check(v);
const everyValue = (v: unknown, check: (v: unknown) => boolean) => isObject(v) && Object.values(v).every(check);

const looksLikeUser = (v: unknown): v is UserRecord =>
  isObject(v) &&
  isText(v.id) &&
  isText(v.email) &&
  isText(v.name) &&
  isText(v.pw) &&
  isText(v.recoveryHash) &&
  typeof v.disabled === "boolean" &&
  isTime(v.createdAt) &&
  everyValue(v.sessions, (h) => isText(h) && HEX_HASH.test(h)) &&
  Array.isArray(v.teams) &&
  v.teams.every((t) => isText(t) && SERVER_ID.test(t));

const looksLikeSession = (v: unknown): v is SessionRecord =>
  isObject(v) && isText(v.id) && isText(v.userId) && isText(v.device) && isTime(v.createdAt) && isTime(v.lastUsedAt) && isTime(v.expiresAt);

const looksLikeInvite = (v: unknown): v is InviteRecord =>
  isObject(v) && isText(v.id) && isText(v.hash) && isRole(v.role) && isCount(v.usesLeft) && isTime(v.expiresAt) && isTime(v.createdAt);

const looksLikeTeam = (v: unknown): v is TeamRecord =>
  isObject(v) && isText(v.id) && isText(v.name) && isTime(v.createdAt) && everyValue(v.members, isRole) && Array.isArray(v.invites) && v.invites.every(looksLikeInvite);

const looksLikeCode = (v: unknown): v is CodeRecord => {
  if (!isObject(v)) return false;
  if (v.kind === "signup") return isCount(v.usesLeft) && isTime(v.expiresAt) && isTime(v.createdAt);
  if (v.kind === "invite") return isText(v.teamId) && isText(v.inviteId);
  if (v.kind === "reset") return isText(v.userId) && isTime(v.expiresAt) && isTime(v.createdAt);
  return false;
};

const looksLikeVersion = (v: unknown) => isObject(v) && isCount(v.rev) && isCount(v.bytes) && isTime(v.at);
const looksLikeDesignEntry = (v: unknown) =>
  isObject(v) &&
  isCount(v.rev) &&
  isCount(v.metaSeq) &&
  isCount(v.seq) &&
  isText(v.title) &&
  nullable(v.folderId, isText) &&
  typeof v.starred === "boolean" &&
  nullable(v.trashedAt, isTime) &&
  (v.deletedAt === undefined || isTime(v.deletedAt)) &&
  isCount(v.bytes) &&
  isTime(v.updatedAt) &&
  Array.isArray(v.versions) &&
  v.versions.every(looksLikeVersion);
const looksLikeFolder = (v: unknown) =>
  isObject(v) && isText(v.name) && nullable(v.parentId, isText) && isTime(v.createdAt) && isCount(v.seq) && (v.deletedAt === undefined || isTime(v.deletedAt));
const looksLikeAssetEntry = (v: unknown) => isObject(v) && isText(v.mime) && isCount(v.bytes) && isCount(v.seq) && isTime(v.createdAt);
const looksLikeMediaEntry = (v: unknown) => looksLikeAssetEntry(v) && isObject(v) && isText(v.sha256);
const looksLikeManifest = (v: unknown): v is Manifest =>
  isObject(v) &&
  isCount(v.seq) &&
  everyValue(v.designs, looksLikeDesignEntry) &&
  everyValue(v.folders, looksLikeFolder) &&
  everyValue(v.assets, looksLikeAssetEntry) &&
  (v.media === undefined || everyValue(v.media, looksLikeMediaEntry));

const looksLikeStoredDesign = (v: unknown): v is StoredDesign => isObject(v) && isCount(v.rev) && isObject(v.design) && nullable(v.thumbnail, isText);
const looksLikeAsset = (v: unknown): v is SharedAsset => isObject(v) && isText(v.mime) && isText(v.base64);
const looksLikeEmail = (v: unknown): v is { userId: string } => isObject(v) && isText(v.userId);

/* ---------------- names ---------------- */

const serverId = (id: string, what: string) => {
  if (!SERVER_ID.test(id)) throw new Error(`not the id of a ${what}`);
  return id;
};
const hexHash = (hash: string) => {
  if (!HEX_HASH.test(hash)) throw new Error("not a hash");
  return hash;
};
const revision = (rev: number) => {
  if (!isCount(rev)) throw new Error("not a revision");
  return rev;
};

const userKey = (id: string) => `users/${serverId(id, "person")}.json`;
const emailKey = (email: string) => `emails/${hashName(email)}.json`;
const sessionKey = (hash: string) => `sessions/${hexHash(hash)}.json`;
const teamKey = (id: string) => `teams/${serverId(id, "team")}.json`;
const codeKey = (hash: string) => `codes/${hexHash(hash)}.json`;
const spaceKey = (space: string) => `spaces/${serverId(space, "space")}`;
const designKey = (space: string, id: string) => `${spaceKey(space)}/designs/${hashName(id)}`;
const assetKey = (space: string, id: string) => `${spaceKey(space)}/assets/${hashName(id)}.json`;
const mediaFolder = (space: string) => `${spaceKey(space)}/media`;
const mediaKey = (space: string, id: string) => `${mediaFolder(space)}/${hashName(id)}.bin`;

/* ---------------- raw: text by name ---------------- */

/** Text kept under names made of the parts above ("users/<id>.json"); what each holds is the business of `KeyedAccounts`. */
interface RawStore {
  get(key: string): Promise<string | null>;
  put(key: string, text: string): Promise<void>;
  /** Writes the text only when nothing is kept under the name yet: false when something is. */
  create(key: string, text: string): Promise<boolean>;
  remove(key: string): Promise<void>;
  /** Removes everything whose name starts with `prefix/`. */
  removeTree(prefix: string): Promise<void>;
  /** The names of the files directly in a folder ("users"), without the folder. */
  list(folder: string): Promise<string[]>;
  checkWritable(): Promise<void>;
  /** Bytes that come as they come, counted and hashed, kept aside in `folder` until `commit` (null: more than `limit`). */
  stage(folder: string, source: AsyncIterable<Buffer | Uint8Array>, limit: number): Promise<StagedMedia | null>;
  /** Puts staged bytes in place under a name. */
  commit(staged: StagedMedia, key: string): Promise<void>;
  drop(staged: StagedMedia): Promise<void>;
  /** The bytes under a name, from the start. */
  stream(key: string): Readable;
}

/** Counts and hashes bytes as they pass, and stops at more than `limit`. */
function counter(source: AsyncIterable<Buffer | Uint8Array>, limit: number) {
  const state = { size: 0, over: false, hash: createHash("sha256") };
  async function* pass() {
    for await (const chunk of source) {
      state.size += chunk.length;
      if (state.size > limit) {
        state.over = true;
        return;
      }
      state.hash.update(chunk);
      yield chunk;
    }
  }
  return { state, pass };
}

/** Reads a record and checks its form: null when there is none, an error when there is one that is not what it should be. */
async function readRecord<T>(raw: RawStore, key: string, looks: (v: unknown) => v is T, what: string): Promise<T | null> {
  const text = await raw.get(key);
  if (text === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`the file of this ${what} is damaged: it is not JSON`, { cause: error });
  }
  if (!looks(value)) throw new Error(`the file of this ${what} is damaged: it does not hold a ${what}`);
  return value;
}

/** The typed records over any raw store; the two storages differ only in where the text goes. */
class KeyedAccounts implements AccountStorage {
  constructor(private raw: RawStore) {}

  async loadUser(id: string) {
    return readRecord(this.raw, userKey(id), looksLikeUser, "person");
  }
  async saveUser(user: UserRecord) {
    return this.raw.put(userKey(user.id), JSON.stringify(user));
  }
  async removeUser(id: string) {
    return this.raw.remove(userKey(id));
  }
  async listUsers() {
    return (await this.raw.list("users"))
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -5))
      .filter((id) => SERVER_ID.test(id));
  }
  async claimEmail(email: string, userId: string) {
    return this.raw.create(emailKey(email), JSON.stringify({ userId: serverId(userId, "person") }));
  }
  async emailOwner(email: string) {
    return (await readRecord(this.raw, emailKey(email), looksLikeEmail, "email"))?.userId ?? null;
  }
  async releaseEmail(email: string) {
    return this.raw.remove(emailKey(email));
  }
  async loadSession(hash: string) {
    return readRecord(this.raw, sessionKey(hash), looksLikeSession, "session");
  }
  async saveSession(hash: string, session: SessionRecord) {
    return this.raw.put(sessionKey(hash), JSON.stringify(session));
  }
  async removeSession(hash: string) {
    return this.raw.remove(sessionKey(hash));
  }
  async loadTeam(id: string) {
    return readRecord(this.raw, teamKey(id), looksLikeTeam, "team");
  }
  async saveTeam(team: TeamRecord) {
    return this.raw.put(teamKey(team.id), JSON.stringify(team));
  }
  async removeTeam(id: string) {
    return this.raw.remove(teamKey(id));
  }
  async loadCode(hash: string) {
    return readRecord(this.raw, codeKey(hash), looksLikeCode, "code");
  }
  async saveCode(hash: string, code: CodeRecord) {
    return this.raw.put(codeKey(hash), JSON.stringify(code));
  }
  async removeCode(hash: string) {
    return this.raw.remove(codeKey(hash));
  }
  async loadManifest(space: string) {
    return (await readRecord(this.raw, `${spaceKey(space)}/manifest.json`, looksLikeManifest, "space")) ?? emptyManifest();
  }
  async saveManifest(space: string, manifest: Manifest) {
    return this.raw.put(`${spaceKey(space)}/manifest.json`, JSON.stringify(manifest));
  }
  async removeDesign(space: string, id: string) {
    await this.raw.removeTree(designKey(space, id));
  }
  async loadVersion(space: string, id: string, rev: number) {
    return readRecord(this.raw, `${designKey(space, id)}/${revision(rev)}.json`, looksLikeStoredDesign, "design");
  }
  async saveVersion(space: string, id: string, rev: number, text: string) {
    return this.raw.put(`${designKey(space, id)}/${revision(rev)}.json`, text);
  }
  async removeVersion(space: string, id: string, rev: number) {
    return this.raw.remove(`${designKey(space, id)}/${revision(rev)}.json`);
  }
  async loadAsset(space: string, id: string) {
    const asset = await readRecord(this.raw, assetKey(space, id), looksLikeAsset, "upload");
    return asset && { mime: asset.mime, base64: asset.base64 };
  }
  async saveAsset(space: string, id: string, asset: SharedAsset) {
    return this.raw.put(assetKey(space, id), JSON.stringify({ mime: asset.mime, base64: asset.base64 }));
  }
  async removeAsset(space: string, id: string) {
    return this.raw.remove(assetKey(space, id));
  }
  async stageMedia(space: string, source: AsyncIterable<Buffer | Uint8Array>, limit: number) {
    return this.raw.stage(mediaFolder(space), source, limit);
  }
  async commitMedia(space: string, id: string, staged: StagedMedia) {
    return this.raw.commit(staged, mediaKey(space, id));
  }
  async dropMedia(staged: StagedMedia) {
    return this.raw.drop(staged);
  }
  mediaStream(space: string, id: string) {
    return this.raw.stream(mediaKey(space, id));
  }
  async removeMedia(space: string, id: string) {
    return this.raw.remove(mediaKey(space, id));
  }
  async removeSpace(space: string) {
    return this.raw.removeTree(spaceKey(space));
  }
  async checkWritable() {
    return this.raw.checkWritable();
  }
}

/* ---------------- in memory ---------------- */

class MemoryRaw implements RawStore {
  /** Text, as it would be on disk: nothing is shared with a caller. */
  readonly files = new Map<string, string>();
  async get(key: string) {
    return this.files.get(key) ?? null;
  }
  async put(key: string, text: string) {
    this.files.set(key, text);
  }
  async create(key: string, text: string) {
    if (this.files.has(key)) return false;
    this.files.set(key, text);
    return true;
  }
  async remove(key: string) {
    this.files.delete(key);
    this.bytes.delete(key);
  }
  async removeTree(prefix: string) {
    for (const key of [...this.files.keys()]) if (key.startsWith(`${prefix}/`)) this.files.delete(key);
    for (const key of [...this.bytes.keys()]) if (key.startsWith(`${prefix}/`)) this.bytes.delete(key);
  }
  /** Bytes (clips and sounds), and what is being received. */
  readonly bytes = new Map<string, Buffer>();
  private staged = new Map<string, Buffer>();
  async stage(_folder: string, source: AsyncIterable<Buffer | Uint8Array>, limit: number) {
    const { state, pass } = counter(source, limit);
    const chunks: Buffer[] = [];
    for await (const chunk of pass()) chunks.push(Buffer.from(chunk));
    if (state.over) return null;
    const handle = randomBytes(8).toString("hex");
    this.staged.set(handle, Buffer.concat(chunks));
    return { handle, size: state.size, sha256: state.hash.digest("hex") };
  }
  async commit(staged: StagedMedia, key: string) {
    const bytes = this.staged.get(staged.handle);
    this.staged.delete(staged.handle);
    if (!bytes) throw new Error("no such received clip");
    this.bytes.set(key, bytes);
  }
  async drop(staged: StagedMedia) {
    this.staged.delete(staged.handle);
  }
  stream(key: string) {
    return Readable.from([this.bytes.get(key) ?? Buffer.alloc(0)]);
  }
  async list(folder: string) {
    const names: string[] = [];
    for (const key of this.files.keys()) {
      if (!key.startsWith(`${folder}/`)) continue;
      const rest = key.slice(folder.length + 1);
      if (!rest.includes("/")) names.push(rest);
    }
    return names;
  }
  async checkWritable() {}
}

export class MemoryAccounts extends KeyedAccounts {
  private memory: MemoryRaw;
  constructor() {
    const memory = new MemoryRaw();
    super(memory);
    this.memory = memory;
  }
  /** For tests: the text kept under a name, to look at it or to damage it. */
  rawText(key: string): string | undefined {
    return this.memory.files.get(key);
  }
  setRawText(key: string, text: string): void {
    this.memory.files.set(key, text);
  }
  rawKeys(): string[] {
    return [...this.memory.files.keys()];
  }
}

/* ---------------- in files ---------------- */

const PART = /^[A-Za-z0-9_.-]{1,128}$/;

class FileRaw implements RawStore {
  constructor(private dir: string) {}

  /** The path of a name. Every part was made above from a checked id or a hash; this checks once more, so no name leaves the folder. */
  private path(key: string): string {
    const parts = key.split("/");
    if (!parts.every((part) => PART.test(part) && part !== "." && part !== "..")) throw new Error("not a name the accounts keep");
    return join(this.dir, ...parts);
  }

  async get(key: string): Promise<string | null> {
    try {
      return await readFile(this.path(key), "utf8");
    } catch (error) {
      // Only "there is no such file" means that there is no such record; a disk that fails is a problem of the server.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  /** Writes the text under a name of its own beside the target, flushed, so that what is moved or linked into place is whole. */
  private async temp(key: string, text: string): Promise<{ folder: string; target: string; temp: string }> {
    const target = this.path(key);
    const folder = join(target, "..");
    await mkdir(folder, { recursive: true });
    const temp = `${target}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(temp, text, { encoding: "utf8", flag: "wx", flush: true });
    return { folder, target, temp };
  }

  async put(key: string, text: string): Promise<void> {
    const { folder, target, temp } = await this.temp(key, text);
    try {
      await rename(temp, target);
      await this.syncDirectory(folder);
    } finally {
      await rm(temp, { force: true });
    }
  }

  /**
   * A hard link fails when the target exists, and is made at once or not at all: two sign-ups for one email at the same moment
   * both write their whole file, and the file system lets exactly one of them have the name.
   */
  async create(key: string, text: string): Promise<boolean> {
    const { folder, target, temp } = await this.temp(key, text);
    try {
      await link(temp, target);
      await this.syncDirectory(folder);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    } finally {
      await rm(temp, { force: true });
    }
  }

  async remove(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  async removeTree(prefix: string): Promise<void> {
    await rm(this.path(prefix), { recursive: true, force: true, maxRetries: 3 });
  }

  async list(folder: string): Promise<string[]> {
    try {
      return await readdir(this.path(folder));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async syncDirectory(folder: string): Promise<void> {
    // Windows exposes file flush but does not let Node open a directory for fsync.
    if (process.platform === "win32") return;
    const dir = await open(folder, "r");
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  }

  async checkWritable(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const probe = join(this.dir, `.health-${randomBytes(8).toString("hex")}`);
    try {
      await writeFile(probe, "", { flag: "wx", flush: true });
    } finally {
      await rm(probe, { force: true });
    }
  }

  /** Received into `<random>.tmp` in the folder, flushed, then renamed into place by `commit`. */
  async stage(folder: string, source: AsyncIterable<Buffer | Uint8Array>, limit: number): Promise<StagedMedia | null> {
    const dir = this.path(folder);
    await mkdir(dir, { recursive: true });
    const handle = join(dir, `${randomBytes(8).toString("hex")}.tmp`);
    const { state, pass } = counter(source, limit);
    try {
      await pipeline(Readable.from(pass()), createWriteStream(handle, { flags: "wx", flush: true }));
    } catch (error) {
      await rm(handle, { force: true });
      throw error;
    }
    if (state.over) {
      await rm(handle, { force: true });
      return null;
    }
    return { handle, size: state.size, sha256: state.hash.digest("hex") };
  }

  async commit(staged: StagedMedia, key: string): Promise<void> {
    const target = this.path(key);
    await rename(staged.handle, target);
    await this.syncDirectory(join(target, ".."));
  }

  async drop(staged: StagedMedia): Promise<void> {
    await rm(staged.handle, { force: true });
  }

  stream(key: string): Readable {
    return createReadStream(this.path(key));
  }
}

export class FileAccounts extends KeyedAccounts {
  constructor(dir: string) {
    super(new FileRaw(dir));
  }
}
