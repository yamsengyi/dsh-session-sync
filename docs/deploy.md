# Deploy the hub on a domain server

> Windows server? Use the auto-hub flow instead:
> [deploy-windows.md](deploy-windows.md). This page explains the generic
> standalone hub and its Linux systemd/proxy shape.

The hub is a role, not a machine. This page moves it off the home PC onto a
server reached through a domain, while clients keep the same protocol.

## Shape

```
client PCs ──HTTPS──► sync.example.com (Caddy/nginx, TLS)
                              │ 127.0.0.1:8787
                              ▼
                      dsh-sync hub (Node)
                      /var/lib/dsh-sync
```

- The hub binds loopback only; the proxy terminates TLS and is the only
  internet-facing listener.
- Clients enroll once with a pairing code (`dsh-sync pair --hub https://...`).
- The hub keeps bearer-token auth; TLS protects the transport.

## Run it

Use Node 22+ on the server. The hub has no dependencies.

```sh
DSH_SYNC_DATA_DIR=/var/lib/dsh-sync \
DSH_SYNC_HOST=127.0.0.1 \
DSH_SYNC_PORT=8787 \
node /opt/dsh-sync/bin/hub.mjs
```

The first start creates `pairing-code.txt` in the data directory; enroll each
device with `bin/dsh-sync.mjs pair`. Preconfigured `DSH_SYNC_TOKENS` (a
`name:token` list or a JSON array) still work as an alternative, and the two
sources can be mixed.

### systemd

```ini
[Unit]
Description=DSH sync hub
After=network.target

[Service]
User=dsh-sync
Environment=DSH_SYNC_DATA_DIR=/var/lib/dsh-sync
Environment=DSH_SYNC_HOST=127.0.0.1
Environment=DSH_SYNC_PORT=8787
Environment=DSH_SYNC_TOKENS=home-pc:TOKEN_A,laptop:TOKEN_B
ExecStart=/usr/bin/node /opt/dsh-sync/bin/hub.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

## TLS reverse proxy

### Caddy (recommended)

```caddyfile
sync.example.com {
    encode zstd gzip
    request_body {
        max_size 256MB
    }
    reverse_proxy 127.0.0.1:8787
}
```

Caddy obtains and renews the certificate automatically.

### nginx

```nginx
server {
    listen 443 ssl http2;
    server_name sync.example.com;

    ssl_certificate     /etc/letsencrypt/live/sync.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sync.example.com/privkey.pem;

    client_max_body_size 256m;      # the hub's JSON body cap
    proxy_request_buffering off;    # stream blob uploads
    proxy_read_timeout 300s;        # long first-push backfills

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Mount the hub at a dedicated hostname root. If you must serve it under a
prefix such as `/sync/`, strip the prefix at the proxy; the hub only knows
`/v1/...`.

## Migrate from the home-PC hub

1. Stop the old hub (or let it keep serving read-only).
2. Copy the storage directory:
   ```sh
   rsync -a ~/.dsh/dsh-sync/hub/ server:/var/lib/dsh-sync/
   ```
   It contains `sessions/` and `folders/`; blobs and manifests travel with it.
3. Configure the same device tokens on the server (rotate them if the old ones
   were exposed).
4. Start the server hub and verify:
   ```sh
   curl https://sync.example.com/v1/health
   curl -H "Authorization: Bearer <token>" https://sync.example.com/v1/sessions
   ```
5. On each client, change `hubUrl` to `https://sync.example.com`, keep the
   same token, and reload the profile.
6. On the old home PC, switch `role` to `client` (or disable the row) so it no
   longer binds the hub port.

## Security notes

- Expose only 443. The hub's loopback port stays private.
- Every `/v1` route except health needs a bearer token; use long random tokens
  and rotate on suspicion.
- The body cap is 256 MiB per request. A very long first backfill can be split
  by pushing more often; ordinary turns are small.
- Back up `/var/lib/dsh-sync` (sessions, checkpoints, blobs). It is the only
  state the hub owns.
- The hub is single-tenant by design: one person, several devices. Do not put
  different people's workspaces on one token set.
- Keep the hub and clients on protocol version 1; the hub answers `426` on a
  declared mismatch.
