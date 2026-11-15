# Session sync

Push finished turns and workspace snapshots to a personal hub, then pull them
onto another PC. This is history sharing, not real-time collaboration: one
writer per session, commits at completion, and pull on demand.

## What it does

- **Sessions**: buffers `session/event` and pushes the suffix to the hub after
  each `turn/end`. A late start backfills the missing prefix from local
  session persistence, so the hub always holds a contiguous log.
- **Workspaces**: `pushCheckpoint` scans a folder, uploads only missing blobs
  (content addressed by sha256), and commits a manifest tied to the session
  position. `pullCheckpoint` applies the newest checkpoint with a three-way
  compare against the last applied manifest.
- **Conflicts** are never silent: the local file wins, the remote content is
  saved under `.dsh-sync/conflicts/`, and the pull result reports every path.

## Roles and configuration

`role: auto` (default) decides at startup from marker files in the data
directory:

| Marker | Effect |
|---|---|
| `hub.json` | start the hub and run the automatic host-self uploader |
| `client.json` | sync this machine as a paired client when no hub is enabled |
| neither | inert |

`role: client`, `role: hub`, or `role: idle` overrides the markers. A Host
creates `self-client.json` with a local device token and runs an in-process
client, so its own sessions and workspace reach its hub without a pairing step.
When both `hub.json` and `client.json` exist, Host wins; `client.json` stays for
a later Client-mode switch. The hub can also run without DSH — see
[deploy.md](deploy.md); the Windows flow is in
[deploy-windows.md](deploy-windows.md), and [handoff.md](handoff.md) is a prompt
for the server's DSH agent.

| Key | Meaning |
|---|---|
| `role` | `auto` (default), `client`, `hub`, or `idle` |
| `hubUrl` / `token` | Optional manual override for a paired client |
| `dataDir` | Marker and storage root; defaults to `$DSH_HOME/dsh-sync` |
| `hubHost` / `hubPort` | Listener fallback when `hub.json` omits them |
| `hubTokens` | Optional preconfigured `[{ name, token }]` credentials |
| `autoPush` | Push finished turns automatically (default `true`) |
| `autoCheckpoint` | Commit marked workspaces after a finished turn (default `true`) |
| `checkpointIntervalMs` | Minimum gap between automatic commits per workspace (default `30000`) |
| `deviceName` | Author recorded on checkpoints; defaults to the host name |

### Setup

Install it from GitHub: **Plugins → Add plugin**, then paste
`https://github.com/yamsengyi/dsh-session-sync` (the Registry dropdown does not
apply to a GitHub URL). Reload DSH once. Then, inside DSH:

Server, once:

```text
/session-sync init-hub
```

It writes `hub.json`, starts the hub, creates the host-self uploader, and returns
the pairing code. No terminal and no restart are needed.

Client, once after installing the bundle:

```text
/session-sync pair https://sync.example.com XXXX-XXXX laptop
```

`pair` exchanges the code for a device token, writes `client.json`, and starts
syncing immediately. `/session-sync status` reports the current state and
`/session-sync code [rotate]` manages the code.

The CLI (`bin/session-sync.mjs init-hub|pair|status|code`) remains for
automation and for a DSH agent that prefers shell commands. Marker files are
watched, so a CLI write also applies without restarting DSH.

## Settings page

The bundle also ships a browser section (`client.js`) at **Settings → Session
sync**. It controls the same markers the commands write:

| Control | Effect |
|---|---|
| Mode (Host / Client / Off) + Apply | Host writes `hub.json`; Client writes `client.json`; Off disables both. The other role's settings and token are preserved |
| Host port + bind | updates `hub.json`, starts/stops the hub, shows the pairing code, and maintains the automatic host-self uploader |
| Client target URL + code + name | pairs against a hub, writes `client.json`, starts/stops the external client |
| Workspace path + current session (Host/Client) | writes `.dsh-sync.json` into the chosen folder; the project list is split into 공유 프로젝트 and 로컬 프로젝트, each row carries the state badge, and left-sidebar session rows carry a small 공유/로컬 badge. The source is saved DSH workspaces plus the configured default and current selection, not arbitrary session cwds. **동기화 해제** removes only the marker; workspace files and hub checkpoints stay, and `.dsh-sync` is kept for an incremental re-mark. The unset default is `~\Documents\deepseek-harness\sync-default`, created empty on load |
| Sync now (Host/Client) | pulls the hub's newest checkpoint, uploads existing sessions for the marked workspace, then pushes the local workspace |

The mode selection is a draft; **Apply** commits it, and the current running
state is shown beside the selector so a toggle never starts or stops the hub on
its own. Host mode starts the hub and its automatic self-uploader together; the
status line reads `Host running (self-sync)` while both are active.

The page calls exact Host routes under `/session-sync/api/...`
(`status`, `mode`, `pair`, `unpair`, `workspace`, `workspace/unmark`, `session`,
`sync`, `code`, `update`). Connection checks the Host/Origin fence and browser
Peer on every route. The section needs the Web carrier and the `connection`
service; a headless composition without them simply has no page.

The client half also registers `sidebar.session.row.trailing` as a small
`공유`/`로컬` badge, and `sidebar.session.action` as a **Projects** button beside
the sidebar's New session row. The button opens a modal with the same
공유 프로젝트 / 로컬 프로젝트 groups. This is a separate list, not a re-grouping
of the built-in Workspaces list; DSH exposes no per-workspace row slot.

Mode switches use the marker files, so they require `role: auto` (the bundle
default). An explicit `role: hub` or `role: client` override in a profile patch
wins over the markers and makes the host/client toggles ineffective.

## First sync and existing files

A folder can hold existing work and previously pulled checkpoints at the same
time. The working tree is a single merged state; the hub keeps the numbered
versions. When a pull has no usable local base:

- a local-only file is kept, even though the remote manifest lacks it;
- a remote-only file is written;
- a same-path difference keeps the local file and stores the remote blob under
  `.dsh-sync/conflicts/<stamp>/<path>`, which the checkpoint ignore rules skip.

The Settings page lists known workspaces and marks each one 공유 or 로컬. The
`defaultWorkspace` config defaults to `~\Documents\deepseek-harness\sync-default`;
the plugin creates that folder empty on load, so a fresh install always has the
same explicit default option. Override it with a fully qualified path when the
account's Documents folder is redirected.

## Default workspace vs shared workspace

The first-use workspace at `<Documents>\deepseek-harness\default-workspace` is
created by DSH's workspace controller, not by this plugin. The plugin's own
`defaultWorkspace` (`~\Documents\deepseek-harness\sync-default`) is created empty
on load and registered through `ctx.workspaceRegistry.create(...)` when it is not
already a DSH Workspace, so it appears in the left Workspaces list without a
manual add.

A deployment can change where DSH creates **future** default workspaces through
the controller's `documentsDirectory` config (a fully qualified Host path). The
existing default workspace record is not moved by that change.

## Update check

The settings footer shows the installed `pluginVersion` and a cached update
result. Opening the page checks GitHub tags once (cached for an hour); the
**업데이트 확인** button forces a check with a 60-second floor. The Host compares
the highest stable tag with its own version and reports `updateAvailable`; a
network failure is reported as text and never blocks settings. Each installed
profile checks independently, so every PC can see whether its bundle is behind.

## UI language

The section reads the DSH document language (`<html lang>`, which the client
locale plugin keeps in sync) and falls back to English, then to Chinese or
Korean only when that is the detected language. A per-browser selector offers
**Auto (DSH)**, **English**, **中文**, and **한국어**; the explicit choice is stored
in `localStorage` under `dsh-session-sync.locale`. There is no hardcoded Korean
default. The section title stays the language-neutral brand `Session sync`.

The dictionary covers all labels, hints, buttons, sync summaries, and the
common Host error codes. A network failure in the update check is reported in
the selected language with the raw detail appended.

## Opting a workspace in

Automatic commits only touch a workspace that carries `.dsh-sync.json` at its
root:

```json
{ "folderId": "my-project-1a2b3c" }
```

Create it with the exported `initFolder(root, folderId?)` helper, or write it by
hand. The marker is an ordinary file, so the first checkpoint carries it to
every other PC: they address the same hub folder without any path mapping, even
when their absolute paths differ. Without the marker a workspace is never
scanned or committed.

## Limits

- No real-time messaging, no multi-user ACLs: every token is a device of the
  same person.
- Pulled sessions are read-only copies until a later import/continue step;
  the hub stores history, it does not run agents.
- Attachments referenced by session events live in `$DSH_HOME/attachments` and
  are not mirrored yet.
- One JSON request body is capped at **256 MiB**. A normal turn pushes only the
  new suffix; the cap matters when a first push backfills a very long session.
- Delivery is best effort: a push failure keeps the buffer and retries after
  the next event or the 60-second sweep. Local durability is never blocked on
  the hub.
- No UI yet: turns push automatically, and pulling is available through the
  exported `pullFolder`/`pushFolder` helpers.
- A checkpoint whose manifest equals the current head is skipped instead of
  committed again, so turns that did not touch the workspace do not grow the
  history. Pass `force` to `pushCheckpoint` for an explicit duplicate commit.
- Automatic workspace commits require the `.dsh-sync.json` marker. A workspace
  without it is never scanned; use `pushFolder` for a one-off commit.
- Checkpoint manifests are stored inline in `folder.json`; a very large
  workspace makes that file large. Split storage is deferred until a real
  workspace needs it.
