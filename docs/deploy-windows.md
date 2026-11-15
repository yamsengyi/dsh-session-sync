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

1. Put the bundle under the DSH home, not a drive root, so the current user
   owns it:
   ```
   %USERPROFILE%\.dsh\bundles\dsh-sync
   ```
2. Install it into that machine's DSH profile:
   - **Plugins → Add plugin → local directory**, or
   - the server DSH agent runs `plugin_manager install_bundle` with that path.
3. In DSH, run:

```text
/sync init-hub
```

The command writes `%USERPROFILE%\.dsh\dsh-sync\hub.json`, starts the hub
immediately, and returns the pairing code (also stored in
`%USERPROFILE%\.dsh\dsh-sync\hub\pairing-code.txt`). No terminal and no restart
are needed.

- Default bind is `127.0.0.1:8787`, which is right behind a tunnel or Caddy.
- For direct LAN access without a proxy, use `/sync init-hub 0.0.0.0 8787` and
  allow TCP 8787 on the Private profile.

CLI fallback for automation:

```powershell
node "$env:USERPROFILE\.dsh\bundles\dsh-sync\bin\dsh-sync.mjs" init-hub
```

On later DSH starts the plugin reads `hub.json` and starts the hub
automatically.

4. Verify locally:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/v1/health
Get-NetTCPConnection -LocalPort 8787 | Select-Object LocalAddress,State
```

## 2. Client setup

1. Put the same bundle under `%USERPROFILE%\.dsh\bundles\dsh-sync` on the
   client and install it.
2. In DSH, pair once:

```text
/sync pair https://sync.example.com XXXX-XXXX laptop
```

`pair` exchanges the code for a device token, writes
`%USERPROFILE%\.dsh\dsh-sync\client.json`, and starts syncing immediately. No
profile patch and no manual token copy are involved. On later DSH starts the
plugin reads `client.json` and resumes.

CLI fallback:

```powershell
node "$env:USERPROFILE\.dsh\bundles\dsh-sync\bin\dsh-sync.mjs" pair `
  --hub https://sync.example.com `
  --code XXXX-XXXX `
  --name laptop
```

Check either side with `/sync status` or:

```powershell
node "$env:USERPROFILE\.dsh\bundles\dsh-sync\bin\dsh-sync.mjs" status
```


## 3. Domain and TLS

### Cloudflare Tunnel (recommended)

- Works from a network without a public IP and needs **no inbound firewall
  rule**; the only outbound leg is 443.
- Install `cloudflared`, then:

```powershell
cloudflared tunnel login
cloudflared tunnel create dsh-sync
cloudflared tunnel route dns dsh-sync sync.example.com
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

In DSH:

```text
/sync init-hub 0.0.0.0 8787
```

In an elevated PowerShell:

```powershell
Set-NetConnectionProfile -InterfaceAlias "<LAN adapter>" -NetworkCategory Private
New-NetFirewallRule -DisplayName "DSH sync hub" -Direction Inbound `
  -Protocol TCP -LocalPort 8787 -Action Allow -Profile Private
```

Clients pair with `/sync pair http://<server-lan-ip>:8787 <code> <name>`. This
leg is plain HTTP; use it only on a trusted network.

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
Compress-Archive -Path $src -DestinationPath "D:\backup\dsh-sync-$(Get-Date -Format yyyyMMdd).zip"
```

## 5. Updates

1. Replace the bundle directory (`%USERPROFILE%\.dsh\bundles\dsh-sync`) with the new version.
2. Stop and start DSH (the linked install picks up new files on restart).
3. The data directory is untouched; protocol stays v1.

## 6. Troubleshooting

| Symptom | Check |
|---|---|
| No listener on 8787 | `hub.json` exists, DSH started, port not already used, bind host is a local address |
| Client cannot reach the hub | Tunnel/Caddy status, DNS, firewall, network profile (Public blocks inbound) |
| `401 unauthorized` | Re-pair; the device token is in `client.json` |
| `403 pairing-code-invalid` | Read the current code with `node bin\dsh-sync.mjs code`; rotate if leaked |
| `426 protocol-mismatch` | Hub and client bundle versions differ; update both |
| Pairing code lost | `node bin\dsh-sync.mjs code --rotate --hub https://... --token <client token>` |
| Disk growth | `sessions/` grows with turns; prune old sessions at the hub if needed |

## 7. Security

- Expose only 443 (tunnel/Caddy). Never open 8787 to the internet.
- Pairing codes are single-purpose enrollment secrets; rotate after onboarding
  a device and keep them out of chat logs and tickets.
- The hub is single-tenant: one person, several devices. Do not share one hub
  between different people's workspaces.
- TLS protects the transport; keep the tunnel/Caddy certificate healthy.
