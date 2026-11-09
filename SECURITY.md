# Security policy

## Supported versions

Only the latest version on the main branch is supported.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability.

Report it privately instead. On GitHub, use **Security > Report a vulnerability** on this repository (the maintainers need to have private vulnerability reporting switched on in the repository settings); if that button is missing, contact the maintainers privately through the address on their GitHub profile.

Please include what you found, the steps to reproduce it, the version or commit, and what an attacker could do with it. The maintainers will acknowledge the report, keep you informed about the fix, and credit you in the changelog if you want that.

## What counts

Craftly runs entirely in the browser and has no server, so the interesting problems are:

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

Craftly has no server of its own. The optional live server (`npm run server`, `docs/COLLABORATION.md`) is a separate program that you run and expose if you want people to edit together; a Craftly that is not connected to one sends nothing anywhere. What to know before you expose one:

- **A link is a password.** A room is a random id and a key (one for editing, one for looking), and the link carries both after the `#`, so a web server's log does not see the key. Anyone who has the link can get in; the server stores only SHA-256 hashes of the keys, so a copy of its data folder cannot be used to get in. The link and the keys are also stored with the shared design on the devices that use it, and so are part of its backup.
- **Everything that arrives is checked, on both ends** (`src/collab/protocol.ts`). The server checks what a browser sends, and the browser checks what the server sends, because a link names the server and anybody can make a link. The checks: the form of every operation, depth, lengths and counts, no property that changes what an object is (`__proto__` and others), pictures and links that may only point to the editor's pictures, the web, mail or a phone (never script), the colours a graphic is recoloured with (plain `#hex`, `rgb()` or a name, because they are put into its markup as they are), and the markup of a graphic, which must be plain drawing: a short list of shapes, gradients and masks written as strictly as XML (`src/core/svgSafety.ts`). That check is a list of what is allowed and not a pattern for what to keep out, so `<svg/onload=…>`, an attribute without quotes and a character reference that spells `javascript:` do not get through; its tests have the XML and HTML parsers of a test browser read thousands of damaged drawings, and whatever the check accepts must come out of both as nothing but drawing. A browser ends the session at the first message it cannot use, closes the connection, keeps the design as it was and says why; nothing of that message is used. Messages, designs, rooms, people per room and messages per second are limited.
- **A server you do not trust.** Joining a design is like opening a file somebody sent you: a copy is kept in your library. After the checks above the worst that a server can do is show you a design of its choice, make your browser fetch pictures from addresses it names (the web is allowed in pictures and links; the policy in the README stops the pictures with `img-src`), learn your address, and see what you type into a design that is shared with it; it cannot make the editor run code. A page with a Content-Security-Policy (README) can only reach the servers that its owner listed in `connect-src`, which is the setting that keeps a link from leading anywhere. A person who has an **edit link** can still change the design into something that makes no sense (the checks are for safety, not for sense) and there is no history of who did what yet.
- **Still open.** A design can grow after it is shared, and anyone who can reach the server can create rooms up to its limit. The SVG exporter keeps cleaning the markup of graphics that it writes into a file (scripts, event handlers however they are written, links and references that leave the drawing, until nothing changes), because a design can also come from an imported project file or a backup, and those check the shape of a graphic and not its markup. Do not put the server on the internet without a reverse proxy that adds TLS and limits by address, and without reading the list "Hardening" in `docs/COLLABORATION.md`.
- **Who can do what.** The edit key can change the design and close the room; the view key can only look (the server refuses its batches). People are not told apart: there are no accounts and no names yet, so a change cannot be traced to a person.
- **Content-Security-Policy.** A page that uses live editing needs the server's origin in `connect-src` (README).
