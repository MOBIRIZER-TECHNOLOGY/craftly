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
- the service worker or its caches serving something other than the app
- weaknesses in how designs and uploads are stored in the browser
- a known vulnerability in a package that ships in the app (see `THIRD-PARTY-NOTICES.md`)

Out of scope: problems that need a modified browser or a malicious extension, running out of memory by opening a very large file on your own device, and findings in development-only tools.
