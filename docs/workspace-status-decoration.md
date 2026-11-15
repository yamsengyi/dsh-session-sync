# Workspace shared/local decoration — limitation and upstream request note

Status: 2026-11-15, plugin `v0.7.2` (`6afa2bb`)

This note records why the **built-in left Workspaces list** cannot show a
per-project shared/local circle/color, what the plugin does instead, and a
copy-ready request for a future DSH project or upstream feature request.

## Current, supported behavior

- **A. Session row badge** — `sidebar.session.row.trailing` renders a small
  `Shared`/`Local` label on every session row.
- **B. Projects entry** — `sidebar.session.action` renders a **Projects**
  button beside the sidebar's New session row. It opens a modal with
  **Shared projects** and **Local projects** groups.
- **Settings** — the same two groups also appear in
  Settings → Session sync → Shared workspace.
- **Workspace registration** — on load the plugin creates the
  `~\Documents\deepseek-harness\sync-default` container and, for each immediate
  child project folder, registers a DSH Workspace and marks it shared.
  `하위 폴더 스캔` repeats this after a new project folder is added. The
  container itself is not shared.
- All of the above use public slots/Host APIs; the plugin does not touch
  another plugin's DOM.

## What is not possible through public DSH extension points

1. **No per-workspace row seat.** `sidebar.workspaces` is a `single` slot owned
   by the built-in WorkspaceBrowser. That browser renders workspace headers,
   grouping, search, and rows internally. The available public decorations are
   per **session** (`sidebar.session.row.leading/trailing/hover`), not per
   **workspace**.
2. **No color/icon field on a Workspace.** The durable record is:
   `path`, `title`, `sessionIds`, `createdAt`, `updatedAt`.
   There is no `color`, `icon`, or `status` property.
3. **Folder color is theme state, not workspace state.** The folder icon uses
   `--dsw-alias-state-business-primary` while the workspace is active and
   `--dsw-alias-label-secondary`/tertiary otherwise. The blue folder in a
   screenshot therefore means “active workspace”, not “shared”.
4. **DOM override breaks the documented plugin contract.**
   `references/practices.md` says:
   - “Do not write DOM outside your component or append to `document.body`.”
   - “Contribute through slots: `ctx.slots.inject(...)`.”
   - “A plugin that subscribes, rescans, or writes DOM itself bypasses that
     incremental machinery.”
   `references/ui-plugin.md` says:
   - “Do not read another plugin's DOM, stylesheet, or component source to
     estimate placement; choose a slot that already allocates space.”

A `MutationObserver` that finds `[data-row-key="workspace:..."]` and injects a
`🟢/⚪` span, or a CSS/folder-color override, would work in practice but is
**unsupported, update-fragile, and outside DSH's plugin rules**. This project
does not use that approach.

## Desired DSH API (for a future request)

One of these would let the plugin show the status without renaming or
DOM-hacking:

1. **Per-workspace decoration slot**
   - `sidebar.workspaces.workspace.row.leading` or
     `sidebar.workspaces.workspace.row.trailing`
   - `kind: 'list'`, `scope: 'root'`
   - owner: `{ workspaceId, path, title, active }`
   - component renders a small circular status dot/emoji.
2. **Workspace `icon` / `color` / `status` field**
   - optional in `WorkspaceRecord`, propagated to `WorkspaceView`
   - plugin-owned status rendered by the host rows.
3. **Per-workspace theme token**
   - e.g. `--dsw-workspace-status-color`, set by the owning WorkspaceBrowser
     from a public workspace field.

The preferred minimal API is (1): it does not require the plugin to own the
workspace title or the host's folder icon.

## Copy-ready request (English)

> **Feature request: per-workspace status decoration in the Workspaces list**
>
> The Workspaces list exposes session-row decoration slots but no seat for a
> workspace row. Add a `kind: 'list'` slot such as
> `sidebar.workspaces.workspace.row.trailing` with owner props
> `{ workspaceId, path, title, active }`, or an optional
> `color`/`icon`/`status` field on the Workspace record that the built-in
> browser renders. This would let a plugin show a circular shared/local status
> indicator without renaming the workspace or injecting DOM. Current
> alternatives require replacing the whole WorkspaceBrowser or violating the
> “do not write DOM outside your component” practice.

## References

- `references/practices.md` (installed DSH dsh-doc skill), UI rules.
- `references/ui-plugin.md` (installed DSH dsh-doc skill), client slot rules.
- `dsh-client-ui-workspace/src/client/contract/slots.ts` — slot map; no
  workspace-row seat.
- `dsh-workspace/src/spec.ts` — Workspace record fields.
- `dsh-client-ui-workspace/src/client/rows/Rows.module.css` — folder color
  tokens.
- Sample images:
  - `docs/assets/projects-b-sample.png` (Settings groups)
  - `docs/assets/projects-entry-sample.png` (New session → Projects modal)
