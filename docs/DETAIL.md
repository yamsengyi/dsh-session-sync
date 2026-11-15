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
| `hub.json` | start the hub on its configured host and port |
| `client.json` | sync this machine as a paired client |
| both | run the hub and sync this machine too |
| neither | inert |

`role: client`, `role: hub`, or `role: idle` overrides the markers. The hub can
also run without DSH — see [deploy.md](deploy.md); the Windows flow is in
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
`https://github.com/yamsengyi/dsh-sync` (the Registry dropdown does not apply to
a GitHub URL). Reload DSH once. Then, inside DSH:

Server, once:

```text
/sync init-hub
```

It writes `hub.json`, starts the hub immediately, and returns the pairing code.
No terminal and no restart are needed.

Client, once after installing the bundle:

```text
/sync pair https://sync.example.com XXXX-XXXX laptop
```

`pair` exchanges the code for a device token, writes `client.json`, and starts
syncing immediately. `/sync status` reports the current state and
`/sync code [rotate]` manages the code.

The CLI (`bin/dsh-sync.mjs init-hub|pair|status|code`) remains for automation
and for a DSH agent that prefers shell commands. Marker files are watched, so a
CLI write also applies without restarting DSH.

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
