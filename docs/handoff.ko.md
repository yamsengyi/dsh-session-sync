# 서버 DSH에 허브 세팅 위임하기 (한국어)

서버 Windows에서 DSH가 실행 중이고, 공개 저장소
`https://github.com/yamsengyi/dsh-session-sync`를 설치할 수 있으면 아래
프롬프트를 그대로 서버의 DSH에 전달하면 됩니다.

## 전달 전에 정할 것

- 공개 주소: 예) `sync.example.com`
- TLS 방식: **Cloudflare Tunnel 권장**(공인 IP/포트 개방 불필요), 또는 Caddy
- 허브 바인딩: 프록시 뒤면 `127.0.0.1`, LAN 직접이면 `0.0.0.0`
- 서버 DSH가 관리자 권한이 아니면 UAC 승인 필요

## 서버 DSH에 붙여넣을 프롬프트

```text
You are on a Windows machine that will host the dsh-session-sync hub for one
person's PCs. Use a native setup; do not use Docker.

Install source (public GitHub repository):
  https://github.com/yamsengyi/dsh-session-sync

The server role is `hub`. The bundle's default role is `auto`, so writing
%USERPROFILE%\.dsh\dsh-sync\hub.json is what makes this machine the hub.

Do this and report every deviation:
1. Install the bundle into this DSH profile. Prefer your plugin_manager tool
   with action `install_bundle` and the GitHub URL as the target. The Registry
   dropdown does not apply to a GitHub URL. If the tool is unavailable, tell the
   operator to use Plugins > Add plugin and paste the same URL.
2. Reload DSH once so the plugin code and /session-sync command load.
3. Start the hub. Preferred: ask the operator to open Settings > Session sync >
   Host mode, enable it, set port 8787, choose bind 127.0.0.1 (or 0.0.0.0 for
   direct LAN), and press Apply. This writes
   %USERPROFILE%\.dsh\dsh-sync\hub.json and shows the pairing code.
   If the Settings page is unavailable, ask for `/session-sync init-hub`, or run
   the installed CLI if you have a Node executable:
      node "$env:DSH_PROFILE_DIR\node_modules\@yamsengyi\dsh-session-sync\bin\session-sync.mjs" init-hub --host 127.0.0.1 --port 8787
   Use --host 0.0.0.0 instead only if clients must reach this machine directly
   on the LAN; then allow inbound TCP 8787 on the Private profile.
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
     Invoke-RestMethod https://sync.example.com/v1/sessions -Headers @{ Authorization = "Bearer <token from client.json>" }
   Health must be 200 and the authenticated list must be 200. If you need a
   test device, ask the operator to pair it in Settings > Session sync >
   Client mode, or run:
     /session-sync pair https://sync.example.com <code> server-selftest
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

## 운영자가 하는 일

1. UAC가 필요한 터널 서비스/방화벽 단계 승인
2. 에이전트가 사람 명령을 실행할 수 없으면 DSH에서 직접
   `/session-sync init-hub` 입력
3. 페어링 코드를 읽어 각 클라이언트에 한 번 전달
4. 각 클라이언트에서 같은 GitHub URL 설치 후
   `/session-sync pair <hub-url> <code> <name>` 입력

## 서버 역할 확인

- 플러그인 행: `session-sync` / `@yamsengyi/dsh-session-sync`가 active
- `%USERPROFILE%\.dsh\dsh-sync\hub.json` 존재
- `http://127.0.0.1:8787/v1/health` → 200
- `https://sync.example.com/v1/health` → 200
- 페어링 코드 파일: `%USERPROFILE%\.dsh\dsh-sync\hub\pairing-code.txt`

데이터 경로(`%USERPROFILE%\.dsh\dsh-sync`)와 워크스페이스 마커
(`.dsh-sync.json`)는 이전 이름과의 호환을 위해 그대로 유지됩니다.
