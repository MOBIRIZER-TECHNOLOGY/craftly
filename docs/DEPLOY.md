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
- The image sets `HOST=0.0.0.0`, `PORT=8787` and `DATA_DIR=/data`. The other settings (section 2.3) are passed with `-e`.
- `docker stop` sends SIGTERM; the server saves and exits.
- If you mount a folder of the host instead of a named volume (`-v /srv/craftly-live:/data`), it must be writable by uid 1000, the `node` user of the image.

**This image has not been built.** There is no Docker on the machine where the Dockerfile was written. What was done instead, by hand and outside a container: the bundle was built from only the files the Dockerfile copies (`package.json`, `package-lock.json`, `tsconfig.json`, `src/`, `scripts/`); `scripts/server-runtime-package.mjs` wrote the two package files; `npm ci --omit=dev --ignore-scripts` from them installed `ws` 8.22.2 and nothing else; the server started from that folder and answered `/api/health`; the health command returned 0 with the server up and 1 with it down. Not checked: that `npm ci` of the whole project succeeds on Alpine Linux, the ownership of the volume, the health check as Docker runs it, the size of the image, and stopping with `docker stop`. Build it once and watch the output before you rely on it.

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

Keep `HOST=127.0.0.1` here: the proxy is on the same machine, and nothing else should reach the port.

### 2.3 Settings

All settings are environment variables, read once at the start by `src/server/main.ts`. A number that is not a whole number in its range stops the server at once with a message that names the variable.

<!-- ENV-TABLE: keep in step with src/server/main.ts -->

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `8787` | The port to listen on (0 to 65535; 0 lets the system choose, and the start line says which). |
| `HOST` | `127.0.0.1` | The address to listen on. `127.0.0.1` is reachable from the same machine only. `0.0.0.0` is every address, which is what a container needs (the image sets it); on a machine without a container, use it only with a firewall or a proxy in front. |
| `DATA_DIR` | `live-data` | The folder for the rooms, made if it is not there. Relative to the folder the server is started from; give a full path in production. |
| `ALLOW_ORIGIN` | (none) | The origin of the editor, as the browser sends it: `https://editor.example.org`, no path, no slash at the end. Several, separated by commas, or `*` for any. Without it the server sends no cross-origin headers, and an editor on another origin cannot make or join rooms. Name your editor's origin; `*` is for trying things out. |
| `MAX_ROOMS` | `1000` | How many rooms the server keeps. Making one more is refused with 503. |
| `MAX_PEERS_PER_ROOM` | `50` | How many people can be in one room at once. |

**This table must be kept in step with `src/server/main.ts`**: a variable added there and not here does not exist for an operator. The comment at the top of `main.ts` lists the variables too. The plan of the night of 2026-11-13 ([`OVERNIGHT-PLAN.md`](OVERNIGHT-PLAN.md), items A1 and A4 to A8) adds a key for making rooms (`ROOM_CREATE_KEY`), expiry (`ROOM_TTL_DAYS`), an operator key (`ADMIN_KEY`), `TRUST_PROXY` for `X-Forwarded-For` and limits per address; a variable is in the table above only if `main.ts` read it when this section was last edited.

Limits that are not settings (they are options of `createLiveServer` in `src/server/live.ts`, with these defaults): 4 MiB per WebSocket message, 16 MiB for a design, 9 MiB per shared image and 36 MiB of images per room, a burst of 200 messages and then 100 a second per connection, a ping every 30 seconds.

### 2.4 A reverse proxy for TLS

The proxy holds the certificate, listens on 443, and passes both ordinary requests and the WebSocket upgrade on to the server. Three things matter:

- **The WebSocket upgrade** on `/ws` must be passed on (`Upgrade` and `Connection` headers, HTTP/1.1 to the server).
- **Body size.** `POST /api/rooms` carries a whole design (up to 16 MiB) and an image upload up to about 12 MB. nginx refuses bodies over 1 MB unless told otherwise, and sharing a design with pictures in it would then fail.
- **Idle time.** The server pings every connection every 30 seconds, so a proxy that closes connections idle for 60 seconds (the default of nginx) leaves them alone. Do not set that time below about 45 seconds.

Both examples set `X-Forwarded-For`, the address of the browser as the proxy saw it. Whether the server uses it depends on its settings (section 2.3): it must only ever be believed when the server can be reached through the proxy alone, since anybody who reaches the port directly can write that header themselves.

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

    client_max_body_size 20m;

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

Neither configuration has been run against the live server: they are written from the documentation of the two programs and from what the server needs. The key of a room is never in an address (it is in the first WebSocket message), so the access log of the proxy holds room ids and no keys.

Check a deployment from outside:

```bash
curl -i https://live.example.org/api/health        # 200 {"ok":true,...}; 503 means the data folder cannot be written
```

Then start a live session from your editor with `https://live.example.org` as the server and open the link in a second browser.

### 2.5 Where the data lives, and backing it up

Everything the server keeps is in `DATA_DIR` (`/data` in the container, the volume `craftly-live-data` in the example above): the shared designs, their uploaded images, revision numbers, and the SHA-256 hashes of the edit, view and owner keys. There is no database and nothing is kept anywhere else. Lose the folder and every link stops working; the people who joined still have their own copy of each design in their browser.

- **What a backup holds.** The designs in plain text, pictures included. The keys cannot be read out of it (only their hashes are stored), so a copy cannot be used to edit or view through the server, but anybody who has the copy can read the designs. Store it like the designs themselves.
- **Taking one.** Copy the folder. Every file is written whole under another name and renamed into place, so a copy taken while the server runs holds each file either before or after a save, never half of one. A copy taken at a busy moment can still hold files from slightly different moments; for a copy that is certainly consistent, stop the server first (it saves on SIGTERM), copy, start it again. Files ending in `.tmp` are saves that were interrupted, and can be left out.

  ```bash
  docker run --rm -v craftly-live-data:/data:ro -v "$PWD":/backup alpine \
    tar czf /backup/craftly-live-$(date +%F).tar.gz -C /data .
  # without Docker:
  tar czf craftly-live-$(date +%F).tar.gz -C /var/lib/craftly-live .
  ```

- **Restoring.** Stop the server, put the files back into an empty `DATA_DIR` owned by the user the server runs as, start it. Links made before the backup work again; edits made after it are gone from the server, and what a browser that was ahead of the restored copy does on its next visit has not been tried. A restore has not been rehearsed: try one before you need it.
- **Growth.** A room stays until its owner stops sharing; the images of a room are kept as long as the room. Watch the size of the folder.

### 2.6 What to put in the editor's `connect-src`

The editor's Content-Security-Policy (section 1) allows connections to its own site and to Hugging Face only. A live session makes fetches to the server (`https://`) and opens a WebSocket to it (`wss://`), and CSP treats those as two sources. Add both to `connect-src` in `public/_headers` before you build (or in your host's configuration):

```
connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co blob: data: https://live.example.org wss://live.example.org;
```

and set `ALLOW_ORIGIN` on the server to the editor's origin (the other direction of the same permission). People type the server's address into **Share > Work together**; nothing about it is built into the editor.

The live journeys (`e2e/live.cjs`) pass against a production build under the policy with `http://127.0.0.1:8788 ws://127.0.0.1:8788` added; a public pair of `https://` and `wss://` addresses behind a proxy has not been tried.

## 3. What is not there yet

- **A built and tested image.** `Dockerfile.server` has never been through `docker build` (section 2.1). No image is published anywhere, and CI does not build one.
- **A deployment on a real host.** The proxy configurations, the systemd unit, the backup and the restore are written from reading, not from running them in public.
- **Metrics.** There is no metrics endpoint. One is planned (connections, rooms in memory, saves, refusals, in a form Prometheus reads). Until then `/api/health` and the start line are all the server says about itself.
- **Logs.** The server writes a line when it starts. There is no access log; use the proxy's.
- **Accounts.** There are none. Who may make a room, how long rooms live and what an operator can list or delete depend on the settings in section 2.3: if a setting is not in that table, the server does not have it, and then anybody who can reach `POST /api/rooms` can make rooms up to `MAX_ROOMS`.
- **More than one server.** A room lives in the memory of one process and the files of one folder. Two servers behind a load balancer would each have their own rooms; there is no shared storage and no way to spread a room over processes.
- **A load test.** How many rooms and people one server carries has not been measured.
- **TLS in the server itself.** It speaks plain HTTP on purpose; use a proxy.
- **A compose file, Kubernetes manifests, a Helm chart.** None.
- **esbuild as a named dependency.** `server:build` uses the esbuild that Vite installs (see "Develop" in the README).
