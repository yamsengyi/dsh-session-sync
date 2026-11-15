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
`https://github.com/yamsengyi/dsh-session-sync#v0.9.5` if you want
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

- **Language** — **Auto** follows the DSH interface language
  (`<html lang>`); English, 中文, and 한국어 can be selected explicitly. The
  choice is stored per browser and never defaults to Korean.
- **Mode** — choose Host, Client, or Off. The choice is a draft; the
  **Apply** button commits it. The current running state is shown beside it, so
  a toggle never starts or stops the hub on its own. **Host** also uploads this
  machine's own sessions and workspace to its hub; a separate Both mode is not
  needed.
- **Host settings** — port, concrete bind address, and the pairing code with
  copy/rotate. The host's own sync source is automatic.
- **Client settings** — target URL in one line, fill it from the local host
  settings, enter the pairing code and device name, then pair or unpair.
- **Workspace** (Host/Client) — type a path or fill it from the current session,
  then mark the folder (`.dsh-sync.json`). The default
  `~\Documents\deepseek-harness\sync-default` is a **container**: each immediate
  child folder becomes its own DSH Workspace and is marked shared automatically;
  the container itself is not shared. Use **하위 폴더 스캔** after adding a
  project folder. A **Projects** button beside the sidebar's New session button
  opens a modal with **공유 프로젝트** and **로컬 프로젝트** groups; the same
  groups appear in Settings. Left sidebar session rows also carry a small
  **공유/로컬** badge. **동기화 해제** removes the marker without deleting
  workspace files or hub checkpoints; the `.dsh-sync` state is kept so
  re-marking can resume from the old base. Set `defaultWorkspaceMode` to
  `root` to share the container itself, or `off` to disable the automatic scan.
- **Sync now** (Host/Client) — pull the hub's newest checkpoint, upload the
  existing sessions whose working directory is the marked workspace, then push
  the workspace's current state, with a result summary.

Mode changes preserve the other role's configuration and token by writing an
`enabled` flag into `hub.json` / `client.json`; **Off** leaves both files in
place.

The page is a browser client that calls exact Host routes under
`/session-sync/api/...`. Connection authenticates every request as the browser
Peer; the bundle stays build-free. The `/session-sync` commands remain for
automation.

### First sync and existing files

A hub keeps numbered checkpoint versions, but the working folder holds **one
merged state**, not one folder per version. The first pull has no common base:

- local-only files are **kept** (remote absence does not delete them),
- remote-only files are added,
- a path that exists on both sides with different content becomes a conflict:
  the local file stays, and the remote copy is saved under
  `.dsh-sync/conflicts/<stamp>/...` (ignored by later checkpoints).

The plugin's `defaultWorkspace` config (bundle default
`~\Documents\deepseek-harness\sync-default`) is created empty on load and appears
in the workspace list even before it is marked. A new empty folder is still the
safest first-sync target.

[B Settings 그룹 샘플](docs/assets/projects-b-sample.png) ·
[New session 옆 Projects 진입 샘플](docs/assets/projects-entry-sample.png) ·
[Workspace decoration 한계/upstream 요청 메모](docs/workspace-status-decoration.md)

## Import a shared project (Join)

On the receiving PC, open the **Projects** modal beside **New session**. The
**Projects** tab is one unified list of local and server projects, each tagged
**Synced**, **Server only**, or **Local only**. A **Server only** row offers
**Import**:

1. The default save path is `<shared root>/<project name>`, where the shared root
   is `defaultWorkspace` (`~\Documents\deepseek-harness\sync-default` by default).
2. **경로 변경** exposes the path input; **기본 경로** restores the default.
3. **확인** performs the requested order:
   - create the local folder/marker and register the DSH Workspace,
   - create/open a project session in that workspace,
   - pull the hub checkpoint into the folder.

Use an empty folder when possible. This is a per-project operation: one project
maps to one local root; multiple roots per project are not supported. Session
history is not imported—Join handles workspace files only.

## Default root vs shared projects

DSH creates its own first-use workspace at
`<Documents>\deepseek-harness\default-workspace`; this plugin never creates or
moves that folder. Its own
`~\Documents\deepseek-harness\sync-default` is a container: on load (and on
**하위 폴더 스캔**) each immediate child directory is registered as a DSH
Workspace and marked shared. The container itself is not shared. Only marked
projects sync; `default-workspace` and other unmarked projects remain local, and
session auto-push is gated by the workspace marker.

To change where DSH creates **future** default workspaces, override the
workspace controller in the profile patch:

```yaml
- id: workspace-controller
  name: "@deepseek-ai/dsh-api-workspace-controller"
  config:
    documentsDirectory: "D:\\DSH"
```

The default then becomes `D:\DSH\deepseek-harness\default-workspace`. An existing
default workspace keeps its old path; create a new workspace for the new
location instead of moving the recorded one.

- **Update check** — the settings footer compares the installed version with
  the latest GitHub tag and offers a manual check. Each installed profile checks
  independently; the result is cached for an hour.
- **Unified Projects modal** — the **Projects** button beside **New session** is
  the single management surface for both Host and Client. Its **Projects** tab
  merges local workspaces and hub projects into one list (Synced / Server only /
  Local only), and its **Sessions** tab lists every session stored on the hub.
  There is no separate Host-only server panel; the Host sees the same hub through
  its self-client.
- **Manual update status** — Settings → General shows the same current/latest
  check as the footer. Installation stays with the DSH Plugin Manager
  (Plugins → the bundle → Update, or reinstall the latest GitHub URL); this
  plugin does not replace its own running bundle. The Plugin Manager owns the
  update dialog, progress, restart, and rollback.

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
docs/                     protocol, deployment, handoff, plugin detail,
                          workspace decoration upstream note
```

The plugin has no build step and no runtime dependency: a profile-installed
bundle resolves from the directory, and the hub/client core runs under plain
Node so the protocol can be tested without a DSH host. `engines.dsh` pins the
supported release range (`>=0.2.2-rc.3 <0.3.0`).

## Role resolution

`role: auto` (the bundle default) reads two marker files in the data directory:

| Marker | Effect |
|---|---|
| `hub.json` | start the hub and run the automatic host-self uploader |
| `client.json` | sync this machine as a paired client when no hub is enabled |
| neither | inert |

A Host writes `self-client.json` with a local device token automatically; that
is internal state, not a marker the operator edits. If both `hub.json` and
`client.json` exist, Host wins and `client.json` is kept for a later Client-mode
switch.

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
& $node --test --test-concurrency=1 .\test\local.test.mjs .\test\manifest.test.mjs .\test\plugin.test.mjs .\test\recovery.test.mjs .\test\pairing.test.mjs .\test\ui-api.test.mjs .\test\update-check.test.mjs
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
