# dsh-session-sync

A DSH bundle that adds a personal sync hub for sessions and workspace
snapshots. One machine runs DSH and hosts the hub; every other PC installs the
bundle once, pairs with a code, and then only needs DSH started.

## Install

**Plugins → Add plugin**, then paste:

```
https://github.com/yamsengyi/dsh-session-sync
```

The **Registry** dropdown applies to package-name installs; a GitHub URL
bypasses it, so leave the dropdown at its default. Pin a release with
`https://github.com/yamsengyi/dsh-session-sync#v0.4.1` if you want
reproducibility. Reload DSH once after installation so the plugin code and the
`/session-sync` command load.

For local development you can instead install the checkout by its absolute
directory path.

## Quickstart

Server (the machine that will host the hub), after installing the bundle:

```text
/session-sync init-hub
```

The command writes `%USERPROFILE%\.dsh\dsh-sync\hub.json`, starts the hub
immediately, and shows the pairing code. No terminal and no restart.

Client (each PC, after installing the bundle):

```text
/session-sync pair https://sync.example.com XXXX-XXXX laptop
```

This writes `client.json` and starts syncing immediately.
`/session-sync status` shows the current hub/client state, and
`/session-sync code` (or `/session-sync code rotate`) manages the pairing code.

CLI fallback for automation, from the installed package:

```powershell
node "$env:DSH_PROFILE_DIR\node_modules\@yamsengyi\dsh-session-sync\bin\session-sync.mjs" status
```

See [docs/deploy-windows.md](docs/deploy-windows.md) for the domain and TLS
setup, and [docs/handoff.md](docs/handoff.md) to hand the server setup to that
machine's DSH agent. The Korean version is
[docs/handoff.ko.md](docs/handoff.ko.md).

## Settings page

After reloading DSH, open **Settings → Session sync**:

- **Mode** — choose Host, Client, Both, or Off. The choice is a draft; the
  **Apply** button commits it. The current running state is shown beside it, so
  a toggle never starts or stops the hub on its own.
- **Host settings** (Host/Both) — port, concrete bind address, and the pairing
  code with copy/rotate.
- **Client settings** (Client/Both) — target URL in one line, fill it from the
  local host settings, enter the pairing code and device name, then pair or
  unpair.
- **Workspace** (Client/Both) — type a path or fill it from the current session,
  then mark the folder (`.dsh-sync.json`).
- **Sync now** (Client/Both) — pull the hub's newest checkpoint, upload the
  existing sessions whose working directory is the marked workspace, then push
  the workspace's current state, with a result summary.

Mode changes preserve the other role's configuration and token by writing an
`enabled` flag into `hub.json` / `client.json`; **Off** leaves both files in
place.

The page is a browser client that calls exact Host routes under
`/session-sync/api/...`. Connection authenticates every request as the browser
Peer; the bundle stays build-free. The `/session-sync` commands remain for
automation.

## Layout

```
index.js                  DSH host plugin (role auto | client | hub | idle)
client.js                 Settings → Session sync browser section
bin/session-sync.mjs      init-hub / pair / status / code CLI
bin/hub.mjs               standalone hub, for a server without DSH
src/hub-server.js         HTTP hub: pairing, auth, sessions, checkpoints, blobs
src/sync-client.js        push/pull client used by the plugin and tests
src/manifest.js           workspace scan, ignore rules, three-way diff
src/protocol.js           errors, hashing, body and path validation
test/                     local protocol, plugin, recovery, and pairing tests
docs/                     protocol, deployment, handoff, plugin detail
```

The plugin has no build step and no runtime dependency: a profile-installed
bundle resolves from the directory, and the hub/client core runs under plain
Node so the protocol can be tested without a DSH host. `engines.dsh` pins the
supported release range (`>=0.2.2-rc.3 <0.3.0`).

## Role resolution

`role: auto` (the bundle default) reads two marker files in the data directory:

| Marker | Effect |
|---|---|
| `hub.json` | start the hub on its configured host and port |
| `client.json` | sync this machine as a paired client |
| both | run the hub and sync this machine too |
| neither | inert |

Explicit `role: client`, `role: hub`, or `role: idle` overrides the markers.
`hubUrl`/`token` still work for a manual configuration, but pairing is the
intended path.

The data directory stays `%USERPROFILE%\.dsh\dsh-sync` (and the workspace marker
stays `.dsh-sync.json`) so existing hub history and marked workspaces continue
to work after this rename.

## Opting a workspace in

Automatic workspace commits only touch a folder that carries `.dsh-sync.json`
at its root:

```json
{ "folderId": "my-project-1a2b3c" }
```

Create it with the exported `initFolder(root, folderId?)` helper, or write it by
hand. The marker is an ordinary file, so the first checkpoint carries it to
every other PC: they address the same hub folder without any path mapping, even
when their absolute paths differ. Without the marker a workspace is never
scanned or committed.

## Run the tests

```powershell
& $node --test --test-concurrency=1 .\test\local.test.mjs .\test\plugin.test.mjs .\test\recovery.test.mjs .\test\pairing.test.mjs .\test\ui-api.test.mjs
```

`$node` is the bundled Node reported by the workspace dependency loader; any
Node 22+ also works because the code uses only built-in modules and global
`fetch`.

## Phases

1. **Local** (done): loopback hub, pairing, two clients, recovery tests.
2. **LAN**: `/session-sync init-hub 0.0.0.0 8787`, firewall rule, clients point
   at the LAN URL.
3. **Domain**: Cloudflare Tunnel or Caddy in front of `127.0.0.1:8787`.
4. **Tailscale**: optional; reach the same loopback listener through the
   tailnet.
