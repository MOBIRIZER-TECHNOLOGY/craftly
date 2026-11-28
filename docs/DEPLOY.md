# Deploying Craftly

Craftly has two parts that are deployed separately.

- **The editor** is static files. Any static host serves it, and most people need nothing else.
- **The live server** is optional: a small Node program that people's browsers connect to when they work on one design together. You run it yourself, on a machine of your own.

What was checked and what was not is said in each section. The short version: the editor's build and its policy are covered by the browser journeys; the live server's bundle is started by CI (`npm run server:smoke`); **the container image has never been built**, because the machine this guide was written on has no Docker; and no part of this guide has been followed on a real public host yet.

## 1. The editor on a static host

`npm run build` type-checks and writes the site to `dist/` (about 5 MB, plus the 28.7 MB ONNX runtime file that is fetched only when a photo tool is first used). Publish that folder. The details are in the [Deploy section of the README](../README.md#deploy) and are not repeated here; what you have to get right:

- **HTTPS.** The service worker (offline use, installing the app) needs it.
- **No rewrite rules.** Pages are in the URL hash.
- **Headers.** `public/_headers` is copied into `dist/` and sets the caching rules (`index.html`, `sw.js`, `precache.json` and the manifest with `no-cache`; `assets/` for a year), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` and the **Content-Security-Policy**. Netlify and Cloudflare Pages read that file. Every other host ignores it: send the same headers from the host's own configuration (the file is the list to copy from). The Content-Security-Policy alone also travels in the page of a production build, as a meta tag written from the same line, so a host without headers still has a policy; it cannot carry `frame-ancestors`, so keep the header where you can (README, "The policy on a host that sends no headers").
- **A sub-folder.** `npm run build -- --base=/craftly/`, then publish `dist/` there.
- **If you run a live server:** add its two addresses to `connect-src` in the policy (section 2.6), in the header and in the meta tag of the build: build with `VITE_CRAFTLY_CSP_CONNECT="https://live.example.org wss://live.example.org"`, which writes both. Without that, "Work together" cannot reach it and the browser's console names the policy as the reason.

## 2. The live server

What it is and how it works: [`COLLABORATION.md`](COLLABORATION.md). It is one file, `dist-server/live.mjs` (`npm run server:build`), that needs Node 22 or newer and the `ws` package. It listens on one port for HTTP (`/api/...`) and WebSocket (`/ws`), keeps its rooms as files in one folder, and speaks plain HTTP: TLS is the job of a reverse proxy in front of it (section 2.4), and browsers require it, because a page loaded over `https://` may only open `wss://` connections.

### 2.1 With Docker

`Dockerfile.server` in the root of the project builds the image in two stages: the first installs the project and builds the bundle; the second holds Node, the bundle and `ws`, runs as the user `node` (not root), keeps the rooms in the volume `/data`, listens on port 8787 on all addresses of the container, and has a health check that asks `/api/health`.

```bash
docker build -f Dockerfile.server -t craftly-live .
docker run -d --name craftly-live --restart unless-stopped \
  -p 127.0.0.1:8787:8787 \
  -v craftly-live-data:/data \
  -e ALLOW_ORIGIN=https://editor.example.org \
  craftly-live
```

- `-p 127.0.0.1:8787:8787` publishes the port to the machine itself only, where the reverse proxy reaches it. Do not publish it to the world without TLS in front.
- The image sets `HOST=0.0.0.0`, `PORT=8787` and `DATA_DIR=/data`. With that `HOST` the server prints a warning at every start that it speaks plain HTTP and WebSocket and needs a proxy with TLS in front (section 2.4). In a container that is expected: publish the port to `127.0.0.1` only, as above, or to the network of the proxy. The other settings (section 2.3) are passed with `-e`.
- `docker stop` sends SIGTERM; the server saves and exits.
- If you mount a folder of the host instead of a named volume (`-v /srv/craftly-live:/data`), it must be writable by uid 1000, the `node` user of the image.
- The server writes its files readable by itself only (600, folders 700), with or without Docker: they hold the designs and, with `ACCOUNTS=1`, emails and password hashes. Whatever reads the folder (a backup, a copy) runs as the same user or as root.

**What was checked**, on 2026-11-28 with Docker Desktop 29.9.3 on Windows (a Linux engine, linux/amd64): the build succeeds from a clean cache in about 30 s, with no warning but npm's about `npm cache clean --force`; the image is 244 MB, runs as uid 1000, and holds the bundle, two package files and `ws` only. Started with a named volume, Docker calls it healthy about 8 s later; `/api/health` answers 200, `POST /api/rooms` 201 (a room file appears in the volume), a `POST` from an origin not in `ALLOW_ORIGIN` 403, and `/metrics` 401 without `METRICS_KEY` and the numbers with it. `docker stop` exits with code 0 in about a second, and after `docker start` the room is still there. With a folder of the host mounted at `/data`, `e2e/liveclips.cjs` (`LIVE_SERVER` and `LIVE_DATA` point it at a server that runs already) passes: one person shares a design with a clip and a sound, the server keeps them as files in that folder, and a second person joins and sees and hears them. With `ACCOUNTS=1`, a sign-up is refused (403) unless `SIGNUP=open`; with it, an account is made, survives a restart, signs in, and a wrong password gets 401. `scripts/server-smoke.mjs` passes inside `node:22-alpine`, with a clean exit on SIGTERM. The image also builds for `linux/arm64` (78 s under emulation) and, run under emulation, answers as `aarch64`, is called healthy, passes `scripts/live-check.mjs` and stops with code 0. CI builds both on every pull request and runs the amd64 one through the same check (`.github/workflows/ci.yml`, the `image` job); pushing a tag `v*` publishes both to the GitHub Container Registry as `ghcr.io/<owner>/<repository>/live` (`.github/workflows/release-image.yml`), and Dependabot proposes updates of the base image. Not checked: a real ARM machine, Docker on Linux itself (rather than Docker Desktop), a long run, a host with SELinux (where a mounted folder needs `:z`), and the two workflows themselves, which have not run on GitHub yet.

Why the second stage does not use the project's `package.json`: its `dependencies` are the editor's fonts and libraries (some fifty packages, the ONNX runtime among them), which the server never loads. `scripts/server-runtime-package.mjs` reads what the bundle imports (today `ws` only) and writes a `package.json` and a `package-lock.json` with the version, address and checksum from the project's own lock file, so the image gets the same `ws` that the tests ran against. If the server ever imports another package, the script picks it up, or stops with a message if it cannot describe it.

### 2.2 Without Docker

On the machine that will run it (Node 22 or newer), or on any machine and then copied over:

```bash
npm ci
npm run server:build                                   # dist-server/live.mjs
node scripts/server-runtime-package.mjs /opt/craftly-live   # package.json and package-lock.json for ws only
cp dist-server/live.mjs /opt/craftly-live/
cd /opt/craftly-live && npm ci --omit=dev --ignore-scripts
```

Run it under a process manager, as a user of its own that can write to the data folder and to nothing else. A systemd unit, as an example (not tested on a real machine):

```ini
# /etc/systemd/system/craftly-live.service
[Unit]
Description=Craftly live server
After=network.target

[Service]
User=craftly
WorkingDirectory=/opt/craftly-live
Environment=HOST=127.0.0.1 PORT=8787 DATA_DIR=/var/lib/craftly-live
Environment=ALLOW_ORIGIN=https://editor.example.org
ExecStart=/usr/bin/node /opt/craftly-live/live.mjs
Restart=on-failure
# the server saves and exits on SIGTERM, which is what systemd sends
TimeoutStopSec=20
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/craftly-live

[Install]
WantedBy=multi-user.target
```

Keep `HOST=127.0.0.1` here: the proxy is on the same machine, and nothing else should reach the port. With any other `HOST` the server says at its start that other machines can reach it without TLS.

### 2.3 Settings

All settings are environment variables, read once at the start by `src/server/main.ts`. A number that is not a whole number in its range stops the server at once with a message that names the variable.

<!-- ENV-TABLE: keep in step with src/server/main.ts -->

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `8787` | The port to listen on (0 to 65535; 0 lets the system choose, and the start line says which). |
| `HOST` | `127.0.0.1` | The address to listen on. `127.0.0.1` is reachable from the same machine only. `0.0.0.0` is every address, which is what a container needs (the image sets it); on a machine without a container, use it only with a firewall or a proxy in front. |
| `DATA_DIR` | `live-data` | The folder for the rooms, made if it is not there. Relative to the folder the server is started from; give a full path in production. |
| `ALLOW_ORIGIN` | (none) | The origin of the editor, as the browser sends it: `https://editor.example.org`, no path, no slash at the end. Several, separated by commas, or `*` for any. Without it the server sends no cross-origin headers, and an editor on another origin cannot make or join rooms. With a list, the server also refuses (403) a WebSocket connection and every `POST`, `PUT` and `DELETE` from a page of an origin that is not on it; a request with no `Origin` header (curl, another server) is not refused by this. Name your editor's origin; `*` is for trying things out, and asks no page where it comes from. |
| `MAX_ROOMS` | `1000` | How many rooms the server keeps. Making one more is refused with 503. |
| `MAX_MEDIA_MB` | `100` | The largest clip or sound a shared design carries, and with `ACCOUNTS=1` a space keeps, in MiB. A larger one stays on the device that added it, and the person is told. `0`: neither carries clips or sounds. A space's clips count towards `SPACE_QUOTA_MB`. |
| `MAX_ROOM_MEDIA_MB` | `500` | The most the clips and sounds of one shared design may take on the server's disk, in MiB (beside `<room>.json`, in `<room>.media/`). Plan the disk for `MAX_ROOMS` times this at worst, and set `ROOM_TTL_DAYS`. |
| `MAX_PEERS_PER_ROOM` | `50` | How many people can be in one room at once. |
| `ROOM_CREATE_PER_HOUR` | `10` | How many rooms one address may make in any hour (0 to 100000; `0` for no limit). Every attempt counts. Beyond it the answer is 429 with `Retry-After`. An IPv6 address is counted by its /64. Behind a proxy, set `TRUST_PROXY` too, or all visitors share the proxy's address and this one allowance. |
| `ROOM_CREATE_KEY` | (none) | A secret that whoever starts to share must give: the editor asks for it ("Key to start sharing") when the server answers that it wants one. Not set: anybody who can reach the server may make rooms. At least 8 characters, no spaces, printable ASCII (the server does not start otherwise); make it long and random, `openssl rand -base64 24` for example. It is one key for everybody you let share, and changing it is the only way to take it back. Every attempt counts towards `ROOM_CREATE_PER_HOUR`, which limits guessing: leave that on. People who are given a link join, edit and look without the key. The editor does not store it; people type it each time they start to share, or let their password manager do it. For a public server set it, unless making rooms is meant to be open to everybody. |
| `ADMIN_KEY` | (none) | The operator's key, for listing and removing rooms (section 2.7). Not set: the server has no such interface. At least 16 characters, no spaces, printable ASCII (the server does not start otherwise); make it long and random, and different from `ROOM_CREATE_KEY`. Whoever has it can see the titles of all rooms and remove any of them; it does not let anybody into a room. |
| `METRICS_KEY` | (none) | The key a scraper shows to read `GET /metrics` (section 2.8), as `Authorization: Bearer <key>`. Not set: the server shows no numbers (404). At least 16 characters, no spaces, printable ASCII; long and random, and different from `ADMIN_KEY`: it lets a scraper read counts and nothing else. |
| `TRUST_PROXY` | off | `1` when **exactly one** reverse proxy stands in front of the server and the server cannot be reached around it. The address of a visitor (for `ROOM_CREATE_PER_HOUR`) is then the last entry of `X-Forwarded-For`, the one your proxy wrote. Off (`0` or not set), the header is never read. Do not turn it on for a server that can be reached directly: anybody could then write the header and be counted as whoever they like. A chain of two proxies (a CDN in front of nginx, say) is not supported: the inner one would be counted as the visitor. |
| `ROOM_TTL_DAYS` | (never) | A room that nobody has used for so many days is removed, with its link: used means edited, an image added, or joined (also only to look). Not set or `0`: rooms are kept until their owner stops sharing, and `MAX_ROOMS` rooms that nobody uses fill the server for good. For a public server set it, to `30` for example. Nobody loses a design by it: every person who opened a shared design has a copy in their own library, and only the link stops working. The server looks once when it starts and then every hour; a room with somebody in it is never removed. |
| `MAX_CONNECTIONS` | `5000` | The most WebSocket connections at one time, to all rooms together. One more is answered with 503 and tries again by itself. |
| `MAX_CONNECTIONS_PER_ADDRESS` | `200` | The most WebSocket connections one address may have open at once (an IPv6 address counted by its /64). One more is answered with 503 and tries again by itself. Enough for an office behind one address, each person with a tab or two; it keeps one address from taking every place of `MAX_CONNECTIONS`. Behind a proxy it needs `TRUST_PROXY`, or every visitor is the proxy's address. |
| `MAX_TOTAL_BUFFERED_MB` | `1024` | The most that may wait in memory to be sent, to all connections together, in MiB. Past it, once a second, the connections with the most waiting are dropped until it is under again; they come back by themselves. `MAX_BUFFERED_BYTES` is the limit of one connection; this one keeps many slow readers from adding up to more memory than the machine has. Keep it under what the server may use. |
| `MAX_STAGING_MB` | `2048` | The most that clips and sounds on their way in may reserve together, rooms and spaces alike, in MiB. Each upload reserves its size before a byte is read, and a room's or a space's limit counts what is reserved for it, so uploads started at once cannot fill the disk with half-received files. One more is answered 503 with `Retry-After`. Keep it under the free space of the data folder. |
| `MAX_WAITING_PER_ROOM` | `20` | The most connections to one room that have not shown their key yet. One more is asked to come back later (close 1013). |
| `MAX_QUEUED_BATCHES`, `MAX_QUEUED_BYTES` | `1000`, `67108864` (64 MiB) | The most edits, and bytes of edits, that may wait in one room to be saved. A connection that sends one more is asked to come back later (close 1013); its browser sends again what was not acknowledged, so nothing is lost. Counted as `connections_closed_total{reason="queue"}`: many of those mean the disk is too slow for the rooms. |
| `MAX_GROUP` | `100` | The most edits saved with one write. Edits that arrive while a write runs are saved together with the next write (group commit), so a busy room writes once per write's time and not once per edit. Nothing is acknowledged before it is on disk. |
| `MAX_BUFFERED_BYTES` | `33554432` (32 MiB) | The most that may wait in memory to be sent to one connection; one that reads slower is dropped and comes back by itself. Keep it above the size of one design (16 MiB). |
| `MAX_UNJOINED_MESSAGE_BYTES` | `8192` | The most a message may be before a connection has shown its key. A bigger one is not read and closes the connection. |
| `BYTE_BURST`, `BYTES_PER_SECOND` | `8388608`, `1048576` | Bytes one connection may send: a burst (8 MiB), then so many a second (1 MiB). More closes the connection (1008). |
| `JOIN_BURST`, `JOIN_EVERY_MS` | `4`, `2000` | How often one connection may ask for the whole design: a burst, then once every so many milliseconds. More closes the connection (1008). |
| `PRESENCE_BURST`, `PRESENCE_PER_SECOND` | `30`, `15` | How often one connection may say where its person is (pointer, selection): a burst, then so many a second. More is dropped without closing the connection, and counted (`craftly_live_presence_dropped_total`). |
| `ACCOUNTS` | off | `1` turns on accounts, teams and sync (section 2.9, [`ACCOUNTS.md`](ACCOUNTS.md)), kept in `DATA_DIR/accounts`. Off (`0` or not set), the server is exactly what it was, and the three settings below are not read. |
| `SIGNUP` | `invite` | With `ACCOUNTS=1`: who may make an account. `invite`: only with a team's invite or a sign-up code from you (`scripts/accounts.mjs create-signup-code`); `open`: anybody who reaches the server; `closed`: nobody. Anything else stops the server. |
| `MAX_ACCOUNTS` | (no limit) | With `ACCOUNTS=1`: the most accounts the server keeps. One more sign-up is refused (403 `full`). |
| `SPACE_QUOTA_MB` | `1024` | With `ACCOUNTS=1`: the most one person's or one team's space may hold, in MiB: designs with their last 10 revisions (deleted ones too, for 90 days) and uploads. More is refused (413 `quota`). |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | How long the server may take to close when it is told to stop (SIGINT, SIGTERM): it waits for the saves and requests that are at work, then leaves with exit code 1 and a line in the log. 0 to 600000. Nothing acknowledged is lost by not waiting. |

**This table must be kept in step with `src/server/main.ts`**: a variable added there and not here does not exist for an operator. The comment at the top of `main.ts` lists the variables too. The table was read against `main.ts` on 2026-11-17 and holds every variable it reads. A variable is in the table only if `main.ts` read it when this section was last edited.

Limits that are not settings (they are options of `createLiveServer` in `src/server/live.ts`, with these defaults): 4 MiB per WebSocket message, 16 MiB for a design, 9 MiB per shared image and 36 MiB of images per room, a burst of 200 messages and then 100 a second per connection, a ping every 30 seconds.

### 2.4 A reverse proxy for TLS

The proxy holds the certificate, listens on 443, and passes both ordinary requests and the WebSocket upgrade on to the server. Three things matter:

- **The WebSocket upgrade** on `/ws` must be passed on (`Upgrade` and `Connection` headers, HTTP/1.1 to the server).
- **Body size.** `POST /api/rooms` carries a whole design (up to 16 MiB), an image upload up to about 12 MB, and a clip or a sound up to `MAX_MEDIA_MB` (100 MiB). nginx refuses bodies over 1 MB unless told otherwise, and sharing a design with pictures or clips in it would then fail. Let bodies through up to `MAX_MEDIA_MB` and a little more, and let them stream (`proxy_request_buffering off`), or nginx first writes each clip to its own disk.
- **Idle time.** The server pings every connection every 30 seconds, so a proxy that closes connections idle for 60 seconds (the default of nginx) leaves them alone. Do not set that time below about 45 seconds.

Both examples set `X-Forwarded-For`, the address of the browser as the proxy saw it. The server reads it only when `TRUST_PROXY=1` (section 2.3), and then believes its last entry, which is what both examples write. Set that only when the server can be reached through the proxy alone, since anybody who reaches the port directly can write the header themselves; without it, every visitor behind the proxy counts as one address for `ROOM_CREATE_PER_HOUR`.

**Caddy** gets and renews the certificate itself, passes WebSocket upgrades on without being told, sets `X-Forwarded-For` and `X-Forwarded-Proto` on its own (replacing what the browser sent, unless it is told to trust a proxy in front of it), and has no limit on the size of a body unless you give it one:

```
live.example.org {
	reverse_proxy 127.0.0.1:8787
}
```

**nginx** (certificate paths as certbot writes them):

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    server_name live.example.org;

    ssl_certificate     /etc/letsencrypt/live/live.example.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/live.example.org/privkey.pem;

    client_max_body_size 110m;   # MAX_MEDIA_MB and a little more
    proxy_request_buffering off; # a clip streams through to the server

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-For   $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        $connection_upgrade;
        proxy_read_timeout 75s;
        proxy_send_timeout 75s;
    }
}
```

`X-Forwarded-For $remote_addr` replaces whatever the browser sent in that header with the address nginx saw, which is what you want when nginx is the only proxy. (`$proxy_add_x_forwarded_for` would append to what the browser sent.)

The key of a room is never in an address (it is in the first WebSocket message), so the access log of the proxy holds room ids and no keys.

**Ready to run, with Docker Compose.** `deploy/` holds both setups: the server and Caddy (`compose.caddy.yml` with `Caddyfile`), and the server and nginx (`compose.nginx.yml` with `nginx.conf`, which also sends plain HTTP to HTTPS and streams bodies both ways). In both, only the proxy is published; the server is on the compose network alone, so `TRUST_PROXY=1` is set and safe. Each file says at the top how to start it.

**What was checked**, on 2026-11-28 with Docker Desktop on Windows, Caddy 2 and nginx 1.29: each setup was started with a certificate for `localhost` (Caddy's own local authority; for nginx a test authority made with `openssl`), and `scripts/live-check.mjs` passed through it over TLS. It made a room, joined it with two WebSocket connections and saw an edit go from one to the other, sent a clip of 60 MiB (Caddy) and 100 MiB (nginx) and read it back byte for byte, stayed idle for 70 s and edited again, and removed the room. The server's port could not be reached around the proxy, and plain HTTP was sent to HTTPS (308). Twelve rooms asked for with a different forged `X-Forwarded-For` each time got ten 201s and then 429: both proxies replace the header, so a browser cannot make itself look like many visitors. Not checked: a real domain and a certificate from Let's Encrypt, renewal, and a CDN in front.

Check a deployment from outside:

```bash
curl -i https://live.example.org/api/health        # 200 {"ok":true,...}; 503 means the data folder cannot be written
node scripts/live-check.mjs https://live.example.org --origin https://editor.example.org
```

`live-check.mjs` runs the steps above against any server and removes the room it made; `--create-key` gives it the `ROOM_CREATE_KEY`, `--media-mb` the size of the clip, `--idle` the quiet time, and `--ca` a certificate to trust for a test authority. Then start a live session from your editor with `https://live.example.org` as the server and open the link in a second browser.

### 2.5 Where the data lives, and backing it up

Everything the server keeps is in `DATA_DIR` (`/data` in the container, the volume `craftly-live-data` in the example above): the shared designs, their uploaded images, clips and sounds, revision numbers, the SHA-256 hashes of the edit, view and owner keys, and with `ACCOUNTS=1` the accounts under `accounts/` (section 2.9). There is no database and nothing is kept anywhere else. Lose the folder and every link stops working; the people who joined still have their own copy of each design in their browser.

- **What a backup holds.** The designs in plain text, pictures included. The keys cannot be read out of it (only their hashes are stored), so a copy cannot be used to edit or view through the server, but anybody who has the copy can read the designs. Store it like the designs themselves.
- **Taking one.** Copy the folder. Every file is written whole under another name and renamed into place, so a copy taken while the server runs holds each file either before or after a save, never half of one. A copy taken at a busy moment can still hold files from slightly different moments; for a copy that is certainly consistent, stop the server first (it saves on SIGTERM), copy, start it again. Files ending in `.tmp` are saves or uploads that were interrupted, and can be left out; the server removes those it left itself when it next starts, and says how many in its log. A room is the file `<room>.json` and, beside it, the folder `<room>.assets` when it has uploaded images and `<room>.media` when it has clips or sounds: a backup needs all three.

  The archive is made readable by its owner only (`umask 077`): it holds what the folder holds, password hashes included. The image of the server has `tar`, so nothing else needs to be pulled; run it as `node`, the user that owns the files, or as root.

  ```bash
  docker run --rm --user node --entrypoint sh -v craftly-live-data:/data:ro -v "$PWD":/backup craftly-live \
    -c 'umask 077 && tar czf /backup/craftly-live-$(date +%F).tar.gz -C /data .'
  # without Docker, as the server's user or root (its files are readable by that user only):
  sudo -u craftly sh -c 'umask 077 && tar czf craftly-live-$(date +%F).tar.gz -C /var/lib/craftly-live .'
  ```

  With Docker, `/backup` must be writable by uid 1000 (`node`); on Linux, make the folder that user's or use `--user root`.

- **Restoring.** Stop the server, put the files back into an empty `DATA_DIR` owned by the user the server runs as, start it. Links made before the backup work again; edits made after it are gone from the server, and what a browser that was ahead of the restored copy does on its next visit has not been tried. With Docker, unpack into a new named volume mounted at `/data`, where it takes the owner and mode of the image's folder (`node`, 700):

  ```bash
  docker stop craftly-live && docker rm craftly-live
  docker volume rm craftly-live-data           # only once you are sure the archive is good
  docker run --rm --user node --entrypoint tar -v craftly-live-data:/data -v "$PWD":/backup:ro craftly-live \
    xzf /backup/craftly-live-2026-11-28.tar.gz -C /data
  # then start the server as in section 2.1
  ```

  **Rehearsed** on 2026-11-28 with the image and these commands: a server with `ACCOUNTS=1` held a room edited three times with a clip of 5 MiB, and an account with a design in its space. The archive was taken while the server ran; then the container and its volume were deleted, and the archive was unpacked into a new volume. The server came back healthy, the room opened with its old view key at revision 3, its clip came back byte for byte, the account's old session still worked, it signed in with its password, and its design was there at its revision. The modes stayed 700 and 600, owned by `node`. Not rehearsed: a restore onto another machine, and a browser that had edits newer than the archive.
- **Growth.** A room stays until its owner stops sharing, or for `ROOM_TTL_DAYS` after anybody last used it; its images, clips and sounds are kept as long as the room. Watch the size of the folder.

### 2.6 What to put in the editor's `connect-src`

The editor's Content-Security-Policy (section 1) allows connections to its own site and to Hugging Face only. A live session makes fetches to the server (`https://`) and opens a WebSocket to it (`wss://`), and CSP treats those as two sources. Add both to `connect-src` in `public/_headers` before you build (or in your host's configuration):

```
connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co blob: data: https://live.example.org wss://live.example.org;
```

and set `ALLOW_ORIGIN` on the server to the editor's origin (the other direction of the same permission). People type the server's address into **Share > Work together**; nothing about it is built into the editor.

The live journeys (`e2e/live.cjs`) pass against a production build under the policy with `http://127.0.0.1:8788 ws://127.0.0.1:8788` added; a public pair of `https://` and `wss://` addresses behind a proxy has not been tried.

### 2.7 Looking at the rooms and removing one

Start the server with `ADMIN_KEY` set (section 2.3). Then, on the machine the server runs on:

```bash
export ADMIN_KEY=...                         # the key the server was started with
export CRAFTLY_SERVER=http://127.0.0.1:8787  # where the server listens; this is the default
npm run server:rooms -- list                 # or: node scripts/rooms.mjs list
npm run server:rooms -- delete <room id>
```

`list` prints one line for each room and a sum:

```text
ROOM                    TITLE     MADE (UTC)        LAST USED (UTC)   DESIGN   IMAGES   PEOPLE
FUb2-8jUTTPSncQPkDBxMQ  Menu      2026-11-13 19:41  2026-11-14 08:02  1.2 MiB  3.4 MiB  2
x5VQPmL9gWrqO0S1iCBPyQ  A poster  2026-11-13 19:41  2026-11-13 19:41  301 B    0 B      0

2 rooms on http://127.0.0.1:8787, 4.6 MiB in all, 2 people connected now.
```

`delete` removes the room the way its owner's "Stop sharing" does: whoever is in it is sent away, its images are removed, its links stop working. Nobody loses a design by it, because every person who opened it has a copy in their own library. It also removes a room whose file is damaged (listed as "this room cannot be read"), which otherwise counts towards `MAX_ROOMS` until somebody deletes the file by hand.

What to know:

- The script reads the key and the address from the environment only, so that the key is not in the shell's history or in the list of processes. It needs Node 22 and nothing else; copy `scripts/rooms.mjs` to the server, or run it from a checkout. Without a checkout the two calls are easy to make by hand: `curl -H "x-craftly-admin-key: $ADMIN_KEY" http://127.0.0.1:8787/api/admin/rooms` and `curl -X DELETE -H "x-craftly-admin-key: $ADMIN_KEY" http://127.0.0.1:8787/api/admin/rooms/<id>` ([`COLLABORATION.md`](COLLABORATION.md) has the details of the answers).
- Ask the server itself, on its own machine or through an SSH tunnel, not across the internet. If you must go through the proxy, it must speak TLS, and you may want to keep `/api/admin/` away from the public there altogether (`location /api/admin/ { deny all; }` in nginx, `respond /api/admin/* 404` in Caddy) and use the tunnel.
- It is not for pages: a request with an `Origin` header is refused, and there are no CORS headers on these answers.
- Ten wrong keys from one address within an hour, and the server answers that address with 429 for the rest of the hour, also for the right key. Behind a proxy without `TRUST_PROXY`, everybody is "one address": somebody guessing through the proxy can lock the interface for an hour for requests through the proxy, not for you on the machine itself, which is one more reason to ask the server directly.
- No key of a room can be listed or recovered: the server keeps only hashes, and does not hand those out either. A person who lost their link needs a new one from whoever shared the design.
- Listing reads every room once (to find its title and size). On a server with thousands of big rooms that takes a while and is disk work; it does not block the people who are editing, but do not put it in a loop.

### 2.8 Metrics

Start the server with `METRICS_KEY` set (section 2.3). `GET /metrics` then answers in the text format Prometheus reads, for a request that shows the key as a bearer token:

```bash
curl -H "Authorization: Bearer $METRICS_KEY" http://127.0.0.1:8787/metrics
```

```text
# HELP craftly_live_rooms_in_memory Rooms that are in memory now.
# TYPE craftly_live_rooms_in_memory gauge
craftly_live_rooms_in_memory 3
# HELP craftly_live_batches_applied_total Batches of edits that were applied, saved and acknowledged.
# TYPE craftly_live_batches_applied_total counter
craftly_live_batches_applied_total 1284
# HELP craftly_live_connections_closed_total WebSocket connections the server closed for a limit: ...
# TYPE craftly_live_connections_closed_total counter
craftly_live_connections_closed_total{reason="slow_reader"} 0
craftly_live_connections_closed_total{reason="rate"} 2
...
```

A scrape configuration for Prometheus, with the key in a file that only Prometheus can read:

```yaml
scrape_configs:
  - job_name: craftly-live
    scrape_interval: 30s
    metrics_path: /metrics
    scheme: http # https when Prometheus reaches the server through the TLS proxy
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/craftly-metrics-key
    static_configs:
      - targets: ["127.0.0.1:8787"]
```

What is counted (every name starts with `craftly_live_`):

| Metric | Kind | What it is |
| --- | --- | --- |
| `uptime_seconds` | gauge | Seconds since the process started. A value that falls is a restart. |
| `rooms_in_memory`, `rooms_stored` | gauge | Rooms somebody is at now, and rooms kept on disk (counted at most every five seconds). `rooms_stored` near `MAX_ROOMS` means new rooms will be refused: set `ROOM_TTL_DAYS`, or remove rooms (section 2.7). |
| `connections`, `peers_joined` | gauge | Open WebSocket connections, and those that have shown a key. A wide gap between the two is connections that stand at a door. |
| `messages_received_total`, `bytes_received_total` | counter | What browsers sent over WebSockets. |
| `batches_applied_total`, `batches_rejected_total` | counter | Edits that were saved and acknowledged, and edits that were refused (not well formed, from a link that only looks, or not saved). |
| `saves_total`, `save_failures_total` | counter | Room records written, and those that could not be. **A failure is a disk problem and worth an alert at the first one.** |
| `edit_groups_total` | counter | Groups of edits saved with one write. `rate(batches_applied_total) / rate(edit_groups_total)` is the edits per write: near 1 when rooms are quiet, higher when edits arrive faster than the disk writes. |
| `save_duration_seconds_sum`, `_count` | summary | How long writing a record took. `rate(sum) / rate(count)` is the mean; a mean that climbs is a disk that is slow or designs that grow. |
| `rooms_created_total`, `rooms_removed_total`, `rooms_expired_total` | counter | Rooms made, removed by their owner or by you, and removed for their age. |
| `connections_closed_total{reason}` | counter | Connections the server closed for a limit: `slow_reader`, `rate`, `join_rate`, `size`, `silent`, `waiting`, `queue`. A few are ordinary (a laptop that sleeps is `silent`); many of one kind is somebody testing the limits, or a limit that is too low for your people. |
| `upgrades_refused_total{reason}` | counter | Connections refused before they were made: `connections` (`MAX_CONNECTIONS` is reached), `address` (`MAX_CONNECTIONS_PER_ADDRESS`) or `origin` (a page of an origin that is not in `ALLOW_ORIGIN`). |
| `uploads_refused_total{reason}` | counter | Clips and sounds refused before a byte was read: `busy`, the server was receiving `MAX_STAGING_MB` at once. |
| `send_buffer_bytes`, `staging_bytes` | gauge | What waits in memory to be sent, to all connections together (against `MAX_TOTAL_BUFFERED_MB`), and what clips on their way in have reserved (against `MAX_STAGING_MB`). |
| `http_responses_total{class}` | counter | HTTP answers by `2xx`, `3xx`, `4xx`, `5xx`, the scrapes included. `5xx` is the storage failing. |

What to know:

- No metric names a room, a person, an address or a path, and none ever will by a label: the values of every label are a fixed list.
- The endpoint is not for pages (a request with an `Origin` header is refused, there are no CORS headers) and ten wrong keys in an hour lock an address out for the rest of it, which it shares with wrong `ADMIN_KEY`s. Scrape the server directly, or keep `/metrics` away from the public at the proxy as for `/api/admin/` (section 2.7).
- Counters start at 0 with the process. Memory and CPU are not here: take them from the system (`node_exporter`, the container runtime).
- **Alerts, ready to load.** `deploy/prometheus/alerts.yml` holds nine rules: the server not answering its scrape for 2 minutes, a save that failed, a 5xx, a team room that could not be written back or whose uploads did not fit its space, over 90 % of `MAX_ROOMS` or `MAX_CONNECTIONS` (the defaults are written in; change them with yours), many connections sent away because the disk is slow (`queue`), and more than two restarts in 30 minutes. `deploy/prometheus/prometheus.yml` is the scrape configuration above with the rules loaded.
- **Checked** on 2026-11-28 with Prometheus 3.5: `promtool check config` and `check rules` pass, and `promtool test rules alerts.test.yml` checks that the down, save, 5xx and rooms alerts fire when they should and not before. Prometheus scraped the server's image with the key (`up`); with the data folder made read-only, `/api/health` answered 503, an edit was refused (`rejected`, "The server could not save this edit"), and `CraftlyLiveSaveFailing` and `CraftlyLiveServerErrors` fired; with the server stopped, `CraftlyLiveDown` fired after its two minutes. Not checked: Alertmanager, and where it sends the alerts (mail, a chat, a pager), which is yours to set.

### 2.9 Accounts, teams and sync

Off unless `ACCOUNTS=1` (section 2.3). With it, people can make an account with an email and a password on your server, keep their designs there, open them on any device, and share folders with a team. How it works is in [`ACCOUNTS.md`](ACCOUNTS.md); the editor's side of it (signing in, syncing) is still being built, so for now this is the server only.

```bash
ACCOUNTS=1 SIGNUP=invite ADMIN_KEY=... ALLOW_ORIGIN=https://editor.example.org node dist-server/live.mjs
```

- **Who can sign up.** `SIGNUP=invite` (the default) means nobody can make an account without a code: a team's invite (an owner makes one) or a sign-up code from you. The first person on a new server needs one from you. There is no mail server: an email is a unique name to sign in with and is never checked. Signing up says whether an email is taken, but only to somebody with a good code.
- **Passwords** are kept as scrypt hashes (N = 2^15, r = 8, p = 1, 32 MiB of memory each while it runs); at most 4 are checked at once, and more is answered 503 for a moment. Measure a sign-in on your machine before you change anything (the cost is in each stored hash, so it can be raised later).
- **Sessions** are tokens sent in the `Authorization` header, never cookies; the server keeps their SHA-256. They last 30 days from their last use and 180 days at most, 20 a person. `ALLOW_ORIGIN` must name your editor: the browser asks first (a preflight) before sending the header, and pages of other origins are refused (403) on every account address, reading included.
- **Limits** per address and hour: 20 failed sign-ins (10 for one account; 100 for one account from everywhere, so one address cannot lock somebody out), 5 sign-ups, 20 wrong codes. Behind a proxy set `TRUST_PROXY=1`, or every visitor shares the proxy's allowance.
- **Body sizes.** A design is sent whole (up to 16 MiB with its thumbnail) and an upload up to about 12 MB: the proxy's `client_max_body_size 20m` of section 2.4 covers both.

The operator's tool needs `ADMIN_KEY` (section 2.3) and asks the running server, like `scripts/rooms.mjs`, from the machine itself or through a tunnel:

```bash
export ADMIN_KEY=...                            # the key the server was started with
export CRAFTLY_SERVER=http://127.0.0.1:8787     # the default
export CRAFTLY_APP=https://editor.example.org/  # for reset links
node scripts/accounts.mjs create-signup-code 1 168     # a code for one account, good for a week; shown once
node scripts/accounts.mjs list
node scripts/accounts.mjs reset ann@example.org        # prints https://editor.example.org/#/reset/<code>, good once for 24 hours
node scripts/accounts.mjs disable ann@example.org      # every session ends at once; signing in is refused
node scripts/accounts.mjs enable ann@example.org
node scripts/accounts.mjs delete ann@example.org --yes # the account and its own designs, for good
```

- A person who forgets their password and still has the recovery code shown at sign-up resets it themselves. Otherwise `reset` gives you a link to hand them by a way you trust (whoever has the link sets the password). Any reset ends every session of that person.
- `delete` is refused while the account is the last owner of a team that has other members, and names the teams. A team where the account is the only member goes with it.
- The script asks the server rather than working on `DATA_DIR`: the server changes the same files one request at a time, and a second program writing them at the same moment could undo a change; it also works where you have no shell on the volume. The cost: the server has to be running.

**What is kept, and backups.** Everything is under `DATA_DIR/accounts/` (section 2.5 applies: copy the folder; files are written whole and renamed into place). It holds people's emails and names, password hashes (scrypt: slow to guess, not impossible for a weak password), hashes of tokens and codes (useless without the token or code), every design of every space with its last 10 revisions, and uploads. A copy is as sensitive as all of that together: keep backups encrypted, and access to them as narrow as to the server. A restore brings back the sessions of its day; to end them after a restore you do not trust, disable and enable each account, or reset its password.

**Checked**: the endpoints, every refusal, the limits, a restart with the files in a temporary folder, the role table and `scripts/accounts.mjs`, by the tests of `src/server/accounts/` against a real server on a real port. The editor's side (signing in, sync, teams, editing a team's design live, clips and sounds) is checked in Chrome against the real server by `e2e/accounts.cjs`, on one machine. **Not checked**: a real browser across sites over HTTPS (another origin for the editor and the server, password managers, Safari and Firefox), a real deployment, the cost of hashing on a small server, a restore.

## 3. What is not there yet

- **A published image.** CI builds the image and `release-image.yml` publishes it on a version tag (section 2.1), but neither has run on GitHub yet, and no image is published.
- **A deployment on a real host.** The proxy configurations, the systemd unit, the backup and the restore are written from reading, not from running them in public.
- **Dashboards and alert rules.** The metrics are there (section 2.8), with a few alerts suggested in words; no Grafana dashboard and no rules file is shipped, and no real Prometheus has scraped the endpoint yet.
- **Logs.** The server writes a line when it starts. There is no access log; use the proxy's.
- **Accounts for rooms of links.** With `ACCOUNTS=1` (section 2.9) the editor signs in, syncs, and edits a team's design live in a room of its own, joined with the member's session. A room made from a link still knows no accounts: who may make a room, how long rooms live and whether an operator can list and delete rooms (section 2.7) depend on the settings in section 2.3: if a setting is not in that table, the server does not have it. Without `ROOM_CREATE_KEY` anybody who can reach `POST /api/rooms` can make rooms up to `MAX_ROOMS`; with it, everybody who has that one key can, and the server does not know one of them from another.
- **More than one server.** A room lives in the memory of one process and the files of one folder. Two servers behind a load balancer would each have their own rooms; there is no shared storage and no way to spread a room over processes.
- **A load test on production hardware.** One CPU carries about 1,000 busy people with edits acknowledged in about 0.1 s, measured in Docker on a desktop (docs/PERFORMANCE.md, "The live server under load", and `scripts/live-load.mjs` to run it again). Not measured on the machine you will run, for hours, or with large designs.
- **TLS in the server itself.** It speaks plain HTTP on purpose; use a proxy.
- **A compose file, Kubernetes manifests, a Helm chart.** None.
- **esbuild as a named dependency.** `server:build` uses the esbuild that Vite installs (see "Develop" in the README).
