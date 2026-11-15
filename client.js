/**
 * Browser half of dsh-session-sync: a Settings section that controls the
 * Host's hub/client role, the shared workspace, and a manual sync.
 *
 * The section talks to the Host through same-origin exact routes under
 * `/session-sync/api/...`; Connection authenticates them as the browser Peer.
 */

window.__ModuleLoader__.load({
  id: '@yamsengyi/dsh-session-sync',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useState } = React

    const API = 'session-sync/api/'

    async function call(path, body) {
      const init = { headers: {} }
      if (body !== undefined) {
        init.method = 'POST'
        init.headers['content-type'] = 'application/json'
        init.body = JSON.stringify(body)
      }
      const response = await fetch(`${API}${path}`, init)
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        const message = payload?.error?.message ?? `${response.status} ${response.statusText}`
        throw new Error(message)
      }
      return payload
    }

    function hostUrl(status) {
      const host = status?.hub?.host === '0.0.0.0' ? '127.0.0.1' : status?.hub?.host
      if (!host) return ''
      return `http://${host}:${status.hub.port}`
    }

    function line(label, value) {
      return h('div', { key: label, style: styles.line },
        h('span', { style: styles.lineLabel }, label),
        h('span', { style: styles.lineValue }, value))
    }

    function SessionSyncSection() {
      const [status, setStatus] = useState(null)
      const [busy, setBusy] = useState('')
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [hostEnabled, setHostEnabled] = useState(false)
      const [hostPort, setHostPort] = useState('8787')
      const [hostBind, setHostBind] = useState('127.0.0.1')
      const [target, setTarget] = useState('')
      const [code, setCode] = useState('')
      const [name, setName] = useState('')
      const [workspace, setWorkspace] = useState('')
      const [initialized, setInitialized] = useState(false)

      const refresh = async () => {
        const next = await call('status')
        setStatus(next)
        if (!initialized) {
          setHostEnabled(Boolean(next.hub.configured))
          setHostPort(String(next.hub.port ?? 8787))
          setHostBind(next.hub.host === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1')
          setTarget(next.client.hubUrl ?? hostUrl(next))
          setCode(next.hub.pairingCode ?? '')
          setName(next.client.deviceName ?? '')
          setWorkspace(next.workspace.path ?? next.currentPath ?? '')
          setInitialized(true)
        }
        return next
      }

      useEffect(() => {
        void refresh().catch((reason) => setError(String(reason.message ?? reason)))
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      const run = async (label, task) => {
        setBusy(label)
        setError('')
        setNotice('')
        try {
          const result = await task()
          const next = result && result.hub ? result : await refresh()
          if (result && result.hub) setStatus(next)
          setNotice(`${label} 완료`)
          return next
        } catch (reason) {
          setError(String(reason.message ?? reason))
          return undefined
        } finally {
          setBusy('')
        }
      }

      const applyHost = () => run('호스트 설정', () => call('host', {
        enabled: hostEnabled,
        port: Number(hostPort),
        bind: hostBind,
      }))

      const pair = () => run('페어링', () => call('pair', {
        hubUrl: target.trim(),
        code: code.trim(),
        name: name.trim(),
      }))

      const unpair = () => run('페어링 해제', () => call('unpair', {}))

      const mark = () => run('워크스페이스 지정', () => call('workspace', { path: workspace.trim() }))

      const syncNow = () => run('동기화', () => call('sync', {}))

      const rotate = () => run('코드 회전', () => call('code', { rotate: true }))

      const useHostInfo = () => {
        if (!status?.hub) return
        setTarget(hostUrl(status))
        if (status.hub.pairingCode) setCode(status.hub.pairingCode)
      }

      const useCurrent = () => {
        if (status?.currentPath) setWorkspace(status.currentPath)
      }

      const copyCode = () => {
        const value = status?.hub?.pairingCode
        if (!value) return
        void navigator.clipboard?.writeText(value).then(
          () => setNotice('페어링 코드를 복사했습니다'),
          () => setError('클립보드에 복사하지 못했습니다'),
        )
      }

      const last = status?.lastSync
      return h('div', { style: styles.root },
        h('h2', { style: styles.title }, 'Session sync'),
        h('p', { style: styles.muted }, 'DSH 세션과 워크스페이스 체크포인트를 개인 허브와 동기화합니다.'),

        status ? h('div', { style: styles.statusGrid },
          line('허브', status.hub.running ? `실행 중 · ${status.hub.url}` : status.hub.configured ? '설정됨 · 중지됨' : '설정 안 됨'),
          line('클라이언트', status.client.paired ? `${status.client.running ? '동기화 중' : '중지됨'} · ${status.client.hubUrl}` : '페어링 안 됨'),
          line('워크스페이스', status.workspace.marked ? `${status.workspace.path} (${status.workspace.folderId})` : status.workspace.path ?? '지정 안 됨'),
        ) : h('p', { style: styles.muted }, '상태를 불러오는 중…'),

        h('section', { style: styles.section },
          h('h3', { style: styles.heading }, '1. 호스트 모드'),
          h('label', { style: styles.row },
            h('input', { type: 'checkbox', checked: hostEnabled, onChange: (event) => setHostEnabled(event.target.checked) }),
            h('span', null, '이 머신을 허브로 사용')),
          h('div', { style: styles.row },
            h('label', { style: styles.field },
              h('span', { style: styles.label }, '포트'),
              h('input', {
                type: 'number', min: 1, max: 65535, value: hostPort,
                onChange: (event) => setHostPort(event.target.value), style: styles.input,
              })),
            h('label', { style: styles.field },
              h('span', { style: styles.label }, '바인딩'),
              h('select', { value: hostBind, onChange: (event) => setHostBind(event.target.value), style: styles.input },
                h('option', { value: '127.0.0.1' }, '로컬만 (127.0.0.1)'),
                h('option', { value: '0.0.0.0' }, 'LAN 공개 (0.0.0.0)'))),
          ),
          h('div', { style: styles.row },
            h('button', { style: styles.button, disabled: Boolean(busy), onClick: applyHost }, hostEnabled ? '호스트 적용' : '호스트 끄기')),
          status?.hub?.pairingCode ? h('div', { style: styles.codeRow },
            h('span', { style: styles.label }, '페어링 코드'),
            h('code', { style: styles.code }, status.hub.pairingCode),
            h('button', { style: styles.smallButton, disabled: Boolean(busy), onClick: copyCode }, '복사'),
            h('button', { style: styles.smallButton, disabled: Boolean(busy), onClick: rotate }, '회전')) : null,
        ),

        h('section', { style: styles.section },
          h('h3', { style: styles.heading }, '2. 클라이언트 모드'),
          h('label', { style: styles.field },
            h('span', { style: styles.label }, '대상 URL (호스트 주소:포트)'),
            h('input', {
              value: target, placeholder: 'http://192.168.0.10:8787',
              onChange: (event) => setTarget(event.target.value), style: styles.input,
            })),
          h('div', { style: styles.row },
            h('button', { style: styles.smallButton, disabled: Boolean(busy), onClick: useHostInfo }, '호스트 정보로 덮어쓰기')),
          h('div', { style: styles.row },
            h('label', { style: styles.field },
              h('span', { style: styles.label }, '페어링 코드'),
              h('input', {
                value: code, placeholder: 'ABCD-EFGH',
                onChange: (event) => setCode(event.target.value), style: styles.input,
              })),
            h('label', { style: styles.field },
              h('span', { style: styles.label }, '기기 이름'),
              h('input', {
                value: name, placeholder: 'laptop',
                onChange: (event) => setName(event.target.value), style: styles.input,
              })),
          ),
          h('div', { style: styles.row },
            h('button', { style: styles.button, disabled: Boolean(busy), onClick: pair }, '페어링'),
            status?.client?.paired
              ? h('button', { style: styles.smallButton, disabled: Boolean(busy), onClick: unpair }, '페어링 해제')
              : null),
        ),

        h('section', { style: styles.section },
          h('h3', { style: styles.heading }, '3. 공유 워크스페이스'),
          h('label', { style: styles.field },
            h('span', { style: styles.label }, '경로'),
            h('input', {
              value: workspace, placeholder: 'C:\\Users\\me\\project',
              onChange: (event) => setWorkspace(event.target.value), style: styles.input,
            })),
          h('div', { style: styles.row },
            h('button', { style: styles.smallButton, disabled: Boolean(busy), onClick: useCurrent }, '현재 세션 경로'),
            h('button', { style: styles.button, disabled: Boolean(busy), onClick: mark }, '워크스페이스 지정')),
          status?.workspace?.marked
            ? h('p', { style: styles.muted }, `마커: .dsh-sync.json · folderId: ${status.workspace.folderId}`)
            : null,
        ),

        h('section', { style: styles.section },
          h('h3', { style: styles.heading }, '4. 동기화'),
          h('div', { style: styles.row },
            h('button', { style: styles.button, disabled: Boolean(busy) || !status?.client?.running, onClick: syncNow }, '지금 동기화 (Push + Pull)')),
          last
            ? h('p', { style: styles.muted },
              `마지막: ${new Date(last.at).toLocaleString()} · push v${last.pushed?.version ?? '-'}${last.pushed?.skipped ? ' (변경 없음)' : ''} · pull v${last.pulled?.version ?? '-'} · 충돌 ${last.pulled?.conflicts?.length ?? 0}`)
            : h('p', { style: styles.muted }, '아직 수동 동기화 기록이 없습니다.'),
        ),

        error ? h('p', { style: styles.error }, error) : null,
        notice ? h('p', { style: styles.notice }, notice) : null,
        h('div', { style: styles.row },
          h('button', { style: styles.smallButton, disabled: Boolean(busy), onClick: () => run('새로고침', async () => { await refresh(); return undefined }) }, '새로고침')),
      )
    }

    const styles = {
      root: { display: 'flex', flexDirection: 'column', gap: 16, padding: '8px 4px 24px', maxWidth: 760 },
      title: { margin: 0, fontSize: 18, fontWeight: 600 },
      heading: { margin: '0 0 8px', fontSize: 14, fontWeight: 600 },
      section: { border: '1px solid rgba(127,127,127,0.28)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 },
      row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
      field: { display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 220px', minWidth: 0 },
      label: { fontSize: 12, opacity: 0.75 },
      input: { padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(127,127,127,0.4)', background: 'transparent', color: 'inherit', font: 'inherit', minWidth: 0 },
      button: { padding: '6px 12px', borderRadius: 6, border: '1px solid rgba(127,127,127,0.5)', background: 'rgba(127,127,127,0.12)', color: 'inherit', cursor: 'pointer' },
      smallButton: { padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(127,127,127,0.35)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12 },
      codeRow: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
      code: { fontFamily: 'ui-monospace, monospace', fontSize: 13, padding: '2px 6px', border: '1px solid rgba(127,127,127,0.35)', borderRadius: 4 },
      statusGrid: { display: 'flex', flexDirection: 'column', gap: 4 },
      line: { display: 'flex', gap: 8, fontSize: 12 },
      lineLabel: { width: 92, opacity: 0.7, flex: '0 0 auto' },
      lineValue: { wordBreak: 'break-all' },
      muted: { margin: 0, fontSize: 12, opacity: 0.7 },
      error: { margin: 0, fontSize: 12, color: '#d9534f' },
      notice: { margin: 0, fontSize: 12, color: '#3c9a5f' },
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'session-sync',
          order: 40,
          label: 'Session sync',
        }, SessionSyncSection))
      },
    }
  },
})
