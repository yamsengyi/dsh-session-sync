# Hand the Windows setup to the server's DSH

The server's DSH agent can install the bundle and wire the domain if it has a
short, unambiguous task. The bundle is public, so no file copy or GitHub login
is needed on the server.

## Before handing off

Decide:

- the public hostname, for example `sync.example.com`;
- Cloudflare Tunnel (no public IP needed) or Caddy (public IP);
- whether the hub binds `127.0.0.1` (proxy) or `0.0.0.0` (direct LAN).

If the server's DSH is not running elevated, the operator must approve the UAC
prompt or run the elevated commands (tunnel service, firewall).

## Prompt

```text
You are on a Windows machine that will host the dsh-session-sync hub for one person's
PCs. Use a native setup; do not use Docker.

Install source (public GitHub repository):
  https://github.com/yamsengyi/dsh-session-sync

Do this and report every deviation:
1. Install the bundle into this DSH profile. Prefer your plugin_manager tool
   with action `install_bundle` and that GitHub URL as the target. The Registry
   dropdown does not apply to a GitHub URL. If the tool is not available, tell
   the operator to use Plugins > Add plugin and paste the same URL.
2. Reload DSH once so the plugin code, the Settings section, and the
   /session-sync command load.
3. Ask the operator to open Settings > Session sync > Host mode, enable the
   host, set port 8787, choose bind 127.0.0.1 (or 0.0.0.0 for direct LAN), and
   press Apply. This writes %USERPROFILE%\.dsh\dsh-sync\hub.json and shows the
   pairing code.
   If the Settings page is unavailable, use `/session-sync init-hub` or, with a
   Node executable, the installed CLI:
     node "$env:DSH_PROFILE_DIR\node_modules\@yamsengyi\dsh-session-sync\bin\session-sync.mjs" init-hub --host 127.0.0.1 --port 8787
   Use 0.0.0.0 only if clients must reach this machine directly on the LAN; then
   allow inbound TCP 8787 on the Private profile.
4. Publish the hub at https://sync.example.com with Cloudflare Tunnel
   (preferred):
     cloudflared tunnel login
     cloudflared tunnel create dsh-session-sync
     cloudflared tunnel route dns dsh-session-sync sync.example.com
   Put the ingress for http://127.0.0.1:8787 in the cloudflared config, install
   or schedule the tunnel, and keep port 8787 closed to the internet.
   If Caddy is chosen instead: reverse_proxy 127.0.0.1:8787, open 80/443 only,
   and run Caddy at startup.
5. Confirm the hub listener and read the pairing code from:
     %USERPROFILE%\.dsh\dsh-sync\hub\pairing-code.txt
   (or `/session-sync code` in DSH).
6. Verify:
     Invoke-RestMethod https://sync.example.com/v1/health
     Ask the operator to pair a test device in Settings > Session sync >
     Client mode, or run:
     /session-sync pair https://sync.example.com <code> server-selftest
     Invoke-RestMethod https://sync.example.com/v1/sessions -Headers @{ Authorization = "Bearer <token from client.json>" }
   Health must be 200 and the authenticated list must be 200. Delete the
   server-selftest client.json afterwards if it is not wanted.
7. Report: install result, hub listener, tunnel/Caddy status, health output,
   pairing-code file path (not the code itself), firewall and network-profile
   changes, and anything you could not do without elevation.

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
- Type `/session-sync init-hub` on the server if the agent cannot run a human command.
- Read the pairing code and hand it to each client once.
- On each client, install the same GitHub URL and type
  `/session-sync pair <hub-url> <code> <name>`; no terminal is needed.

## What the agent should not decide

- The domain name, DNS provider, and whether Cloudflare Tunnel or Caddy is used.
- Moving the hub data directory or deleting old sessions.
- Opening the hub port to the internet instead of using the tunnel/proxy.
