# Accounts, teams and sync

The design that the multi-user work follows: accounts with email and password on Craftly's own server, designs that sync to the
server and open on any device, and teams with shared folders and roles. It builds on the live server. The app keeps working
fully offline and without any server: none of the account code is loaded, and no request goes out, while a person is signed out.

Status: being built on the branch `multi-user`, in the order of [Build order](#build-order). This page is updated as each step lands.
Steps 1 to 7 (the server: HTTP helpers, passwords, storage, sign-up and sessions, codes and the operator's script, spaces, teams)
are built and tested (2026-11-17); where the code differs from the first design it says so in [As built](#as-built-steps-1-to-7).
Step 14 on the server (team designs live: bound rooms, joining with a session, writing back, removal) is built and tested
(2026-11-17), see [As built (step 14, server)](#as-built-step-14-server). Steps 8 to 13 and 15 (the client: the database step,
sync, the screens, team designs live from Share, the browser journey) are built and tested (2026-11-17), see
[As built (steps 8–13, 15)](#as-built-steps-813-15).

## Server

**Mounting.** The code lives in `src/server/accounts/` and is switched on with `ACCOUNTS=1` in `main.ts`; without it the server is
exactly what it was. `createLiveServer` takes an optional `accounts?: AccountsOptions`, and its HTTP handler calls
`cloudRoutes(req, url, res)` before the final 404. The HTTP helpers both route sets need (`reply`, `readBody`, `cors`, `foreign`,
the asset check of `roomAssetIn`) live in `src/server/http.ts`.

**Storage.** The `FileStorage` style: whole files written to a temporary name and renamed, ids checked against a pattern. An
`AccountStorage` interface with `MemoryAccounts` and `FileAccounts` (`accounts/storage.ts`), under `DATA_DIR/accounts/`:

| Path | Holds |
| --- | --- |
| `users/<userId>.json` | `{id, email, name, pw: "scrypt$15$8$1$<salt>$<hash>", recoveryHash, disabled, createdAt, sessions: {sessionId: sha256(token)}, teams: [teamId]}` |
| `emails/<sha256(email)>.json` | `{userId}`, written whole and hard-linked into place, so the file system refuses a second account with one email |
| `sessions/<sha256(token)>.json` | `{id, userId, device, createdAt, lastUsedAt, expiresAt}` |
| `teams/<teamId>.json` | `{id, name, createdAt, members: {userId: role}, invites: [{id, hash, role, usesLeft, expiresAt, createdAt}]}` |
| `codes/<sha256(code)>.json` | a sign-up code `{kind: "signup", usesLeft, expiresAt}`, an invite `{kind: "invite", teamId, inviteId}` or a reset `{kind: "reset", userId, expiresAt}` |
| `spaces/<spaceId>/manifest.json` | `{seq, designs: {id: {rev, metaSeq, seq, title, folderId, starred, trashedAt, deletedAt?, bytes, updatedAt, versions: [{rev, bytes, at}]}}, folders: {id: {name, parentId, createdAt, seq, deletedAt?}}, assets: {id: {mime, bytes, seq, createdAt}}}`, written whole through a queue per space |
| `spaces/<spaceId>/designs/<sha256(id)>/<rev>.json` | `{rev, thumbnail, design}`: the current revision and the 10 before it, each a file |
| `spaces/<spaceId>/assets/<sha256(id)>.json` | an upload, `{mime, base64}` |

A **space** is a person's own (its id is the user's id) or a team's (the team's id); both are the same code.

**Passwords.** `crypto.scrypt`, N = 2^15, r = 8, p = 1, a 16-byte salt and a 64-byte key, `maxmem` 64 MiB (Node's 32 MiB default
fails at these parameters). The parameters are in the stored string, so they can be raised later. At most 4 hashes at once
(`HASH_CONCURRENCY`), 503 above that. Passwords are NFC-normalised, 10 to 256 characters, compared with `timingSafeEqual`; a
sign-in for an unknown email hashes a dummy password, so the time it takes says nothing.

**Sessions are bearer tokens, not cookies.** The app and the server are on different sites in development and in most
deployments (5173 and 8787), and cookies across sites need `SameSite=None`, which Safari and Chrome block as third-party cookies.

- The token is 32 random bytes in base64url; the server keeps only its SHA-256.
- 30 days, sliding, 180 days at most; at most 20 sessions a person (the oldest goes).
- The browser keeps it in the IndexedDB `meta` store under `cloudSession`. A backup leaves it out.
- No CSRF: the browser never attaches the token by itself. The `foreign()` Origin check stays.
- CORS allows the `authorization` header, so requests are preflighted; `ALLOW_ORIGIN` lists the app's origin.
- On a WebSocket the token goes in the `join` message, never in the address (the rule keys follow today).
- CSP: only `connect-src`, which `VITE_CRAFTLY_CSP_CONNECT` already adds. Pictures are fetched with the token and shown as `blob:`
  or `data:` addresses, which `img-src` allows. The service worker ignores other origins, and on the app's own origin it leaves
  every request with a token or `cache: "no-store"` to the network and stores no answer marked `cache-control: no-store`, so answers
  are never cached either way.

**Rate limits** (`hourlyLimit`): failed sign-ins 20 an hour per address and 10 per account and address, with an account-wide cap
of 100 so that one address cannot lock someone out; sign-ups 5 an hour per address; invite and reset codes 20. A refusal is 429
with `Retry-After`.

**Without email.** There is no mail server: the email is a unique login name, never verified.

- `SIGNUP` = `invite` (default), `open` or `closed`. With `invite`, signing up needs a team's invite code or a sign-up code from
  an administrator.
- At sign-up a recovery code is shown once (128 bits, kept as SHA-256); with it a person resets their own password.
- `scripts/accounts.mjs` (with `ADMIN_KEY`): `create-signup-code`, `list`, `reset <email>`, `disable`, `enable`, `delete --yes`.
  `reset` prints a one-time link `…#/reset/<code>` valid for 24 hours. Any reset ends every session of that person. The script
  asks the running server (`/api/admin/accounts`), it does not open `DATA_DIR` itself (see [As built](#as-built-steps-1-to-7)).

**Endpoints** (JSON; an error is `{error, code}`):

| Method and path | Does |
| --- | --- |
| `POST /api/auth/signup {email, password, name, code?}` | 201 `{token, user, recoveryCode}`; 400, 403 `signup-closed`, 409 `email-taken`, 429 |
| `POST /api/auth/signin {email, password, device}` | `{token, user}`; 401 `wrong` for every failure, 429 |
| `POST /api/auth/signout` | ends this session |
| `GET /api/me` | the person, their teams with roles, their spaces |
| `GET /api/me/sessions`, `DELETE /api/me/sessions/:id` | devices signed in |
| `POST /api/me/password {old, new}` | changes the password |
| `POST /api/auth/reset {code` or `email + recoveryCode, newPassword}` | resets it |
| `POST /api/teams {name}`, `GET` / `PATCH` / `DELETE /api/teams/:t` | teams; `GET` gives the members with their names and roles |
| `PUT /api/teams/:t/members/:u {role}`, `DELETE /api/teams/:t/members/:u` | roles, removing, leaving |
| `POST /api/teams/:t/invites {role, uses, hours}` | `{id, code}`, the code shown once |
| `GET /api/teams/:t/invites`, `DELETE /api/teams/:t/invites/:id` | invites without their codes; revoking |
| `POST /api/invites/redeem {code}` | joins a team |
| `GET /api/spaces/:s/changes?since=&limit=500` | `{cursor, more, designs, folders, assets}` |
| `GET /api/spaces/:s/designs/:id` | `{design, rev, thumbnail}` |
| `PUT /api/spaces/:s/designs/:id {baseRev or null, design, thumbnail?}` | `{rev}`; 409 `conflict {rev}`, 409 `exists`, 409 `deleted`, 409 `live {room}` (step 14), 413 `quota` |
| `PATCH /api/spaces/:s/designs/:id/meta {title?, folderId?, starred?, trashedAt?}` | per field, last write wins, never a conflict |
| `DELETE /api/spaces/:s/designs/:id` | a tombstone, kept 90 days |
| `GET …/designs/:id/versions`, `POST …/designs/:id/restore {rev}` | revisions |
| `PUT` / `GET /api/spaces/:s/assets/:id`, `POST …/assets/missing {ids}` | uploads, with the checks room pictures get and `svgProblem` |
| `PUT` / `GET` / `HEAD /api/spaces/:s/media/:id` | clips and sounds, as themselves and streamed ("Clips and sounds" below) |
| `PUT` / `DELETE /api/spaces/:s/folders/:id` | folders |
| `POST /api/spaces/:s/designs/:id/live` | the live room of a team design, made when needed |

**Roles** (one pure table, `can(role, action)` in `accounts/roles.ts`): an **owner** manages members, invites, the team's name,
deleting the team and deleting forever, and a team always keeps one; an **editor** makes, edits, trashes and restores designs
and folders and uploads; a **viewer** reads and downloads. The shared folders are the folders of the team's space; there are no
per-folder permissions in this version.

**Limits.** A design 16 MiB (`maxDesignBytes`) and it passes `checkDesign` (one carrying a `live` field is refused); a thumbnail
256 KB matching `^data:image/(jpeg|png);base64,`; an upload 9 MiB; a space `SPACE_QUOTA_MB` (1024) and 10,000 designs; 1,000
folders; 20 teams a person; 100 members a team; 50 open invites; `MAX_ACCOUNTS`; a title 200 characters; a name `cleanName`, 40.

**Team designs live, without links.** `POST …/live` gives the room bound to that design (`RoomRecord.bound = {space, designId}`,
its key hashes random and never handed out). `join` takes a `session` in place of a `key`, and the member's role decides: owner
and editor edit, a viewer views. While a room is bound, `PUT` on its design answers 409 `live` and the client joins the room;
when the room unloads, its design is written back as the next revision. Removing a member or lowering their role closes their
sockets with 4003. Sharing by link with keys works as before.

## As built (steps 1 to 7)

The server side is in `src/server/http.ts` (the helpers both route sets use) and `src/server/accounts/`: `passwords.ts`,
`storage.ts`, `roles.ts`, `context.ts` (settings, refusals, strict reading of bodies, sessions, limits, a queue per record),
`auth.ts`, `spaces.ts`, `teams.ts`, `admin.ts`, and `index.ts` (the routes). `main.ts` reads `ACCOUNTS`, `SIGNUP`, `MAX_ACCOUNTS`
and `SPACE_QUOTA_MB`; with `ACCOUNTS` off the server is what it was (a test checks the 404s and the preflight). Where the code
differs from the design above, and why:

- **Every refusal has a code**: `bad-request` (400), `too-big` (413, and the connection is dropped), `session` (401: no token, a
  token that is not one, expired, signed out, revoked, or its person disabled), `wrong` (401), `forbidden` (403: a member whose
  role may not), `origin` (403), `not-found` (404, also for a space or team the person is not in), `deleted` (404 on reading a
  tombstone, 409 on writing one), `method` (405 with `Allow`), `rate` (429 with `Retry-After`), `busy` (503 with `Retry-After: 1`),
  `server` (500), and the ones of the table: `signup-closed`, `code-wrong` (403), `email-taken`, `full` (403, `MAX_ACCOUNTS`),
  `team-full` (409, a team's members: redeeming an invite, or signing up with one), `newer` (400: a design from a newer Craftly,
  from `migrateDesign`), `conflict`, `exists`, `quota`, `last-owner`, `too-many-teams`, `too-many-invites`, `live`, `not-live`
  (409).
- **Who asks is asked again when a write takes its turn.** A route checks the session and the role before it reads a body (up
  to 16 MB, which may take minutes), and every change of a space checks them again first thing in the space's queue (`stillMay`
  in `spaces.ts`), without counting it as a use of the session. So a member removed or lowered, a session ended, or a team
  deleted while a body was on its way writes nothing (401 `session`, 404 `not-found` or 403 `forbidden`), and a team's deletion,
  whose space is removed in that same queue, leaves no file of the space behind.
- **A sign-up with an invite of a full team makes no account** (409 `team-full`): the team's place is checked in the team's
  queue before the account is made, and the queue is held until the person is in the team, so two sign-ups with two invites
  never both take the last place, and an invite's use is spent by every account it makes.
- **The routes are asked before the rooms' Origin check, not just before the final 404**, so that the accounts refuse a page of
  another origin themselves, for every method including GET (a person's own data), with the code `origin`. The rooms answer as
  before. The preflight names `authorization` and `PATCH` only when accounts are on.
- **A person's record lists their sessions and their teams.** Capping sessions at 20, listing them and ending all of them at a
  reset would otherwise mean reading every session file of the server, and `GET /api/me` every team. A session file that its
  person's list does not name lets nobody in (the list is written first on sign-in, and emptied first on sign-out and reset). The
  list of teams is only an index: the team's record decides every request, and the index may name a team the person has left,
  never miss one they are in.
- **One table of codes, `codes/<sha256(code)>`,** for sign-up codes, invites and resets: redeeming an invite must find its team
  from the code alone, without reading every team. The team's record still holds its invites (with the same hash) and decides:
  an invite code whose invite was revoked, used up or expired is not good. Codes, tokens and recovery codes are 128 bits (tokens
  256), base64url, kept only as SHA-256.
- **Each revision of a design is a file, the current one too** (`designs/<sha256(id)>/<rev>.json`), and the manifest says which
  is current. A save writes the new revision and then the manifest, so a crash between the two leaves the revision before
  current and whole; with one file for the current design a crash could leave a manifest and a design that disagree. The id is
  hashed into the name because the app's ids (`isSafeId`) may hold a colon, which Windows refuses in a file name, and may differ
  only in capitals.
- **The email file is written whole and hard-linked into place** rather than created with `wx`: the link fails when the name
  exists, exactly as `wx` does, and a crash cannot leave an empty file that blocks the email for good. A sign-up writes the
  person first and the email second, so a crash leaves a person nobody can sign in as (the operator's list leaves them out),
  never an email that names nobody.
- **Details belong to the manifest.** A new design's title, folder, star and trash time are taken from the design; after that
  `PUT` changes the content only, `PATCH …/meta` the details (each field, last write wins), and `GET` gives the content with the
  manifest's details over it.
- **A retry gets its answer again**: a `PUT` with `baseRev: null` of the content already there, or with the revision before the
  current one and the content of the current one, answers `{rev}` and not `exists` or `conflict`, so a write whose answer was
  lost on the network does not turn into a conflict copy.
- **`DELETE` of a design is deleting forever (owners; in a person's own space, the person).** It leaves a tombstone in the feed
  and keeps the revisions 90 days, in which an editor can restore one (`POST …/restore`), which makes a new revision. A tombstone
  still counts towards the quota until it is purged; the purge runs with the next change of the space after 90 days. `PUT` on a
  tombstone is 409 `deleted` (a new code): the client sends its copy under a new id.
- **Folders**: `PUT /api/spaces/:s/folders/:id {name, parentId}` (1 to 200 characters; a parent must be a folder of the space,
  and a folder cannot be put inside itself). Removing one is a tombstone; its designs and folders move to the top.
- **Uploads** get the room pictures' check (`checkAsset` in `http.ts`), `svgProblem` for an SVG, and, beyond the design, a check
  that the bytes begin as a picture of the stated type does (PNG, JPEG, GIF, WebP, BMP, AVIF). `checkUpload` itself draws on a
  canvas and cannot run on a server. Uploads count as their base64 length, as a room's do.
- **The changes feed** is `{cursor, more, designs, folders, assets}`: every item with a `seq` after `since`, in order, at most
  `limit` (1 to 500); the cursor is the last `seq` given, or the space's `seq` when nothing more waits. Designs carry their
  details and `rev`, `metaSeq`, `seq`, `updatedAt`, `deletedAt` (or null); not their content.
- **Limits**: failed sign-ins (also wrong old passwords) are counted per address, per account and address, and per account; a
  sign-up counts every attempt; wrong codes (invites, sign-up codes, reset codes, recovery codes) are counted per address and a
  right one is not. At most 4 hashes run at once; more wait (64 at most, 3 s each at most) and are then 503 `busy`. One address
  may have 2 going, and one place is kept for a sign-in from an address the account used lately, for changing a password, and
  for a reset from such an address (`createHasher` in `passwords.ts`). A person who does not exist is checked against a random salt at the
  server's cost, so a sign-in for them takes as long as one with a wrong password.
- **A reset with the recovery code uses it up** and answers a new one; changing the password ends every other session; a
  sign-in's `device` is optional (empty when not given).
- **The operator's script asks the server** (`ADMIN_KEY`, `/api/admin/accounts`, behind the guard of `/api/admin/rooms`) and does
  not open `DATA_DIR`: its changes then take their turn in the same queues as people's requests (a reset never meets a sign-in
  writing the same file), and it works where the operator has no shell on the data's volume. `delete` is refused while the
  account is the last owner of a team with other members, and names the teams.
- **Not built yet**: a session that ends by its time keeps its file (it lets nobody in) until its person signs in with 20
  sessions listed and it is cut; nothing sweeps such files yet, nor the files of sign-up and reset codes past their time.

## As built (step 14, server)

`src/server/live.ts` (bound rooms, the join with a session, writing back, sending people away), `accounts/spaces.ts`
(`openLive`, `writeBack`, `notLive`), `accounts/context.ts` (`LiveHooks`, `sessionOf`, `roleInSpace`, `recheck`), the calls of
`recheck` and `spaceGone` in `teams.ts`, `auth.ts`, `admin.ts` and `endSessions`, and the join in `src/collab/protocol.ts`
(`JoinMsg`, `joinCredential`, `SESSION_TOKEN`). Tests: `accounts/bound.test.ts` (24, real sockets). Where it differs from the
design above, or says more:

- **`POST /api/spaces/:s/designs/:id/live`** (anybody in the space: owner, editor, viewer; no body, or `{}`) answers
  `200 {room, ws: "/ws?room=<room>", role: "edit" | "view"}`. `ws` is the socket's path on the server that answered, which the
  client makes into an address the way it makes a link's (`websocketUrl`). No key is ever in an answer. 404 `not-found` for a
  design that is not there or a space the person is not in, 404 `deleted` for a tombstone, 503 `full` at `MAX_ROOMS`.
- **Only those who may write make the room; a viewer joins one that is open.** While a bound room is in memory its space
  refuses writes of the design, which a viewer must not be able to cause. So a viewer's `POST …/live` answers the room only while
  it is in memory or being made (somebody who may edit opened it), and 409 `not-live` otherwise (the client shows the space's
  copy). And a viewer's seat does not keep the room in memory: when nobody but viewers is left (a socket not seated yet counts
  as somebody), it leaves after `idleCloseMs` as an empty room does, is written back, and the viewers are sent `denied
  not-found` and closed with 4004; asking again then answers `not-live`. This was chosen over keeping viewers' rooms apart:
  it is one rule (`held` in live.ts), and nothing a viewer does can hold up an editor's sync.
- **The room's id is derived, not random**: base64url of SHA-256 of `"craftly bound room\n<space>\n<designId>"`. So the same
  design always finds the same room, also after a restart and also when its record was kept because writing back failed (below).
  The id is no secret here: getting in takes a member's session. Its `editHash` and `viewHash` are of random keys that are made,
  hashed and forgotten, it has no `ownerHash` (nobody "stops sharing" it), and a join with a key is refused in a bound room before
  the key is even compared. A join with a session is refused in a room of a link. Both are `denied no-access`, close 4003.
- **`RoomRecord.bound = {space, designId, rev, roomRev, title}`**: beside the space and design, the revision of the space the room
  was made from or last written back as, the room's revision at that moment (the room has something to write back when its
  revision is past `roomRev`), and its title then. The room's design keeps the design's id (not the room's) and its details from
  the manifest.
- **The join** is `{t: "join", client, session, features?}`, the token as it is sent in `authorization`, never in an address.
  `joinCredential` (protocol.ts) reads a join strictly: a `key` (text of 1 to 200 characters) or a `session` (43 characters of
  base64url) and then no `key` field at all; anything else, `session: null` included, is no credential (`no-access`). A join
  without `session` is read exactly as before. The server looks the person up as `authenticate` does (the session there, not
  past its time, still listed, the person not disabled) and takes their role in the room's space now: owner and editor edit,
  viewer views, anybody else is refused as a wrong key is. What the browser sends while it is looked up waits (64 messages at
  most) and is handled in order after the welcome. If who may be in bound rooms changes while a join looks somebody up, it looks
  again (five times at most, then refuses), so a removal in the middle is never missed. A room's pictures
  (`/api/rooms/:id/assets/:asset`) take the session as `Authorization: Bearer` in a bound room, and never `x-craftly-key`.
- **While the room is in memory, or being made,** the space answers `PUT`, `POST …/restore` and `DELETE` of that design with
  409 `live {room}` (the check runs in the space's queue, and the binding reads the design's revision through that queue after
  it is marked, so no write slips in between). `PATCH …/meta` works. Restore and delete are refused too because the write-back
  would otherwise put the room's design over them; trashing is a detail and works. A room's record kept on the disk and not in
  memory (writing it back failed, or the server stopped without closing) does not hold the space's writes off: that would let a
  record nobody opens again pin its design for good, and cost a look at the disk at every write; instead it can never write over
  what the space took meanwhile (below).
- **Writing back** happens when the room leaves memory (`idleCloseMs` after the last person leaves) and when the server stops:
  through the space's queue, checked as a `PUT` is (`checkDesign`, `migrateDesign`, the size, the quota; a `live` field is
  dropped), as the next revision, with the comments the design carries. Nothing is written when the room did not change, or
  when its content is the current revision's. The details stay the manifest's, except the title when it was changed in the
  room; the thumbnail is the one of the revision before (the server cannot draw one). Then the room's record is removed, and the
  next `POST …/live` makes it again from the space. When writing back fails (a full space, a refused design), the room's record
  stays on the disk with its copy, the failure is counted and logged, and the space takes writes again; the next `POST …/live`
  finds that record and opens it when the space is still at the revision it was made from (its copy is newer), and it is
  written back when it next leaves memory.
- **A room never writes over a newer revision.** `bound.rev` is the revision the room was made from or last written back as.
  When the space has moved on past it (it took writes while the room's record was only on the disk), the room's design is kept
  as a new design of the space instead, with a new id and the title "Title (edited live)" (the server's English, as a browser's
  conflict copy is "Title (edited on Device)"), in the design's folder, and the room is removed; nothing is written when its
  content is the space's already. `POST …/live` does this before opening such a record, so the room people join is made from
  the space's newer revision. A record whose design is gone (deleted for good, or not in the space) or whose space is gone is
  dropped without writing back (`write_backs_dropped_total`), never tried again for ever; deleting a design for good, a team or
  an account also drops its rooms kept on the disk, so they no longer count towards `MAX_ROOMS`. Expiry (`ROOM_TTL_DAYS`) never
  removes a bound room: the sweep loads it, and leaving memory writes it back.
- **Sending people away**: removing a member, lowering them to viewer, ending a session (sign-out, `DELETE /api/me/sessions/:id`),
  a reset or a new password (which end sessions), and disabling or deleting an account look up again every socket of that person
  (or every socket of that space) that came in with a session; one whose session no longer lets them in, or that edited and may
  now only look, is sent `denied no-access` and closed with 4003. **Closing was chosen over downgrading** an editor to view: the
  room (`src/collab/room.ts`) keeps a member's role from their join and has no way to change it, and a socket that keeps an
  edit role it no longer has is the one thing this must never allow; the browser joins again and is welcomed as a viewer. A
  raise sends nobody away. A lookup that fails sends the socket away too. Deleting a team (or an account with its own space)
  sends everybody in the space's bound rooms away the same way and removes the rooms without writing back. A session that runs
  out by its time (30 days without use, 180 at most) is found by looking every seat up again every `seatCheckEveryMs` (5
  minutes), and its socket is sent away the same way. Looking again is not a use of the session (a browser's own requests are,
  its sync every minute), so a socket alone does not keep a session alive.
- **Metrics** (`craftly_live_`): `bound_rooms_made_total`, `session_joins_total`, `session_joins_refused_total`,
  `write_backs_total`, `write_back_failures_total`, `write_back_copies_total`, `write_backs_dropped_total`,
  `write_back_files_refused_total`, the gauge
  `bound_rooms_in_memory`, and the reason `revoked` of `connections_closed_total`.
- **The client** is built: joining with the session, "Edit live with your team" in Share, the viewer's read-only mode
  (`src/editor/live/teamLive.ts`, `TeamLiveSection.tsx`; checked in the browser by `e2e/accounts.cjs`).
- **Not built**: a bound room
  removed by the operator (`DELETE /api/admin/rooms/:id`) is not written back. A room kept on the disk whose design or space went
  while the server was not running (no hook told it) counts towards `MAX_ROOMS` until it is next loaded (a join, `POST …/live`,
  the sweep) and dropped.

## As built (steps 8–13, 15)

The client: `src/core/persistence.ts` (step 2), `src/core/library.ts` (`space`, tombstones, `setNewRecordSpace`), `src/cloud/`
(`state.ts`, `api.ts`, `validate.ts`, `account.ts`, `syncPlan.ts`, `sync.ts`, `syncStatus.ts`, `locks.ts`),
`src/dashboard/account/` (the screens), `src/editor/live/teamLive.ts` and `TeamLiveSection.tsx` (team designs live), and the join
with a session in `src/collab/session.ts` and `live.ts`. Tests: `src/core/schema/dbStep2.dom.test.ts`, `persistedShapes.test.ts`,
`src/cloud/syncPlan.test.ts`, `validate.test.ts`, `inviteLink.test.ts`, `sync.dom.test.ts` (a real server on port 0), `signOutNoBlobs.dom.test.ts`,
`backup.dom.test.ts`, `src/editor/live/teamLive.dom.test.ts`, `src/editor/EditorLock.test.tsx`,
`src/dashboard/account/screens.test.tsx` and `Shell.test.tsx` (a real server too), and `e2e/accounts.cjs`. Where it differs from
the design above, or says more:

- **What is loaded while nobody is signed in.** Not nothing at all: `src/cloud/state.ts` (it reads the one record `cloudSession`
  when the app starts, keeps the session and the space being shown, and filters the dashboard's listings), `syncStatus.ts` and the
  status button (which draws nothing), and `src/dashboard/account/dialogState.ts`. The API, the sync engine, the account code
  and every account screen are loaded only when a person opens one or is signed in, and no request goes out; `e2e/accounts.cjs`
  checks both in Chrome. The account menu offers **Sign in** and **Create account** at its top while nobody is signed in: the one
  thing that is new without an account, and it asks nothing of anybody.
- **What else belongs to the device** (none of it in a backup): `meta` keys `cloudCursors` (the cursor of each space's feed) and
  `cloudFolders` (the folders of each space as last in step). `cloudSession` also keeps the teams and the space being shown, so
  that the dashboard lists them offline.
- **Folders** are synced by state too, from `cloudFolders` and not from the `sync` store: a folder changed here is sent first
  (`PUT`, parents before children; one removed here is `DELETE`d), then the feed's folders are taken. Last write wins, as for
  details. Moving designs in moves the folders they are in (and their parents).
- **A detail is not the content.** Renaming, starring, moving or trashing a design that is in step keeps it in step (`updateSummary`
  carries `syncedRevision` forward in the same transaction), and the details are compared with `syncedMeta` field by field. So a
  star on one device and an edit on another is no conflict, and a title changed in the editor goes as content and as a detail.
- **Same content, no copy.** A conflict whose two sides have the same pages, size and comments (what a team's room wrote back, an
  edit made twice) takes the server's revision without making a copy.
- **A server tombstone** moves a clean design to the Trash here **as a design of this device only** (its `space` and record are
  removed): restoring it from the Trash does not send it back. A design dirty here becomes a new design with a new id (its
  versions follow it), as does one the server answers `exists` or `deleted` for.
- **A design here under the id of one of the server, not of that space** (a backup restored on a new device keeps the ids and drops
  the space; a team left and joined again keeps its designs here as the person's own) is found before the plan, never written
  over and never left to hold the space's cursor: a design of this device only with the same title and content is the same design,
  and the server's is taken in its place; any other one, or one of another space that its server never had, gets a new id (it
  stays what it was, with its versions) and the server's comes under the id. A design of another space that its server has keeps
  its id: the sync status says so ("could not be brought to this device") and that one design of the feed waits.
- **Leaving a team** forgets the team's cursor and its folders as last in step (`cloudCursors`, `cloudFolders`), so that joining
  it again reads its feed from the start and does not take the folders kept here for folders deleted here.
- **Deleting for good** is an owner's (`DELETE` answers 403 to an editor of a team): an editor's deletion removes the design here
  only, and the space's feed is read again from the start so that it comes back. A design deleted here whose server copy changed
  meanwhile comes back too, rather than deleting somebody else's work.
- **A viewer** of a team sends nothing: their edits here are not sent and not counted as waiting, a conflict takes the team's
  design, and the editor opens the team's designs read-only (the mode of a view link), live or not. New designs go into the space
  being shown only for an owner or editor; otherwise into the person's own.
- **`409 live`** on a `PUT` leaves the design waiting; when the room has written it back, the feed brings the new revision and the
  conflict is resolved as above (usually as the same content). Meanwhile the status is not "Synced": a run that met `409 live`
  (and no problem) says "N changes waiting: … being edited live" (`state: "live"`, `SyncReport.live`), and sets no new "Last
  synced". It never deadlocks: the room leaves memory `idleCloseMs` after the last person leaves and writes back; and a member who
  wants in sooner presses Edit live, which keeps the edit as a copy (below).
- **Leaving a team, or being removed:** the team's designs and folders stay on the device as the person's own (no `space`), with
  the next sync after the server stops listing the team. Copies already there cannot be taken back, as the design says.
- **The locks.** `craftly-sync` is taken by each run with `ifAvailable` (a tab that finds it held skips that run), rather than held by
  one leader tab for its life; the status in a tab that did not run is that of its own last run. Where a browser has no Web Locks
  (and in the tests) the locks hold within the page only. The editor holds `craftly-design-<id>` from opening a design until its
  last save after closing it, and reads the design only once it holds it (or after 2 s all the same, where Web Locks are slow or
  missing), so that a write of sync under way ends first; every write of sync to a design takes that lock with `ifAvailable` too,
  and a design held is skipped (the space's cursor stays where it was, so its changes are read again).
- **Team designs live.** "Edit live with your team" first saves and sends the design if it waits (`sendOne`, which may, because
  only this editor holds it), so that the room is made from it. **When the server refuses it because the team has the design open
  live** (409 `live`: a member edited it before pressing Edit live, while the owner was live), the edit is kept as a copy,
  "Title (edited on Device)" in the same space under a new id (`keepAsCopy` in sync.ts: the design as last saved, no sync record,
  sent at once as a new design and otherwise by the next sync), the panel says so in one line (`m.cloud.live.keptCopy`), and the
  room is joined: its welcome replaces the design here with the team's version, and leaving marks it in step as usual. The design
  under the id is not touched meanwhile (the editor holds its lock and its revision). This was chosen over waiting for the room
  (it may stay open for hours) and over making the copy in sync whenever a `PUT` meets `409 live` (that would also copy the
  content of somebody who left a room without the copy being marked in step, which the room writes back as the same content
  anyway). Should the join fail after the copy was made, the design here still waits, and the conflict after the room writes back
  may make a second, identical copy: never a loss. When it cannot be sent otherwise (a conflict, a new id, a full space, a
  refusal, a save that did not finish), the room is not joined: the person is told to close the design and let it sync (a
  conflict then makes its copy as usual). Then `POST …/live` and the join with the session (`Session`/`Live` take `session` in
  place of `key`; the room's pictures go with `Authorization: Bearer`). Sent away (`no-access`, a role lowered or a removal) or a
  room gone (`not-found`), the editor asks for the room again, three times at most, and joins with the role it is given. A
  viewer who asks while nobody who may edit has the room open (409 `not-live`, also after the last editor left and the room
  closed with 4004) sees the space's copy, read-only, with a note saying why, and no error; leaving a room keeps a viewer's
  read-only mode. A room's "Title (edited live)" copy comes with the feed as any new design does. When live editing stops, the copy here is marked in step (the room writes it back itself) only when the room was joined, every edit
  got there, and the content here, once its last save is written, is the room's; otherwise it stays to be sent, and sync takes the
  same content on both sides without a copy. While the design is live with the team, the top bar shows the Live badge (as for a
  link), and the Share panel offers no link session beside it ("Start live session" is hidden: it would be a second room of the
  same design). The panel says that members are live once they press "Edit live with your team", not when they open the design.
- **The name in a team's room** is the account's: the server takes it with the role when a session joins (`roleInSpace` gives
  `name`), and the room (`Room.join(…, name)`) passes on that name, made into one presence may say (`cleanName`), for every
  presence of that seat, over whatever the browser says (a viewer's too, and after a join again). A join with a key names itself
  as before.
- **Signing out** sends what waits, ends the session on the server when it can, and then removes the account's designs (with
  their versions), folders and the uploads of the account that no remaining design uses, or keeps them as designs of this device
  only. The dialog offers keeping them, ticked, when something could not be sent. What still waits after that last sync (it
  failed, another tab was syncing, an editor has the design open) is counted again and always kept, as designs of this device
  only with their folders and uploads, and a note says how many. Uploads put back are stored as the browser can keep them (their
  bytes where the database keeps no Blob).
- **An invite link** is `#/invite/<code>.<server>` of the page that made it (`src/cloud/inviteLink.ts`), `<server>` the account
  server's address in base64url, as a live link carries its server. All of it is after the `#`, which a browser sends to no server
  and puts in no Referer, so the code reaches only the account server, in the body of the sign-up or redeem. It is read strictly
  on arrival (the code as the server makes them, the server as `normalizeAccountServer` takes a typed one: http or https, no user,
  query or hash), else "This link is not an invite"; the sign-up form starts with that server over the build's or a remembered
  one, shows its host plainly ("The team is on host.", "Server: host" with Change server), and asks for no address. Signed in on
  another server, the page says so and offers no join. A link of before, `#/invite/<code>`, still works and names no server: the
  person types it unless the build names one (`VITE_CRAFTLY_ACCOUNT_SERVER`). A server typed in or taken from a link is
  remembered in `localStorage` (`craftly.account.server`) for the next sign-in once the form is sent.
- **The device's name** ("Chrome on Windows") is made from the browser's user agent, for the list of devices and "(edited on …)".
- **Not built:** restoring a server revision from the app (the endpoints are there), a list of a team's designs on the server that
  are not on the device yet beyond what sync brings, the operator's reset in the journey (the reset page is there; no test drives it), and a check of the sync lock across tabs in a real browser (the journey uses one tab per device).

## Sync

**On the device.** `DB_STEPS` step 2: a store `sync` keyed by design id, `{space, serverRev, syncedRevision, syncedMeta,
tombstone?}`; optional `space?` on `DesignSummary`, `Folder` and `Asset` (optional additions under MIGRATIONS.md: no format
version, recorded in `persistedShapes.test.ts`). The `sync` store belongs to the device and is not in backups.

**By state, not by a log of operations.** A design is dirty when `summary.revision !== syncedRevision`, its details when the
summary differs from `syncedMeta`. What waits to be sent is the dirty rows and the tombstones, so it survives reloads and cannot
grow without end.

**The engine** (`src/cloud/sync.ts`). One tab syncs, holding the lock `craftly-sync`. It runs when the browser comes online, when
the tab comes into view, 3 s after a save, every 60 s and on Sync now, backing off to 5 minutes after errors.

- **Pull** reads `changes` from the cursor and plans with a pure `planSync(local, remote)`: a clean local copy takes the server's
  design; a dirty one whose server copy did not change is pushed; dirty on both sides is a conflict; a server tombstone moves a
  clean local design to the Trash ("deleted on another device", never deleted outright), and a dirty one is kept and pushed as
  a new design.
- **Push** sends the uploads the design uses first (`assets/missing`, then `PUT`), then the design with `baseRev`.
- **A conflict** keeps the server's version under the id; the local edit goes into the local version history ("Before sync")
  and is pushed as a new design, "Title (edited on Device)". At most 20 such copies a run; past that sync stops and says so.
- **A design open in the editor** holds the lock `craftly-design-<id>`, and sync leaves it alone meanwhile.
- **Uploads** are fetched when needed and kept with `cacheSharedAsset`.

**Clips and sounds** (2026-11-27). A space keeps the clips of its designs' video elements and the files of their sounds, apart
from the pictures: `PUT /api/spaces/:s/media/:id` takes the file itself, streamed, with its type in `Content-Type` (`MEDIA_TYPE`
in `src/server/http.ts`: the video and audio types the app keeps; anything else `415 type`) and its size in `Content-Length`
(none `411 length`). The size is weighed before a byte is read: over `maxMediaBytes` (`MAX_MEDIA_MB`, 100 MiB, the same setting
as for a shared design's) is `413 too-big` with the limit, over what the space may still hold is `413 quota` (clips count towards
`SPACE_QUOTA_MB` like everything else), and the connection is dropped. The bytes are counted and hashed as they come into
`spaces/<s>/media/<random>.tmp`, and only a file that came whole is renamed into place (`<sha256(id)>.bin`) in the space's queue,
where the quota is weighed again; the manifest lists it under `media` (type, size, SHA-256, seq), apart from `assets`, so that a
browser from before, which fetches every upload of the feed as a picture, never meets one. The same clip again is `200`, another
under its id `409 exists`. `GET` and `HEAD` give it back with its type, `Content-Disposition: attachment` and `nosniff`. Sync
(`src/cloud/sync.ts`) sends a design's clips and sounds that are on the device and that the space has not got (`HEAD`, then
`PUT`) after its pictures and before the design, and fetches those a pulled design uses that the device has not got, checked as
uploads; a clip the server will not keep stays on the device it was added on, the run says so (or that the space is full), and
the design goes all the same. Removing a space removes its folder of clips. A design edited live in a team's room gets its new
uploads from the room: when the room writes the design back, the server brings into the space the pictures, clips and sounds
the design names (`asset:<id>` anywhere in it) that the space has not got, checked and counted as an upload is; one that does not
fit stays the room's, is written to the log and counted (`write_back_files_refused_total`), and the design is written back all
the same.

**Signing in where there are designs already**: "Move N designs into your account?" with Move all, Choose and Not now. Moving
sets `space` and pushes with `baseRev: null`; a different design under that id on the server (409 `exists`) is pushed as a copy
with a new id.

**Signing out** sends what waits first. Offline, it offers to keep copies on the device as plain local designs; otherwise the
account's designs are removed from the device (the default, for shared computers). Designs never moved into the account stay.

## Client

- `src/cloud/`: `api.ts` (fetch with the token, strict reading of every answer, error codes), `validate.ts` (`checkDesign`,
  `migrateDesign`, `isSafeId`, the thumbnail pattern), `account.ts` (`useAccount`: `{server, user, teams, activeSpace}`, sign
  up, sign in, sign out, redeem an invite), `syncPlan.ts` (pure), `sync.ts`, `syncStatus.ts` (synced, syncing, offline with N
  waiting, problem).
- The server: `VITE_CRAFTLY_ACCOUNT_SERVER` at build time, or typed on the sign-in screen, with its host shown plainly.
- `src/dashboard/account/`: `SignInPage.tsx` (`#/signin`, `#/signup`, `autocomplete` set), `ResetPage.tsx` (`#/reset/<code>`),
  `InvitePage.tsx` (`#/invite/<token>`), `AccountDialog.tsx`, `SignOutDialog.tsx`, `MoveDesignsDialog.tsx`, `TeamSwitcher.tsx`,
  `TeamPage.tsx` (`#/team/<id>`: members, roles, invites), `SyncStatus.tsx`; routes in `router.ts`.
- `Shell.tsx`: the account menu starts with Sign in and Create account, or the person's name and email, Account settings, Team
  members and Sign out; the avatar shows their name; the sync status sits beside it.
- The editor: the sync status in the top bar; "Edit live with your team" in Share for a team design; a viewer gets the read-only
  mode of a view link.
- Words: a `cloud` catalog in `src/i18n/en/cloud.ts` and `src/i18n/hi/cloud.ts`. Server error codes become words on the client.

## Security

- **On the network**: TLS (`listenWarning`); tokens only in a header or a WebSocket message; tokens, recovery, invite and reset
  codes kept only as hashes; nothing is sent by the browser on its own, so no CSRF and no cross-site WebSocket hijacking.
- **Script in the page** could read the token from IndexedDB; the strict CSP (`script-src 'self'`) is the defence.
- **A team member with bad intent**: an editor can overwrite, trash or fill the space with junk within the quota, and the last
  10 revisions and the 90-day tombstones let an owner restore; roles are checked on every request; nobody raises their own role;
  only owners invite; removal is immediate, sockets too; copies already downloaded cannot be taken back.
- **A server with bad intent** sees every design (there is no end-to-end encryption) and receives the password, which it hashes:
  use a password of its own. Whatever it sends is checked as a hostile room's is (`checkDesign`, `migrateDesign`, `checkUpload`,
  `svgProblem`, safe ids, the thumbnail pattern), and the CSP blocks scripts. It cannot delete local work: its tombstones go to
  the Trash, and the cap on conflict copies stops a flood.
- Sign-up says whether an email is taken (accepted: codes gate sign-up); sign-in answers say nothing; limits and the hashing cap
  hold off guessing and floods.
- The server checks, every time: the size before parsing, the JSON, the exact shape per endpoint, the ids, the session, the role,
  the Origin, the quotas.

## Tests

- Logic: `accounts/passwords.test.ts`, `accounts/storage.test.ts` (memory and file, the race for one email, damaged files),
  `accounts/roles.test.ts`, `src/cloud/syncPlan.test.ts` (local clean, dirty, deleted against remote same, changed, tombstone,
  conflict), `validate.test.ts` (hostile answers).
- Server, real sockets (`boot()` as in `comments.test.ts`): `accounts.test.ts`, `spaces.test.ts`, `teams.test.ts`, `bound.test.ts`
  (team designs live: joining by session as editor and viewer, the refusals, keys in a bound room and sessions in a link's, 409
  `live`, writing back with comments and after a restart with `FileAccounts`, a failed write-back kept, removal, role changes, a
  deleted team, a disabled account, a reset, a new password, two members at once, a room kept on the disk after its space moved
  on or its design or team went, a viewer with no editor, a session that runs out while seated).
- DOM: the step-2 migration, `src/cloud/sync.dom.test.ts` (fake IndexedDB against a real server on port 0), the screens,
  `Shell.test.tsx`, and that a backup leaves out `cloudSession` and `sync`.
- `e2e/accounts.cjs`: two devices of one person and a second person, from moving local designs in to conflicts, a team, an
  invite, roles, live editing without a link, removal, an admin reset, signing out, the server stopped, and Hindi.

## Build order

1. The shared HTTP helpers into `src/server/http.ts`, no change in behaviour.
2. `passwords.ts`.
3. Account storage, memory and file.
4. Sign-up, sign-in, sessions, limits, CORS, `ACCOUNTS` and `SIGNUP`.
5. Sign-up codes, reset and disable, `scripts/accounts.mjs`, DEPLOY.md.
6. Spaces: designs, details, uploads, folders, changes, revisions, quotas.
7. Teams, roles, invites.
8. Client database step 2, optional fields, tombstones; MIGRATIONS.md.
9. `syncPlan` and `validate`.
10. The sync engine and its locks.
11. Account screens, menu, the move and sign-out dialogs, English and Hindi.
12. The sync status in the dashboard and the editor.
13. Team switcher, team page, invite page, listings by space.
14. Team designs live: joining by session, bound rooms, writing back, removal.
15. `e2e/accounts.cjs`, `run-all`, README (privacy, offline), BACKUP.md.

## What needs a person

A native speaker for the Hindi; a real public HTTPS deployment across sites and password managers in Safari and Firefox; the
scrypt cost tuned on the real server; a privacy policy and terms for deleting data, now that a server holds people's work; the
default sign-up mode; an outside security review; and trying the "(edited on Device)" copies with people.
