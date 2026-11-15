# dsh-sync protocol v1

Status: local MVP. The hub and the client are the same Node package; the wire
format is plain JSON plus raw blobs so a different hub implementation can
replace it later without touching clients.

## Model

- **Folder**: one shared workspace identity. The client binds a local directory
  to a folder id chosen by the user (default: the directory basename slug).
- **Session**: DSH's append-only event log, identified by `SessionId`. Events
  are contiguous from `seq = 0` and never rewritten.
- **Checkpoint**: an immutable pair of `(sessionId, seq)` and a workspace
  **manifest** (`path -> blob sha256`). `version` is a per-folder monotonic
  integer starting at 1; `head` is the newest committed version.
- **Blob**: file content addressed by `sha256`. A checkpoint only references
  blobs; uploads are deduplicated and can happen before the commit.

Completion unit: a top-level `turn/end` event. The plugin buffers
`session/event` frames and pushes the suffix after the turn ends. Local
durability stays with the JSONL backend; hub delivery is best-effort and
retried from the buffer.

## Auth

Every `/v1` request except `GET /v1/health` and `POST /v1/pair` needs
`Authorization: Bearer <device-token>`. The hub stores only token hashes: the
devices enrolled through pairing live in `hub-state.json`, and optional
configured tokens are hashed in memory. A response without a valid token is
`401`.

## Pairing

`POST /v1/pair` is the public enrollment endpoint:

```json
{ "code": "ABCD-EFGH", "name": "laptop" }
```

- The code is the one in `hub-state.json` and `pairing-code.txt`; comparison is
  case- and separator-insensitive and rate limited per address (20 attempts a
  minute).
- A wrong code is `403 pairing-code-invalid`; too many attempts is
  `429 pairing-rate-limited`.
- Success returns the device token once:

```json
{ "ok": true, "token": "<64 hex characters>", "device": "laptop" }
```

The token is stored hashed and survives a hub restart. `GET /v1/pair` (auth)
returns the current code, and `POST /v1/pair/rotate` (auth) mints a new one.

## Endpoints

All bodies are JSON unless noted. Errors use
`{ "error": { "code": "...", "message": "...", "detail": ... } }`.

### Health

`GET /v1/health` -> `{ ok: true, protocol: "1" }`

### Sessions

`POST /v1/sessions/:id/events`

```json
{
  "header": { "id": "s-1", "version": 3, "createdAt": 1700000000000, "cwd": "..." },
  "events": [ { "type": "turn/start", "seq": 0, "time": 0, "data": {} } ],
  "expectHead": 0
}
```

- `expectHead` is optional. When present and stale the hub answers
  `409 { head }`.
- Events with `seq < head` are ignored; the first accepted event must equal
  `head`, and `seq` must increase by one. A gap rejects with
  `409 { head, code: "gap" }`.
- Response: `{ head }`.

`GET /v1/sessions/:id/events?after=<seq>&limit=<n>` ->
`{ header, head, events, nextAfter }` (limit defaults to 500, max 1000).

`GET /v1/sessions/:id` -> `{ header, head }` or `404`.

`GET /v1/sessions` -> `{ sessions: [{ id, header, head }] }`.

### Limits

A JSON request body is capped at **256 MiB**. An ordinary turn pushes only the
suffix after the hub head, so the cap binds only a first push that backfills a
very long session or a checkpoint with an enormous manifest. A push batch must
be contiguous from `head`; a client that exceeds the cap must split it.

### Blobs

`POST /v1/folders/:folder/blobs/missing` with `{ hashes: ["..."] }` ->
`{ missing: ["..."] }` (64-char lowercase hex).

`PUT /v1/folders/:folder/blobs/:sha` with the raw bytes as the body. The hub
streams to a temporary file, verifies the digest, and renames. Response
`{ sha, size }`.

`GET /v1/folders/:folder/blobs/:sha` -> raw bytes, or `404`.

### Checkpoints

`POST /v1/folders/:folder/checkpoints`

```json
{
  "checkpoint": {
    "sessionId": "s-1",
    "seq": 42,
    "message": "turn 3",
    "author": "dev-a",
    "files": [
      { "path": "src/app.js", "blob": "<sha256>", "size": 123, "executable": false }
    ],
    "dirs": ["src"]
  }
}
```

- The folder is created on first commit; `name` may be supplied once.
- Every referenced blob must already exist, otherwise `409 missing-blobs`
  with `{ missing }` so the client can upload and retry.
- Paths are POSIX relative, no `..`, no absolute, no backslash.
- Response: `{ version, checkpointId, headVersion }`.

`GET /v1/folders/:folder/head` -> `{ version, checkpointId, updatedAt }`.

`GET /v1/folders/:folder/checkpoints?after=<version>` ->
`{ headVersion, checkpoints: [summary] }` where a summary omits `files`/`dirs`
and carries `fileCount`.

`GET /v1/folders/:folder/checkpoints/:version` -> the complete checkpoint.

## Conflict policy

Pull is a three-way apply over `base` (the manifest last applied on this PC),
`local` (a fresh scan), and `remote` (the target checkpoint):

- only remote changed -> write remote
- only local changed -> keep local
- both changed, or both added differently -> keep local, write the remote
  content to `.dsh-sync/conflicts/<timestamp>/<path>` and report it
- local deleted while remote changed -> keep the deletion and record the
  remote content as a conflict
- remote deleted while local changed -> keep local and report the deletion

There is no silent overwrite. `.dsh-sync/` is always ignored by scans.

## Versioning

`X-DSH-Sync-Protocol: 1` is sent by clients and checked by the hub; a mismatch
is answered `426`. This is a personal single-user protocol: no multi-tenant
ACLs, no merge, no real-time collaboration.

## Validation phases

1. Local: both roles on one machine over loopback.
2. LAN: bind `hubHost` to a concrete interface address, open the firewall.
3. Domain: reverse proxy or tunnel terminating TLS; keep the hub listener
   private.
4. Tailscale: bind the hub to the tailnet address or keep loopback and use
   `tailscale serve`.
