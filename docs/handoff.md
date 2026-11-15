# Hand the Windows setup to the server's DSH

The server's DSH agent can do the whole native setup if it has the bundle and a
short, unambiguous task. Give it the repository copy and the prompt below.

## Before handing off

1. Copy the bundle to the server under the DSH home, not a drive root:
   `%USERPROFILE%\.dsh\bundles\dsh-sync`.
2. Decide:
   - the public hostname, for example `sync.example.com`;
   - Cloudflare Tunnel (no public IP needed) or Caddy (public IP);
   - whether the hub binds `127.0.0.1` (proxy) or `0.0.0.0` (direct LAN).
3. If the server's DSH is not running elevated, plan for the operator to approve
   the UAC prompt or run the elevated commands (tunnel service, firewall).

## Prompt

```text
You are on a Windows machine that will host the dsh-sync hub for one person's
PCs. Use a native setup; do not use Docker.

The bundle source is already copied to:
  %USERPROFILE%\.dsh\bundles\dsh-sync

Do this and report every deviation:
1. Verify `node --version` is 22 or newer, and that package.json and
   bin\dsh-sync.mjs exist in that directory.
2. Install the bundle into this DSH profile. Prefer your plugin_manager tool
   with action `install_bundle` and that directory as the target. If the tool is
   not available, tell the operator to use Plugins > Add plugin > local
   directory and pick the same directory.
3. Create and start the hub with the CLI (the operator can also type
   `/sync init-hub` in DSH after the bundle is installed):
     node "%USERPROFILE%\.dsh\bundles\dsh-sync\bin\dsh-sync.mjs" init-hub --host 127.0.0.1 --port 8787
   This writes %USERPROFILE%\.dsh\dsh-sync\hub.json and prints a pairing code.
   If DSH is already running, the plugin notices the marker and starts the hub
   without a restart; otherwise it starts on the next DSH launch.
   Use --host 0.0.0.0 instead only if clients must reach this machine directly
   on the LAN; then allow inbound TCP 8787 on the Private profile.
4. Publish the hub at https://sync.example.com with Cloudflare Tunnel
   (preferred):
     cloudflared tunnel login
     cloudflared tunnel create dsh-sync
     cloudflared tunnel route dns dsh-sync sync.example.com
   Put the ingress for http://127.0.0.1:8787 in the cloudflared config, install
   or schedule the tunnel, and keep port 8787 closed to the internet.
   If Caddy is chosen instead: reverse_proxy 127.0.0.1:8787, open 80/443 only,
   and run Caddy at startup.
5. Confirm the hub listener and read the pairing code from:
     %USERPROFILE%\.dsh\dsh-sync\hub\pairing-code.txt
   (or run `... dsh-sync.mjs code`).
6. Verify:
     Invoke-RestMethod https://sync.example.com/v1/health
     node "%USERPROFILE%\.dsh\bundles\dsh-sync\bin\dsh-sync.mjs" pair --hub https://sync.example.com --code <code> --name server-selftest
     Invoke-RestMethod https://sync.example.com/v1/sessions -Headers @{ Authorization = "Bearer <token from client.json>" }
   Health must be 200 and the authenticated list must be 200. Delete the
   server-selftest client.json afterwards if it is not wanted.
7. Report: Node version, install result, hub listener, tunnel/Caddy status,
   health output, pairing-code file path (not the code itself), firewall and
   network-profile changes, and anything you could not do without elevation.

Constraints:
- Keep all files under %USERPROFILE%\.dsh; do not use C:\ or Program Files, and
  do not request elevation for file placement.
- Data lives in %USERPROFILE%\.dsh\dsh-sync; do not delete or move it.
- Never expose 8787 to the public internet.
- Do not print device tokens or the pairing code into logs, chat, or tickets;
  the operator reads the pairing code from the file.
- Ask the operator before UAC-elevated commands if you are not elevated.
```

## What the operator still does

- Approve any UAC prompt for the tunnel service or firewall rule.
- Read the pairing code from the file and hand it to each client once.
- On each client, install the bundle and type
  `/sync pair <hub-url> <code> <name>` in DSH; no terminal is needed.

## What the agent should not decide

- The domain name, DNS provider, and whether Cloudflare Tunnel or Caddy is used.
- Moving the hub data directory or deleting old sessions.
- Opening the hub port to the internet instead of using the tunnel/proxy.
