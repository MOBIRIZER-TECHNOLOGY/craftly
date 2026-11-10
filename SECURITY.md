# Security policy

## Supported versions

Only the latest version on the main branch is supported.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability.

Report it privately instead. On GitHub, use **Security > Report a vulnerability** on this repository (the maintainers need to have private vulnerability reporting switched on in the repository settings); if that button is missing, contact the maintainers privately through the address on their GitHub profile.

Please include what you found, the steps to reproduce it, the version or commit, and what an attacker could do with it. The maintainers will acknowledge the report, keep you informed about the fix, and credit you in the changelog if you want that.

## What counts

The local editor runs in the browser. Its security concerns include:

- script injection through an imported `.craftly` project file, an uploaded SVG, or template or catalogue data
- data leaving the device when it should not, or an on-device model downloaded without the person agreeing
- a model file accepted although its size or SHA-256 differs from the one pinned in `src/ml/registry.ts`, or a model added from a file (File > On-device models > Add from a file) that is used unchecked
- a crafted backup file (a ZIP chosen under Back up & restore) that crashes the restore, brings in an id that breaks a link or a file name, stores something that is not a design, or makes the app use unbounded memory or time (the reader refuses encrypted and ZIP64 archives, checks every file's CRC-32, limits what a compressed file may unpack to, and treats the manifest and every design as untrusted; see `docs/BACKUP.md`)
- the service worker or its caches serving something other than the app
- weaknesses in how designs and uploads are stored in the browser
- a known vulnerability in a package that ships in the app (see `THIRD-PARTY-NOTICES.md`)
- a shared design, or a live server that a link leads to, that makes the editor run code, load something it should not, or accept a design that is not safe to draw (see "Live editing" below)

Out of scope: problems that need a modified browser or a malicious extension, running out of memory by opening a very large file on your own device, and findings in development-only tools.

## Live editing (optional)

Craftly runs locally by default. Optional live editing uses a self-hosted Craftly server. Starting or joining a live session sends shared design content and uploads to the selected server. See the [collaboration deployment guide](docs/COLLABORATION.md).

- **Treat invite links as passwords.** A link carries the room ID and an edit or view key in its fragment. The socket URL names the room, and the first WebSocket message presents the key. The server stores SHA-256 hashes of the edit, view and owner keys. Project files and library backups omit live links and credentials. Handle older files that contain these fields as secrets.
- **Everything that arrives is checked, on both ends** (`src/collab/protocol.ts`). The server checks what a browser sends, and the browser checks what the server sends, because a link names the server and anybody can make a link. The checks: the form of every operation, depth, lengths and counts, no property that changes what an object is (`__proto__` and others), pictures and links that may only point to the editor's pictures, the web, mail or a phone (never script), the colours a graphic is recoloured with (plain `#hex`, `rgb()` or a name, because they are put into its markup as they are), the blend mode of an element (one of fifteen names, because the name goes to a canvas and into a `style` of an exported SVG as it is), and the markup of a graphic, which must be plain drawing: a short list of shapes, gradients and masks written as strictly as XML (`src/core/svgSafety.ts`). That check is a list of what is allowed and not a pattern for what to keep out, so `<svg/onload=…>`, an attribute without quotes and a character reference that spells `javascript:` do not get through; its tests have the XML and HTML parsers of a test browser read thousands of damaged drawings, and whatever the check accepts must come out of both as nothing but drawing. A browser ends the session at the first message it cannot use, closes the connection, keeps the design as it was and says why; nothing of that message is used. Messages, designs, rooms, people per room and messages per second are limited.
- **Join rooms on servers you trust.** A joined room becomes a local copy. Its server can see shared content, edits and uploads, and the browser may fetch images referenced by the room. Use the deployment policy to restrict permitted server and image origins.
- **Deployment limits.** Room creation is anonymous. Set network and rate limits at a TLS reverse proxy before public hosting. The server caps document size at creation and on edit, and limits shared uploads to 9 MiB per image and 36 MiB per room. The SVG exporter sanitizes graphic markup separately from the project and backup readers.
- **Permissions.** An edit key grants editing and image uploads. A view key grants read access to the design and its room images. A separate owner key authorizes deleting the room. Older rooms lack this key and require operator cleanup or recreation. The server has no accounts or per-person audit trail.
- **Content-Security-Policy.** A page that uses live editing needs the server's origin in `connect-src` (README).
