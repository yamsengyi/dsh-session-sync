# Windows: run the hub inside DSH

Model B (auto hub): one Windows machine runs DSH and hosts the hub. Each PC
installs the bundle once, pairs with a code, and then only needs DSH started.

```
server DSH ── hub (127.0.0.1:8787) ── Cloudflare Tunnel / Caddy ── sync.example.com
client DSH ── client sync ── HTTPS ──► sync.example.com
```

No Docker, no separate Windows service: the hub is a role of the DSH plugin.
The server must have DSH running for the hub to be reachable.

## 1. Server setup

1. Install the bundle: **Plugins → Add plugin**, paste
   `https://github.com/yamsengyi/dsh-session-sync`, and leave the Registry dropdown at
   its default (a GitHub URL bypasses the npm registry).
2. Reload DSH once so the plugin code, the client section, and the
   `/session-sync` command load.
3. Open **Settings → Session sync**:
   - choose mode **Host**,
   - set port `8787`,
   - choose bind `127.0.0.1` (proxy/tunnel) or `0.0.0.0` (direct LAN),
   - press **Apply**. The current state badge shows the running hub, and the
     pairing code appears in the page and in
     `%USERPROFILE%\.dsh\dsh-sync\hub\pairing-code.txt`.
4. On later DSH starts the plugin reads `hub.json` and starts the hub
   automatically.

CLI fallback for automation:

```powershell
node "$env:DSH_PROFILE_DIR\node_modules\@yamsengyi\dsh-session-sync\bin\session-sync.mjs" init-hub
```

5. Verify locally:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/v1/health
Get-NetTCPConnection -LocalPort 8787 | Select-Object LocalAddress,State
```

## 2. Client setup

1. Install the same GitHub URL on the client and reload DSH once.
2. Open **Settings → Session sync**:
   - choose mode **Client**,
   - enter the target URL in one line, for example
     `https://sync.example.com` or `http://11.11.1.77:8787`,
   - use **Use host info** when the host is this machine to fill the URL and
     pairing code,
   - enter the pairing code and a device name, then press **Pair**,
   - press **Apply** to commit the mode. The state badge shows the running
     client.
3. The client writes `client.json` and starts syncing immediately. On later
   DSH starts it resumes automatically.

CLI fallback:

```powershell
node "$env:DSH_PROFILE_DIR\node_modules\@yamsengyi\dsh-session-sync\bin\session-sync.mjs" pair `
  --hub https://sync.example.com `
  --code XXXX-XXXX `
  --name laptop
```

Check either side with **Settings → Session sync** or `/session-sync status`, or:

```powershell
node "$env:DSH_PROFILE_DIR\node_modules\@yamsengyi\dsh-session-sync\bin\session-sync.mjs" status
```


## 3. Domain and TLS

### Cloudflare Tunnel (recommended)

- Works from a network without a public IP and needs **no inbound firewall
  rule**; the only outbound leg is 443.
- Install `cloudflared`, then:

```powershell
cloudflared tunnel login
cloudflared tunnel create dsh-session-sync
cloudflared tunnel route dns dsh-session-sync sync.example.com
```

`%ProgramData%\cloudflared\config.yml` (copy the credentials JSON beside it):

```yaml
tunnel: <TUNNEL_ID>
credentials-file: C:\ProgramData\cloudflared\<TUNNEL_ID>.json
ingress:
  - hostname: sync.example.com
    service: http://127.0.0.1:8787
  - service: http_status:404
```

Run it as a service (admin) or through Task Scheduler at startup:

```powershell
cloudflared service install
```

TLS terminates at Cloudflare; the hub stays loopback HTTP.

### Caddy (public IP required)

```caddyfile
sync.example.com {
    encode zstd gzip
    request_body {
        max_size 256MB
    }
    reverse_proxy 127.0.0.1:8787
}
```

Open inbound 80 and 443 (Private/Domain where possible), point the DNS A record
at the server, and run Caddy at startup through Task Scheduler. Caddy obtains
the certificate automatically.

### LAN only

In **Settings → Session sync**, choose mode **Host**, set bind
`0.0.0.0`, set the port, and press **Apply** (or run
`/session-sync init-hub 0.0.0.0 8787`).

In an elevated PowerShell:

```powershell
Set-NetConnectionProfile -InterfaceAlias "<LAN adapter>" -NetworkCategory Private
New-NetFirewallRule -DisplayName "DSH sync hub" -Direction Inbound `
  -Protocol TCP -LocalPort 8787 -Action Allow -Profile Private
```

Clients enter `http://<server-lan-ip>:8787` and the pairing code in
**Settings → Session sync** (mode Client). This leg is plain HTTP; use
it only on a trusted network.

## 4. Backup and restore

Data lives in `%USERPROFILE%\.dsh\dsh-sync\hub`:

```
hub-state.json     paired devices and the pairing code
sessions/          session event logs
folders/           checkpoint manifests and blobs
```

- **Consistent backup**: quit DSH (or take a VSS snapshot), then copy the folder.
- A live copy is also recoverable: the hub repairs a torn final JSONL line and
  a stale head when it starts, so a copy taken while running will open.
- Restore by copying the folder back and starting DSH. Pairing codes and paired
  devices survive.
- Keep the backup off the server. Tokens are not stored in plaintext, but the
  session logs contain real prompts and tool output.

Example with DSH stopped:

```powershell
$src = "$env:USERPROFILE\.dsh\dsh-sync"
Compress-Archive -Path $src -DestinationPath "D:\backup\dsh-session-sync-$(Get-Date -Format yyyyMMdd).zip"
```

## 5. Updates

1. Push the new commit (and a tag) to `https://github.com/yamsengyi/dsh-session-sync`.
2. On each machine, use the bundle's **Update** action, or uninstall and install
   the GitHub URL again.
3. Restart DSH to load the new module generation; restart is not needed for a
   data-only change. The data directory is untouched and the protocol stays v1.

## 6. Troubleshooting

| Symptom | Check |
|---|---|
| No listener on 8787 | `hub.json` exists, DSH started, port not already used, bind host is a local address |
| Client cannot reach the hub | Tunnel/Caddy status, DNS, firewall, network profile (Public blocks inbound) |
| `401 unauthorized` | Re-pair; the device token is in `client.json` |
| `403 pairing-code-invalid` | `/session-sync code` on the hub; rotate if leaked |
| `426 protocol-mismatch` | Hub and client bundle versions differ; update both |
| Pairing code lost | `/session-sync code rotate` on the hub (requires a running hub) |
| Disk growth | `sessions/` grows with turns; prune old sessions at the hub if needed |

## 7. Security

- Expose only 443 (tunnel/Caddy). Never open 8787 to the internet.
- Pairing codes are single-purpose enrollment secrets; rotate after onboarding
  a device and keep them out of chat logs and tickets.
- The hub is single-tenant: one person, several devices. Do not share one hub
  between different people's workspaces.
- TLS protects the transport; keep the tunnel/Caddy certificate healthy.

