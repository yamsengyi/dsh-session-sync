# dsh-sync (local development)

A DSH bundle that adds a personal sync hub for sessions and workspace
snapshots. One machine runs DSH and hosts the hub; every other PC installs the
bundle once, pairs with a code, and then only needs DSH started.

## Quickstart

Put the bundle under the DSH home, not a drive root, so no elevation is needed:

```
%USERPROFILE%\.dsh\bundles\dsh-sync
```

Server (the machine that will host the hub), after installing the bundle:

```text
/sync init-hub
```

The command writes `%USERPROFILE%\.dsh\dsh-sync\hub.json`, starts the hub
immediately, and shows the pairing code. No terminal and no restart.

Client (each PC, after installing the bundle):

```text
/sync pair https://sync.example.com XXXX-XXXX laptop
```

This writes `client.json` and starts syncing immediately. `/sync status` shows
the current hub/client state, and `/sync code` (or `/sync code rotate`) manages
the pairing code.

The CLI remains for automation and server handoff:
`node <bundle>\bin\dsh-sync.mjs init-hub|pair|status|code`.

See [docs/deploy-windows.md](docs/deploy-windows.md) for the domain and TLS
setup, and [docs/handoff.md](docs/handoff.md) to hand the server setup to that
machine's DSH agent.

## Layout

```
index.js              DSH host plugin (role auto | client | hub | idle)
bin/dsh-sync.mjs      init-hub / pair / status / code CLI
bin/hub.mjs           standalone hub, for a server without DSH
src/hub-server.js     HTTP hub: pairing, auth, sessions, checkpoints, blobs
src/sync-client.js    push/pull client used by the plugin and tests
src/manifest.js       workspace scan, ignore rules, three-way diff
src/protocol.js       errors, hashing, body and path validation
test/                 local protocol, plugin, recovery, and pairing tests
docs/                 protocol, deployment, handoff, plugin detail
```

The plugin has no build step and no runtime dependency: a profile-installed
bundle resolves from the directory, and the hub/client core runs under plain
Node so the protocol can be tested without a DSH host.

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

## Opting a workspace in

Automatic workspace commits only touch a folder that carries `.dsh-sync.json`
at its root. Create it once per project:

```js
import { initFolder } from '@local/dsh-sync'
await initFolder('/path/to/project')
```

The marker holds `{ "folderId": "..." }` and is an ordinary file, so the first
checkpoint delivers it to every other PC. Without the marker the folder is
never scanned or committed; `pushFolder` remains available for a one-off.

## Run the tests

```powershell
& $node --test .\test\local.test.mjs .\test\plugin.test.mjs .\test\recovery.test.mjs .\test\pairing.test.mjs
```

`$node` is the bundled Node reported by the workspace dependency loader; any
Node 22+ also works because the code uses only built-in modules and global
`fetch`.

## Phases

1. **Local** (done): loopback hub, pairing, two clients, recovery tests.
2. **LAN**: `init-hub --host 0.0.0.0`, firewall rule, clients point at the LAN
   URL.
3. **Domain**: Cloudflare Tunnel or Caddy in front of `127.0.0.1:8787`.
4. **Tailscale**: optional; reach the same loopback listener through the
   tailnet.
