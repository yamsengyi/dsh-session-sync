/**
 * Browser half of dsh-session-sync: a Settings section with an explicit
 * Host / Client / Both / Off mode, conditional content per mode, and an Apply
 * step so a toggle does not start or stop the hub until the operator asks.
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
    const MODES = [
      ['host', '호스트'],
      ['client', '클라이언트'],
      ['both', '둘 다'],
      ['off', '끔'],
    ]

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

    function currentLabel(status) {
      if (!status) return '불러오는 중'
      if (status.hub.running && status.client.running) return '호스트 + 클라이언트 동작 중'
      if (status.hub.running) return '호스트 동작 중'
      if (status.client.running) return '클라이언트 동작 중'
      return status.mode === 'off' ? '꺼짐' : '중지됨'
    }

    const fieldBase = { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }
    const styles = {
      root: { display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 4px 20px', maxWidth: 720 },
      title: { margin: 0, fontSize: 18, fontWeight: 600 },
      modeRow: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
      segmented: { display: 'inline-flex', border: '1px solid rgba(127,127,127,0.4)', borderRadius: 8, overflow: 'hidden' },
      segment: { padding: '6px 10px', border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit' },
      segmentActive: { padding: '6px 10px', border: 0, background: 'rgba(127,127,127,0.28)', color: 'inherit', cursor: 'pointer', font: 'inherit', fontWeight: 600 },
      badge: { fontSize: 12, opacity: 0.75 },
      pending: { fontSize: 12, color: '#d08a2e' },
      section: { border: '1px solid rgba(127,127,127,0.28)', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 },
      heading: { margin: 0, fontSize: 14, fontWeight: 600 },
      row: { display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' },
      buttonRow: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
      field: fieldBase,
      fieldRow: { ...fieldBase, flex: '1 1 180px' },
      label: { fontSize: 12, opacity: 0.75 },
      input: { padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(127,127,127,0.4)', background: 'transparent', color: 'inherit', font: 'inherit', width: '100%', boxSizing: 'border-box' },
      button: { padding: '6px 12px', borderRadius: 6, border: '1px solid rgba(127,127,127,0.5)', background: 'rgba(127,127,127,0.12)', color: 'inherit', cursor: 'pointer' },
      smallButton: { padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(127,127,127,0.35)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12 },
      codeRow: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
      code: { fontFamily: 'ui-monospace, monospace', fontSize: 13, padding: '2px 6px', border: '1px solid rgba(127,127,127,0.35)', borderRadius: 4 },
      muted: { margin: 0, fontSize: 12, opacity: 0.7 },
      hint: { margin: 0, fontSize: 12, opacity: 0.65 },
      error: { margin: 0, fontSize: 12, color: '#d9534f' },
      notice: { margin: 0, fontSize: 12, color: '#3c9a5f' },
    }

    function field(label, input) {
      return h('label', { style: styles.field },
        h('span', { style: styles.label }, label),
        input)
    }

    function fieldRow(label, input) {
      return h('label', { style: styles.fieldRow },
        h('span', { style: styles.label }, label),
        input)
    }

    function SessionSyncSection() {
      const [status, setStatus] = useState(null)
      const [busy, setBusy] = useState('')
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [mode, setMode] = useState('host')
      const [hostPort, setHostPort] = useState('8787')
      const [hostBind, setHostBind] = useState('127.0.0.1')
      const [target, setTarget] = useState('')
      const [code, setCode] = useState('')
      const [name, setName] = useState('')
      const [workspace, setWorkspace] = useState('')
      const [initialized, setInitialized] = useState(false)

      const refresh = async (initial = false) => {
        const next = await call('status')
        setStatus(next)
        if (initial || !initialized) {
          setMode(next.mode ?? 'host')
          setHostPort(String(next.hub.port ?? 8787))
          setHostBind(next.hub.host ?? '127.0.0.1')
          setTarget(next.client.hubUrl ?? hostUrl(next))
          setCode(next.hub.pairingCode ?? '')
          setName(next.client.deviceName ?? '')
          setWorkspace(next.workspace.path ?? '')
          setInitialized(true)
        }
        return next
      }

      useEffect(() => {
        void refresh(true).catch((reason) => setError(String(reason.message ?? reason)))
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      const run = async (label, task) => {
        setBusy(label)
        setError('')
        setNotice('')
        try {
          const result = await task()
          const next = result && result.mode ? result : await refresh()
          if (result && result.mode) {
            setStatus(next)
            setMode(next.mode)
          }
          setNotice(`${label} 완료`)
          return next
        } catch (reason) {
          setError(String(reason.message ?? reason))
          return undefined
        } finally {
          setBusy('')
        }
      }

      const applyMode = () => run('모드 적용', () => call('mode', {
        mode,
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

      const showHost = mode === 'host' || mode === 'both'
      const showClient = mode === 'client' || mode === 'both'
      const pending = status ? mode !== status.mode : false
      const last = status?.lastSync

      return h('div', { style: styles.root },
        h('h2', { style: styles.title }, 'Session sync'),
        h('p', { style: styles.muted }, 'DSH 세션과 워크스페이스 체크포인트를 개인 허브와 동기화합니다.'),

        h('div', { style: styles.modeRow },
          h('div', { style: styles.segmented },
            MODES.map(([value, label]) => h('button', {
              key: value,
              style: mode === value ? styles.segmentActive : styles.segment,
              disabled: Boolean(busy),
              onClick: () => setMode(value),
            }, label))),
          h('button', { style: styles.button, disabled: Boolean(busy), onClick: applyMode }, '모드 적용'),
          h('span', { style: styles.badge }, `현재: ${currentLabel(status)}`),
          pending ? h('span', { style: styles.pending }, '적용 대기') : null,
        ),

        showHost ? h('section', { style: styles.section },
          h('h3', { style: styles.heading }, '호스트 설정'),
          h('div', { style: styles.row },
            fieldRow('포트', h('input', {
              type: 'number', min: 1, max: 65535, value: hostPort,
              onChange: (event) => setHostPort(event.target.value), style: styles.input,
            })),
            fieldRow('바인딩 주소', h('input', {
              value: hostBind, placeholder: '127.0.0.1',
              onChange: (event) => setHostBind(event.target.value), style: styles.input,
            })),
          ),
          h('p', { style: styles.hint },
            status?.hub.running
              ? `실행 중: ${status.hub.url}`
              : status?.hub.enabled
                ? '설정됨 · 중지됨 (모드 적용으로 시작)'
                : '모드 적용 후 시작됩니다.'),
          status?.hub?.pairingCode ? h('div', { style: styles.codeRow },
            h('span', { style: styles.label }, '페어링 코드'),
            h('code', { style: styles.code }, status.hub.pairingCode),
            h('button', { style: styles.smallButton, disabled: Boolean(busy), onClick: copyCode }, '복사'),
            h('button', { style: styles.smallButton, disabled: Boolean(busy), onClick: rotate }, '회전')) : null,
        ) : null,

        showClient ? h('section', { style: styles.section },
          h('h3', { style: styles.heading }, '클라이언트 설정'),
          field('대상 URL (호스트 주소:포트)', h('input', {
            value: target, placeholder: 'http://192.168.0.10:8787',
            onChange: (event) => setTarget(event.target.value), style: styles.input,
          })),
          h('div', { style: styles.buttonRow },
            h('button', { style: styles.smallButton, disabled: Boolean(busy), onClick: useHostInfo }, '호스트 정보로 덮어쓰기')),
          h('div', { style: styles.row },
            fieldRow('페어링 코드', h('input', {
              value: code, placeholder: 'ABCD-EFGH',
              onChange: (event) => setCode(event.target.value), style: styles.input,
            })),
            fieldRow('기기 이름', h('input', {
              value: name, placeholder: 'laptop',
              onChange: (event) => setName(event.target.value), style: styles.input,
            })),
          ),
          h('div', { style: styles.buttonRow },
            h('button', { style: styles.button, disabled: Boolean(busy), onClick: pair }, '페어링'),
            status?.client?.paired
              ? h('button', { style: styles.smallButton, disabled: Boolean(busy), onClick: unpair }, '페어링 해제')
              : null),
          h('p', { style: styles.hint },
            status?.client.paired
              ? `페어링됨: ${status.client.deviceName ?? 'device'} → ${status.client.hubUrl}`
              : '페어링 후 모드 적용으로 클라이언트를 시작합니다.'),
        ) : null,

        mode === 'off' ? h('p', { style: styles.hint },
          '모드 적용 시 호스트와 클라이언트를 모두 중지합니다. 설정과 페어링 토큰은 유지됩니다.') : null,

        showClient ? h('section', { style: styles.section },
          h('h3', { style: styles.heading }, '공유 워크스페이스'),
          field('경로', h('input', {
            value: workspace, placeholder: 'C:\\Users\\me\\project',
            onChange: (event) => setWorkspace(event.target.value), style: styles.input,
          })),
          h('div', { style: styles.buttonRow },
            h('button', { style: styles.smallButton, disabled: Boolean(busy), onClick: useCurrent }, '현재 세션 경로'),
            h('button', { style: styles.button, disabled: Boolean(busy), onClick: mark }, '워크스페이스 지정')),
          status?.workspace?.marked
            ? h('p', { style: styles.hint }, `마커: .dsh-sync.json · folderId: ${status.workspace.folderId}`)
            : null,
        ) : null,

        showClient ? h('section', { style: styles.section },
          h('h3', { style: styles.heading }, '동기화'),
          h('div', { style: styles.buttonRow },
            h('button', { style: styles.button, disabled: Boolean(busy) || !status?.client?.running, onClick: syncNow }, '지금 동기화 (세션 + 워크스페이스)')),
          last
            ? h('p', { style: styles.hint },
              `마지막: ${new Date(last.at).toLocaleString()} · 세션 ${last.sessions?.pushed ?? 0}개/${last.sessions?.events ?? 0} events${last.sessions?.errors ? ` (오류 ${last.sessions.errors})` : ''} · pull v${last.pulled?.version ?? '-'} · push v${last.pushed?.version ?? '-'}${last.pushed?.skipped ? ' (변경 없음)' : ''} · 충돌 ${last.pulled?.conflicts?.length ?? 0}`)
            : h('p', { style: styles.hint }, '아직 수동 동기화 기록이 없습니다.'),
        ) : null,

        error ? h('p', { style: styles.error }, error) : null,
        notice ? h('p', { style: styles.notice }, notice) : null,
        h('div', { style: styles.buttonRow },
          h('button', { style: styles.smallButton, disabled: Boolean(busy), onClick: () => run('새로고침', async () => { await refresh(); return undefined }) }, '새로고침')),
      )
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
