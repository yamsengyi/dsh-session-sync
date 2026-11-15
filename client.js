/**
 * Browser half of dsh-session-sync: a Settings section with an explicit
 * Host / Client / Both / Off mode, conditional content per mode, and an Apply
 * step so a toggle does not start or stop the hub until the operator asks.
 *
 * The section talks to the Host through same-origin exact routes under
 * `/session-sync/api/...`; Connection authenticates them as the browser Peer.
 *
 * UI language follows the DSH document language by default and can be
 * overridden per browser with English / 中文 / 한국어. The default is never a
 * hardcoded Korean text; Korean is just one of the three choices.
 */

window.__ModuleLoader__.load({
  id: '@yamsengyi/dsh-session-sync',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useState, useRef } = React

    const API = 'session-sync/api/'
    const LOCALE_KEY = 'dsh-session-sync.locale'
    const MODES = ['host', 'client', 'off']

    const STRINGS = {
      en: {
        intro: 'Sync DSH sessions and project checkpoints with a personal hub.',
        language: 'Language',
        auto: 'Auto (DSH)',
        'badge.shared': 'Shared',
        'badge.local': 'Local',
        'projects.shared': 'Shared projects',
        'projects.local': 'Local projects',
        'projects.title': 'Projects',
        'projects.close': 'Close',
        'projects.empty': 'No saved projects',
        'projects.tabProjects': 'Projects',
        'projects.tabSessions': 'Sessions',
        'projects.mergedHint': 'Local and server projects in one list.',
        'projects.serverOnly': 'Server only',
        'projects.localOnly': 'Local only',
        'projects.synced': 'Synced',
        'projects.checkpoints': '{count} checkpoints',
        'projects.sessionServer': 'On server',
        'projects.sessionsEmpty': 'No sessions on the server.',
        'projects.sessionsHint': 'The hub stores session history; it is not imported into local DSH sessions.',
        'projects.syncAction': 'Sync',
        'projects.syncing': 'Syncing…',
        'projects.syncDone': 'Synced to v{version}',
        'projects.join': 'Import',
        'projects.savePath': 'Save path',
        'projects.changePath': 'Change path',
        'projects.defaultPath': 'Default path',
        'projects.cancel': 'Cancel',
        'projects.confirm': 'Confirm',
        'projects.joining': 'Creating the session and syncing…',
        'projects.emptyWarning': 'An empty folder is recommended; existing files may conflict.',
        'projects.rootHint': 'Shared root: {root}',
        'projects.servicesMissing': 'Project/session service is unavailable.',
        'mode.host': 'Host',
        'mode.client': 'Client',
        'mode.both': 'Both',
        'mode.off': 'Off',
        applyMode: 'Apply mode',
        'current.loading': 'Loading',
        'current.both': 'Host + client running',
        'current.host': 'Host running',
        'current.hostSelf': 'Host running (self-sync)',
        'current.client': 'Client running',
        'current.off': 'Off',
        'current.stopped': 'Stopped',
        pendingApply: 'Pending apply',
        'currentStatus': 'Current: {state}',
        'host.heading': 'Host settings',
        'host.port': 'Port',
        'host.bind': 'Bind address',
        'host.running': 'Running: {url}',
        'host.selfSync': "This machine's sessions and projects are also uploaded to its own hub.",
        'host.configuredStopped': 'Configured · stopped (apply mode to start)',
        'host.startHint': 'Starts after you apply the mode.',
        'host.pairingCode': 'Pairing code',
        'host.copy': 'Copy',
        'host.rotate': 'Rotate',
        'client.heading': 'Client settings',
        'client.target': 'Target URL (host:port)',
        'client.useHostInfo': 'Use host info',
        'client.code': 'Pairing code',
        'client.name': 'Device name',
        'client.pair': 'Pair',
        'client.unpair': 'Unpair',
        'client.paired': 'Paired: {device} → {url}',
        'client.pairHint': 'Pair first, then apply the mode to start the client.',
        'off.hint': 'Applying stops both the host and the client. Settings and pairing tokens are kept.',
        'workspace.heading': 'Shared projects',
        'workspace.path': 'Path',
        'workspace.useCurrent': 'Use current session path',
        'workspace.mark': 'Share project',
        'workspace.unmark': 'Unshare',
        'workspace.scan': 'Scan subfolders',
        'workspace.shared': 'Sharing (syncing) · {folderId}',
        'workspace.local': 'Not shared',
        'workspace.list': 'Projects',
        'workspace.badgeShared': 'Sharing (syncing)',
        'workspace.badgeLocal': 'Not shared',
        'sync.heading': 'Project sync',
        'sync.now': 'Sync now (sessions + projects)',
        'sync.last': 'Last: {time} · sessions {sessions}/{events} events · pull {pull} · push {push} · conflicts {conflicts}',
        'sync.noChanges': '(no changes)',
        'sync.errors': '({count} errors)',
        'sync.none': 'No manual sync yet.',
        'action.refresh': 'Refresh',
        'action.checkUpdate': 'Check for updates',
        'action.done': '{label} done',
        'update.none': 'Not checked yet',
        'update.rowTitle': 'Session sync update',
        'update.check': 'Check for updates',
        'update.run': 'Update',
        'update.installed': 'Installed {current} · latest {latest}',
        'update.confirm': 'Updating restarts the hub. Continue?',
        'update.confirmYes': 'Update now',
        'update.cancel': 'Cancel',
        'update.started': 'Update started. Refresh or restart DSH.',
        'update.failed': 'Update failed',
        'update.upToDate': 'Up to date',
        'update.available': 'Latest {latest} · update available',
        'update.current': 'Latest {latest} · up to date',
        'update.error': 'Check failed: {message}',
        'update.reinstall': 'Reinstall from Plugins with the latest GitHub URL.',
        'copy.done': 'Pairing code copied',
        'copy.failed': 'Could not copy to the clipboard',
        'error.invalid-mode': 'Invalid mode.',
        'error.invalid-port': 'Port must be between 1 and 65535.',
        'error.invalid-pair': 'Enter a target URL and pairing code.',
        'error.pair-failed': 'Pairing failed.',
        'error.not-paired': 'Pair this machine first.',
        'error.invalid-path': 'Project path is not valid or does not exist.',
        'error.no-workspace': 'Share a project first.',
        'error.no-marker': 'Project is not shared for sync.',
        'error.not-marked': 'Project is not shared for sync.',
        'error.container-not-project': 'The shared root is a container. Share a project folder inside it.',
        'error.client-inactive': 'Client mode is not active; pair first.',
        'error.hub-inactive': 'Host mode is not running.',
      },
      zh: {
        intro: '将 DSH 会话和项目检查点同步到个人中枢。',
        language: '语言',
        auto: '自动（DSH）',
        'badge.shared': '共享',
        'badge.local': '本地',
        'projects.shared': '共享项目',
        'projects.local': '本地项目',
        'projects.title': '项目',
        'projects.close': '关闭',
        'projects.empty': '暂无已保存项目',
        'projects.tabProjects': '项目',
        'projects.tabSessions': '会话',
        'projects.mergedHint': '本地和服务器项目合并在一个列表中。',
        'projects.serverOnly': '仅在服务器',
        'projects.localOnly': '仅在本地',
        'projects.synced': '已同步',
        'projects.checkpoints': '{count} 个检查点',
        'projects.sessionServer': '在服务器上',
        'projects.sessionsEmpty': '服务器上没有会话。',
        'projects.sessionsHint': '中枢保存会话历史；不会导入到本地 DSH 会话。',
        'projects.syncAction': '同步',
        'projects.syncing': '同步中…',
        'projects.syncDone': '已同步到 v{version}',
        'projects.join': '导入',
        'projects.savePath': '保存路径',
        'projects.changePath': '更改路径',
        'projects.defaultPath': '默认路径',
        'projects.cancel': '取消',
        'projects.confirm': '确认',
        'projects.joining': '正在创建会话并同步…',
        'projects.emptyWarning': '建议使用空文件夹；已有文件可能冲突。',
        'projects.rootHint': '共享根目录：{root}',
        'projects.servicesMissing': '项目/会话服务不可用。',
        'mode.host': '主机',
        'mode.client': '客户端',
        'mode.both': '两者',
        'mode.off': '关闭',
        applyMode: '应用模式',
        'current.loading': '加载中',
        'current.both': '主机 + 客户端运行中',
        'current.host': '主机运行中',
        'current.hostSelf': '主机运行中（含本机同步）',
        'current.client': '客户端运行中',
        'current.off': '关闭',
        'current.stopped': '已停止',
        pendingApply: '待应用',
        'currentStatus': '当前：{state}',
        'host.heading': '主机设置',
        'host.port': '端口',
        'host.bind': '绑定地址',
        'host.running': '运行中：{url}',
        'host.selfSync': '本机的会话和项目也会上传到自己的中枢。',
        'host.configuredStopped': '已配置 · 已停止（应用模式后启动）',
        'host.startHint': '应用模式后启动。',
        'host.pairingCode': '配对码',
        'host.copy': '复制',
        'host.rotate': '轮换',
        'client.heading': '客户端设置',
        'client.target': '目标 URL（主机地址:端口）',
        'client.useHostInfo': '使用主机信息填充',
        'client.code': '配对码',
        'client.name': '设备名称',
        'client.pair': '配对',
        'client.unpair': '解除配对',
        'client.paired': '已配对：{device} → {url}',
        'client.pairHint': '请先配对，然后应用模式以启动客户端。',
        'off.hint': '应用后将停止主机和客户端。设置和配对令牌会保留。',
        'workspace.heading': '共享项目',
        'workspace.path': '路径',
        'workspace.useCurrent': '当前会话路径',
        'workspace.mark': '共享项目',
        'workspace.unmark': '取消共享',
        'workspace.scan': '扫描子文件夹',
        'workspace.shared': '共享中（同步中） · {folderId}',
        'workspace.local': '未共享',
        'workspace.list': '项目列表',
        'workspace.badgeShared': '共享中（同步中）',
        'workspace.badgeLocal': '未共享',
        'sync.heading': '项目同步',
        'sync.now': '立即同步（会话 + 项目）',
        'sync.last': '上次：{time} · 会话 {sessions}/{events} 个事件 · 拉取 {pull} · 推送 {push} · 冲突 {conflicts}',
        'sync.noChanges': '（无变化）',
        'sync.errors': '（{count} 个错误）',
        'sync.none': '尚无手动同步记录。',
        'action.refresh': '刷新',
        'action.checkUpdate': '检查更新',
        'action.done': '{label}完成',
        'update.none': '尚未检查更新',
        'update.rowTitle': '会话同步更新',
        'update.check': '检查更新',
        'update.run': '执行更新',
        'update.installed': '已安装 {current} · 最新 {latest}',
        'update.confirm': '更新会重启中枢。继续吗？',
        'update.confirmYes': '立即更新',
        'update.cancel': '取消',
        'update.started': '更新已开始。请刷新或重启 DSH。',
        'update.failed': '更新失败',
        'update.upToDate': '已是最新',
        'update.available': '最新 {latest} · 可更新',
        'update.current': '最新 {latest} · 已是最新',
        'update.error': '检查失败：{message}',
        'update.reinstall': '请在 Plugins 中用最新 GitHub URL 重新安装。',
        'copy.done': '配对码已复制',
        'copy.failed': '无法复制到剪贴板',
        'error.invalid-mode': '模式无效。',
        'error.invalid-port': '端口必须在 1 到 65535 之间。',
        'error.invalid-pair': '请输入目标 URL 和配对码。',
        'error.pair-failed': '配对失败。',
        'error.not-paired': '请先配对本机。',
        'error.invalid-path': '项目路径无效或不存在。',
        'error.no-workspace': '请先共享项目。',
        'error.no-marker': '该项目尚未标记为同步。',
        'error.not-marked': '该项目未标记为同步。',
        'error.container-not-project': '共享根目录是容器。请共享其中的项目文件夹。',
        'error.client-inactive': '客户端模式未启用；请先配对。',
        'error.hub-inactive': '主机模式未运行。',
      },
      ko: {
        intro: 'DSH 세션과 프로젝트 체크포인트를 개인 허브와 동기화합니다.',
        language: '언어',
        auto: '자동(DSH)',
        'badge.shared': '공유',
        'badge.local': '로컬',
        'projects.shared': '공유 프로젝트',
        'projects.local': '로컬 프로젝트',
        'projects.title': '프로젝트',
        'projects.close': '닫기',
        'projects.empty': '저장된 프로젝트가 없습니다',
        'projects.tabProjects': '프로젝트',
        'projects.tabSessions': '세션',
        'projects.mergedHint': '로컬과 서버 프로젝트를 하나의 목록에서 봅니다.',
        'projects.serverOnly': '서버에만 있음',
        'projects.localOnly': '로컬에만 있음',
        'projects.synced': '동기화됨',
        'projects.checkpoints': '체크포인트 {count}개',
        'projects.sessionServer': '서버에 있음',
        'projects.sessionsEmpty': '서버에 세션이 없습니다.',
        'projects.sessionsHint': '세션 이력은 허브에 저장되며 로컬 DSH 세션으로 가져오지 않습니다.',
        'projects.syncAction': '동기화',
        'projects.syncing': '동기화 중…',
        'projects.syncDone': 'v{version}(으)로 동기화됨',
        'projects.join': '가져오기',
        'projects.savePath': '저장 경로',
        'projects.changePath': '경로 변경',
        'projects.defaultPath': '기본 경로',
        'projects.cancel': '취소',
        'projects.confirm': '확인',
        'projects.joining': '세션 생성 및 동기화 중…',
        'projects.emptyWarning': '빈 폴더를 권장합니다. 기존 파일이 있으면 충돌할 수 있습니다.',
        'projects.rootHint': '공유 루트: {root}',
        'projects.servicesMissing': '프로젝트/세션 서비스를 사용할 수 없습니다.',
        'mode.host': '호스트',
        'mode.client': '클라이언트',
        'mode.both': '둘 다',
        'mode.off': '끔',
        applyMode: '모드 적용',
        'current.loading': '불러오는 중',
        'current.both': '호스트 + 클라이언트 동작 중',
        'current.host': '호스트 동작 중',
        'current.hostSelf': '호스트 동작 중 (본체 동기화 포함)',
        'current.client': '클라이언트 동작 중',
        'current.off': '꺼짐',
        'current.stopped': '중지됨',
        pendingApply: '적용 대기',
        'currentStatus': '현재: {state}',
        'host.heading': '호스트 설정',
        'host.port': '포트',
        'host.bind': '바인딩 주소',
        'host.running': '실행 중: {url}',
        'host.selfSync': '이 컴퓨터의 세션과 프로젝트도 자체 허브로 업로드됩니다.',
        'host.configuredStopped': '설정됨 · 중지됨 (모드 적용으로 시작)',
        'host.startHint': '모드 적용 후 시작됩니다.',
        'host.pairingCode': '페어링 코드',
        'host.copy': '복사',
        'host.rotate': '회전',
        'client.heading': '클라이언트 설정',
        'client.target': '대상 URL (호스트 주소:포트)',
        'client.useHostInfo': '호스트 정보로 덮어쓰기',
        'client.code': '페어링 코드',
        'client.name': '기기 이름',
        'client.pair': '페어링',
        'client.unpair': '페어링 해제',
        'client.paired': '페어링됨: {device} → {url}',
        'client.pairHint': '페어링 후 모드 적용으로 클라이언트를 시작합니다.',
        'off.hint': '모드 적용 시 호스트와 클라이언트를 모두 중지합니다. 설정과 페어링 토큰은 유지됩니다.',
        'workspace.heading': '공유 프로젝트',
        'workspace.path': '경로',
        'workspace.useCurrent': '현재 세션 경로',
        'workspace.mark': '프로젝트 공유',
        'workspace.unmark': '동기화 해제',
        'workspace.scan': '하위 폴더 스캔',
        'workspace.shared': '공유중(동기화중) · {folderId}',
        'workspace.local': '공유하지 않음',
        'workspace.list': '프로젝트 목록',
        'workspace.badgeShared': '공유중(동기화중)',
        'workspace.badgeLocal': '공유하지 않음',
        'sync.heading': '프로젝트 동기화',
        'sync.now': '지금 동기화 (세션 + 프로젝트)',
        'sync.last': '마지막: {time} · 세션 {sessions}/{events} 이벤트 · pull {pull} · push {push} · 충돌 {conflicts}',
        'sync.noChanges': '(변경 없음)',
        'sync.errors': '(오류 {count})',
        'sync.none': '아직 수동 동기화 기록이 없습니다.',
        'action.refresh': '새로고침',
        'action.checkUpdate': '업데이트 확인',
        'action.done': '{label} 완료',
        'update.none': '업데이트 확인 전',
        'update.rowTitle': '세션 동기화 업데이트',
        'update.check': '업데이트 확인',
        'update.run': '업데이트 실행',
        'update.installed': '설치 {current} · 최신 {latest}',
        'update.confirm': '업데이트하면 Hub가 재시작됩니다. 계속할까요?',
        'update.confirmYes': '지금 업데이트',
        'update.cancel': '취소',
        'update.started': '업데이트가 시작되었습니다. 새로고침하거나 DSH를 재시작하세요.',
        'update.failed': '업데이트 실패',
        'update.upToDate': '최신 버전',
        'update.available': '최신 {latest} · 업데이트 가능',
        'update.current': '최신 {latest} · 최신 버전',
        'update.error': '확인 실패: {message}',
        'update.reinstall': 'Plugins에서 이 플러그인을 최신 GitHub URL로 재설치하세요.',
        'copy.done': '페어링 코드를 복사했습니다',
        'copy.failed': '클립보드에 복사하지 못했습니다',
        'error.invalid-mode': '모드가 올바르지 않습니다.',
        'error.invalid-port': '포트는 1~65535 사이여야 합니다.',
        'error.invalid-pair': '대상 URL과 페어링 코드를 입력하세요.',
        'error.pair-failed': '페어링에 실패했습니다.',
        'error.not-paired': '먼저 이 컴퓨터를 페어링하세요.',
        'error.invalid-path': '프로젝트 경로가 없거나 올바르지 않습니다.',
        'error.no-workspace': '먼저 프로젝트를 공유하세요.',
        'error.no-marker': '프로젝트가 동기화 대상으로 지정되지 않았습니다.',
        'error.not-marked': '프로젝트가 동기화 대상이 아닙니다.',
        'error.container-not-project': '공유 루트는 컨테이너입니다. 그 안의 프로젝트 폴더를 공유하세요.',
        'error.client-inactive': '클라이언트 모드가 아닙니다. 먼저 페어링하세요.',
        'error.hub-inactive': '호스트 모드가 실행 중이 아닙니다.',
      },
    }

    function detectLanguage() {
      const raw = (typeof document !== 'undefined' ? document.documentElement.lang : '')
        || (typeof navigator !== 'undefined' ? navigator.language : '')
        || 'en'
      const lang = String(raw).toLowerCase()
      if (lang.startsWith('zh')) return 'zh'
      if (lang.startsWith('ko')) return 'ko'
      return 'en'
    }

    function readLanguage() {
      try {
        const saved = localStorage.getItem(LOCALE_KEY)
        if (saved === 'auto' || saved === 'en' || saved === 'zh' || saved === 'ko') return saved
      } catch {
        // A blocked localStorage just leaves the automatic choice.
      }
      return 'auto'
    }

    function writeLanguage(value) {
      try {
        localStorage.setItem(LOCALE_KEY, value)
      } catch {
        // The in-memory selection still works for this mount.
      }
    }

    function translate(lang, key, params) {
      const dict = STRINGS[lang] ?? STRINGS.en
      const template = dict[key] ?? STRINGS.en[key] ?? key
      if (!params) return template
      return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
    }

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
        const error = new Error(message)
        error.code = payload?.error?.code
        throw error
      }
      return payload
    }

    function localizeError(reason, t) {
      if (reason?.code) {
        const key = `error.${reason.code}`
        const text = t(key)
        if (text !== key) return text
      }
      return String(reason?.message ?? reason)
    }

    function hostUrl(status) {
      const host = status?.hub?.host === '0.0.0.0' ? '127.0.0.1' : status?.hub?.host
      if (!host) return ''
      return `http://${host}:${status.hub.port}`
    }

    function currentLabel(status, t) {
      if (!status) return t('current.loading')
      if (status.hub.running && status.client?.self && status.client.running) return t('current.hostSelf')
      if (status.hub.running) return t('current.host')
      if (status.client.running) return t('current.client')
      return status.mode === 'off' ? t('current.off') : t('current.stopped')
    }

    function updateLabel(update, t) {
      if (!update) return t('update.none')
      if (update.updateAvailable) return t('update.available', { latest: update.latest })
      if (update.latest) return t('update.current', { latest: update.latest })
      if (update.error) return t('update.error', { message: String(update.error).slice(0, 80) })
      return t('update.error', { message: '' })
    }

    const fieldBase = { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }
    const workspaceRow = {
      display: 'flex', gap: 8, alignItems: 'center', padding: '4px 6px',
      border: '1px solid rgba(127,127,127,0.22)', borderRadius: 6,
      background: 'transparent', color: 'inherit', cursor: 'pointer',
      textAlign: 'left', font: 'inherit',
    }
    const styles = {
      root: { display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 4px 20px', maxWidth: 720 },
      titleRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      title: { margin: 0, fontSize: 18, fontWeight: 600 },
      languageField: { display: 'flex', alignItems: 'center', gap: 6, position: 'relative' },
      languagePicker: { position: 'relative' },
      languageButton: {
        padding: '4px 8px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,0.4))',
        background: 'var(--dsw-alias-bg-primary, transparent)', color: 'inherit', font: 'inherit', cursor: 'pointer',
      },
      languageMenu: {
        position: 'absolute', top: '100%', right: 0, marginTop: 4, minWidth: 150, padding: 4, zIndex: 1000,
        borderRadius: 8, border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,0.4))',
        background: 'var(--dsw-alias-bg-primary, #232529)', color: 'inherit',
        boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
      },
      languageOption: {
        display: 'block', width: '100%', padding: '6px 8px', border: 0, borderRadius: 4,
        background: 'transparent', color: 'inherit', cursor: 'pointer', textAlign: 'left', font: 'inherit',
      },
      languageOptionActive: {
        display: 'block', width: '100%', padding: '6px 8px', border: 0, borderRadius: 4,
        background: 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.18))', color: 'inherit',
        cursor: 'pointer', textAlign: 'left', font: 'inherit',
      },
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
      updateAvailable: { margin: 0, fontSize: 12, color: '#d08a2e' },
      workspaceList: { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2 },
      workspaceGroups: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 2 },
      workspaceGroup: { display: 'flex', flexDirection: 'column', gap: 4 },
      groupHeading: { fontSize: 11, fontWeight: 600, opacity: 0.6, letterSpacing: 0.2 },
      workspaceRow,
      workspaceRowActive: {
        ...workspaceRow,
        background: 'rgba(127,127,127,0.15)',
        borderColor: 'rgba(127,127,127,0.5)',
      },
      workspacePath: {
        flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
        whiteSpace: 'nowrap', fontSize: 12, fontFamily: 'ui-monospace, monospace',
      },
      sharedBadge: {
        flex: '0 0 auto', fontSize: 11, padding: '1px 6px', borderRadius: 4,
        background: 'rgba(60,154,95,0.18)', color: '#3c9a5f',
      },
      localBadge: {
        flex: '0 0 auto', fontSize: 11, padding: '1px 6px', borderRadius: 4,
        background: 'rgba(127,127,127,0.15)', opacity: 0.8,
      },
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

    const LANGUAGE_OPTIONS = [
      ['auto', () => 'auto'],
      ['en', () => 'English'],
      ['zh', () => '中文'],
      ['ko', () => '한국어'],
    ]

    /** Theme-aware replacement for a native select, whose popup ignores dark mode. */
    function LanguagePicker({ language, onChange, t }) {
      const [open, setOpen] = useState(false)
      const root = useRef(null)
      useEffect(() => {
        if (!open) return undefined
        const onDown = (event) => {
          if (!root.current?.contains(event.target)) setOpen(false)
        }
        const onKey = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('mousedown', onDown)
        window.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('mousedown', onDown)
          window.removeEventListener('keydown', onKey)
        }
      }, [open])
      const label = language === 'auto' ? t('auto') : (language === 'en' ? 'English' : language === 'zh' ? '中文' : '한국어')
      return h('div', { ref: root, style: styles.languagePicker },
        h('button', {
          type: 'button',
          style: styles.languageButton,
          'aria-haspopup': 'listbox',
          'aria-expanded': open,
          onClick: () => setOpen((value) => !value),
        }, `${label} ▾`),
        open ? h('div', { style: styles.languageMenu, role: 'listbox' },
          LANGUAGE_OPTIONS.map(([value, fallback]) => h('button', {
            key: value,
            type: 'button',
            role: 'option',
            'aria-selected': language === value,
            style: language === value ? styles.languageOptionActive : styles.languageOption,
            onClick: () => {
              onChange(value)
              setOpen(false)
            },
          }, value === 'auto' ? t('auto') : fallback()))) : null)
    }

    const badgeCache = new Map()

    /** A small shared/local marker on a left-sidebar session row. */
    function SessionBadge({ sessionId }) {
      const [info, setInfo] = useState(() => (sessionId ? badgeCache.get(sessionId) ?? null : null))
      useEffect(() => {
        if (!sessionId) return undefined
        if (badgeCache.has(sessionId)) {
          setInfo(badgeCache.get(sessionId))
          return undefined
        }
        let alive = true
        void call('session', { sessionId }).then((data) => {
          badgeCache.set(sessionId, data)
          if (alive) setInfo(data)
        }).catch(() => {
          badgeCache.set(sessionId, null)
        })
        return () => {
          alive = false
        }
      }, [sessionId])
      if (!info?.cwd) return null
      const shared = Boolean(info.shared)
      return h('span', {
        title: info.cwd,
        style: {
          display: 'inline-block',
          marginLeft: 4,
          padding: '0 4px',
          borderRadius: 3,
          fontSize: 10,
          lineHeight: '14px',
          whiteSpace: 'nowrap',
          color: shared ? '#7fd39a' : '#9aa0a6',
          background: shared ? 'rgba(60,154,95,0.18)' : 'rgba(127,127,127,0.12)',
        },
      }, translate(
        readLanguage() === 'auto' ? detectLanguage() : readLanguage(),
        shared ? 'badge.shared' : 'badge.local',
      ))
    }

    const updateStyles = {
      wrap: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12 },
      title: { fontWeight: 600 },
      hint: { opacity: 0.7 },
      warning: { color: '#d08a2e' },
      button: {
        padding: '4px 9px', borderRadius: 6, border: '1px solid rgba(127,127,127,0.4)',
        background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit', fontSize: 12,
      },
      primary: {
        padding: '4px 9px', borderRadius: 6, border: '1px solid rgba(60,154,95,0.55)',
        background: 'rgba(60,154,95,0.18)', color: 'inherit', cursor: 'pointer', font: 'inherit', fontSize: 12,
      },
    }

    /** Status-only update row. Installation stays with the Plugin Manager. */
    function UpdateControl() {
      const [update, setUpdate] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const lang = readLanguage() === 'auto' ? detectLanguage() : readLanguage()
      const tr = (key, params) => translate(lang, key, params)

      const check = async (force) => {
        setBusy(true)
        setError('')
        try {
          setUpdate(await call('update', { force: Boolean(force) }))
        } catch (reason) {
          setError(String(reason?.message ?? reason))
        } finally {
          setBusy(false)
        }
      }

      useEffect(() => {
        void check(false)
      }, [])

      const installed = update
        ? tr('update.installed', {
          current: `v${update.current ?? '?'}`,
          latest: update.latest ?? '?',
        })
        : ''

      return h('div', { style: { ...updateStyles.wrap, justifyContent: 'space-between', width: '100%' } },
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
          h('span', { style: updateStyles.title }, tr('update.rowTitle')),
          h('span', { style: updateStyles.hint }, installed || tr('update.none')),
          update?.updateAvailable ? h('span', { style: updateStyles.hint }, tr('update.reinstall')) : null,
          error ? h('span', { style: updateStyles.warning }, `${tr('update.failed')}: ${error}`) : null),
        h('button', {
          type: 'button',
          style: updateStyles.button,
          disabled: busy,
          onClick: () => check(true),
        }, tr('update.check')))
    }

    const projectStyles = {
      button: {
        flex: '0 0 auto', height: 28, padding: '0 9px', marginLeft: 6,
        border: '1px solid rgba(127,127,127,0.35)', borderRadius: 6,
        background: 'transparent', color: 'inherit', cursor: 'pointer',
        font: 'inherit', fontSize: 12,
      },
      overlay: {
        position: 'fixed', inset: 0, zIndex: 1000, padding: 20,
        background: 'rgba(0,0,0,0.55)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
      },
      modal: {
        width: 'min(620px, 100%)', maxHeight: '70vh', overflow: 'auto',
        padding: 16, borderRadius: 12, border: '1px solid rgba(127,127,127,0.35)',
        background: '#232529', color: '#e8e9ec',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        display: 'flex', flexDirection: 'column', gap: 10,
      },
      header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
      tabs: { display: 'flex', gap: 6, borderBottom: '1px solid rgba(127,127,127,0.25)', paddingBottom: 6 },
      tab: {
        padding: '4px 10px', borderRadius: 6, border: '1px solid transparent',
        background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12, opacity: 0.7,
      },
      tabActive: {
        padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(127,127,127,0.35)',
        background: 'rgba(127,127,127,0.14)', color: 'inherit', cursor: 'pointer', fontSize: 12,
      },
      title: { margin: 0, fontSize: 16, fontWeight: 600 },
      close: {
        border: '1px solid rgba(127,127,127,0.35)', borderRadius: 6,
        background: 'transparent', color: 'inherit', cursor: 'pointer',
        padding: '3px 8px', fontSize: 12,
      },
      group: { display: 'flex', flexDirection: 'column', gap: 4 },
      heading: { fontSize: 11, fontWeight: 600, opacity: 0.6 },
      row: { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 7px', borderRadius: 6, background: 'rgba(127,127,127,0.08)' },
      path: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, fontFamily: 'ui-monospace, monospace' },
      shared: { flex: '0 0 auto', fontSize: 10, padding: '1px 5px', borderRadius: 3, color: '#7fd39a', background: 'rgba(60,154,95,0.18)' },
      local: { flex: '0 0 auto', fontSize: 10, padding: '1px 5px', borderRadius: 3, color: '#9aa0a6', background: 'rgba(127,127,127,0.12)' },
      hint: { margin: 0, fontSize: 12, opacity: 0.7 },
      input: { padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(127,127,127,0.4)', background: 'transparent', color: 'inherit', font: 'inherit', width: '100%', boxSizing: 'border-box' },
      actions: { display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' },
      primary: { padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(60,154,95,0.55)', background: 'rgba(60,154,95,0.18)', color: 'inherit', cursor: 'pointer', fontSize: 12 },
    }

    function projectFolderName(value) {
      return String(value ?? '')
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
        .replace(/^[. ]+|[. ]+$/g, '')
        .trim()
        .slice(0, 80) || 'project'
    }

    /** Projects button beside New session, with a grouped modal and a Join flow. */
    function ProjectsAction({ wide, children, workspaces, uiWorkspace }) {
      const [open, setOpen] = useState(false)
      const [status, setStatus] = useState(null)
      const [error, setError] = useState('')
      const [hubProjects, setHubProjects] = useState([])
      const [projectsError, setProjectsError] = useState('')
      const [hubSessions, setHubSessions] = useState([])
      const [sessionsError, setSessionsError] = useState('')
      const [tab, setTab] = useState('projects')
      const [joinProject, setJoinProject] = useState(null)
      const [joinPath, setJoinPath] = useState('')
      const [editingPath, setEditingPath] = useState(false)
      const [joining, setJoining] = useState(false)
      const [syncingKey, setSyncingKey] = useState('')
      const [syncNotice, setSyncNotice] = useState('')
      const lang = readLanguage() === 'auto' ? detectLanguage() : readLanguage()
      const tr = (key, params) => translate(lang, key, params)

      useEffect(() => {
        if (!open) return undefined
        let alive = true
        setStatus(null)
        setError('')
        setProjectsError('')
        setHubProjects([])
        setSessionsError('')
        setHubSessions([])
        setTab('projects')
        setJoinProject(null)
        setSyncNotice('')
        void call('status').then((data) => {
          if (alive) setStatus(data)
        }).catch((reason) => {
          if (alive) setError(String(reason?.message ?? reason))
        })
        void call('projects').then((data) => {
          if (!alive) return
          setHubProjects(Array.isArray(data?.projects) ? data.projects : [])
        }).catch((reason) => {
          if (alive) setProjectsError(String(reason?.message ?? reason))
        })
        void call('sessions').then((data) => {
          if (!alive) return
          setHubSessions(Array.isArray(data?.sessions) ? data.sessions : [])
        }).catch((reason) => {
          if (alive) setSessionsError(String(reason?.message ?? reason))
        })
        const onKey = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        window.addEventListener('keydown', onKey)
        return () => {
          alive = false
          window.removeEventListener('keydown', onKey)
        }
      }, [open])

      const defaultPath = (project) => {
        const root = String(status?.defaultWorkspace ?? '').replace(/[\\/]+$/, '')
        if (!root) return ''
        return `${root}\\${projectFolderName(project?.name || project?.id || '')}`
      }

      const selectProject = (project) => {
        setJoinProject(project)
        setJoinPath(defaultPath(project))
        setEditingPath(false)
        setError('')
      }

      const confirmJoin = async () => {
        if (!joinProject || !joinPath.trim() || joining) return
        if (!workspaces || !uiWorkspace) {
          setError(tr('projects.servicesMissing'))
          return
        }
        setJoining(true)
        setError('')
        try {
          const prepared = await call('projects/prepare', {
            folderId: joinProject.id,
            name: joinProject.name,
            path: joinPath.trim(),
          })
          const workspace = await workspaces.create({ path: prepared.path })
          await uiWorkspace.openWorkspace(workspace.workspaceId)
          await call('projects/sync', { folderId: prepared.folderId, path: prepared.path })
          setJoinProject(null)
          setOpen(false)
        } catch (reason) {
          setError(String(reason?.message ?? reason))
        } finally {
          setJoining(false)
        }
      }

      const refreshHub = async () => {
        try {
          const [projects, nextStatus] = await Promise.all([call('projects'), call('status')])
          setHubProjects(Array.isArray(projects?.projects) ? projects.projects : [])
          setStatus(nextStatus)
        } catch {
          // Keep the current view if the refresh fails; the sync result still shows.
        }
      }

      const syncExisting = async (item) => {
        if (!item.hub || !item.local || syncingKey) return
        setSyncingKey(item.key)
        setSyncNotice('')
        setError('')
        try {
          const result = await call('projects/sync', { folderId: item.hub.id, path: item.local.path })
          const version = result?.pulled?.version
          setSyncNotice(tr('projects.syncDone', { version: version ?? '-' }))
          await refreshHub()
        } catch (reason) {
          setError(String(reason?.message ?? reason))
        } finally {
          setSyncingKey('')
        }
      }

      const known = status?.knownWorkspaces ?? []
      const hubById = new Map(hubProjects.map((project) => [project.id, project]))
      const localByFolder = new Map()
      for (const ws of known) if (ws.folderId) localByFolder.set(ws.folderId, ws)
      const unified = []
      for (const project of hubProjects) {
        unified.push({ key: `hub:${project.id}`, hub: project, local: localByFolder.get(project.id) })
      }
      for (const ws of known) {
        if (ws.folderId && hubById.has(ws.folderId)) continue
        unified.push({ key: `local:${ws.path}`, hub: null, local: ws })
      }

      const projectRow = (item) => {
        const { hub, local } = item
        const badge = hub && local
          ? tr('projects.synced')
          : hub
            ? tr('projects.serverOnly')
            : tr('projects.localOnly')
        return h('div', { key: item.key, style: projectStyles.row },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: '1 1 auto' } },
            h('span', { style: projectStyles.path, title: hub?.id || local?.path || '' }, hub?.name || local?.path || '—'),
            local?.path ? h('span', { style: projectStyles.hint, title: local.path }, local.path) : null,
            hub ? h('span', { style: projectStyles.hint },
              `v${hub.headVersion ?? 0} · ${tr('projects.checkpoints', { count: hub.checkpointCount ?? 0 })}`) : null),
          h('span', { style: hub && local ? projectStyles.shared : projectStyles.local }, badge),
          hub && !local ? h('button', {
            type: 'button',
            style: projectStyles.button,
            onClick: () => selectProject(hub),
          }, tr('projects.join')) : null,
          hub && local ? h('button', {
            type: 'button',
            style: projectStyles.button,
            disabled: Boolean(syncingKey),
            onClick: () => syncExisting(item),
          }, syncingKey === item.key ? tr('projects.syncing') : tr('projects.syncAction')) : null)
      }

      const sessionRow = (session) => {
        const header = session.header ?? {}
        return h('div', { key: session.id, style: projectStyles.row },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: '1 1 auto' } },
            h('span', { style: projectStyles.path, title: session.id }, header.title || session.id),
            header.cwd ? h('span', { style: projectStyles.hint, title: header.cwd }, header.cwd) : null,
            h('span', { style: projectStyles.hint },
              `${header.createdAt ? new Date(header.createdAt).toLocaleString(lang) : '-'} · v${session.head?.version ?? 0}`)),
          h('span', { style: projectStyles.local }, tr('projects.sessionServer')))
      }

      return h(React.Fragment, null,
        children,
        h('button', {
          type: 'button',
          style: projectStyles.button,
          title: tr('projects.title'),
          'aria-label': tr('projects.title'),
          onClick: (event) => {
            event.stopPropagation()
            setOpen(true)
          },
        }, wide ? tr('projects.title') : '▦'),
        open ? h('div', {
          style: projectStyles.overlay,
          onClick: () => {
            if (!joining) setOpen(false)
          },
        }, h('div', {
          style: projectStyles.modal,
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': tr('projects.title'),
          onClick: (event) => event.stopPropagation(),
        },
          h('div', { style: projectStyles.header },
            h('h3', { style: projectStyles.title }, tr('projects.title')),
            h('button', {
              type: 'button',
              style: projectStyles.close,
              disabled: joining,
              onClick: () => setOpen(false),
            }, tr('projects.close'))),
          error ? h('p', { style: projectStyles.hint }, error) : null,
          syncNotice ? h('p', { style: projectStyles.hint }, syncNotice) : null,
          !joinProject ? h('div', { style: projectStyles.tabs },
            h('button', {
              type: 'button',
              style: tab === 'projects' ? projectStyles.tabActive : projectStyles.tab,
              disabled: joining,
              onClick: () => setTab('projects'),
            }, tr('projects.tabProjects')),
            h('button', {
              type: 'button',
              style: tab === 'sessions' ? projectStyles.tabActive : projectStyles.tab,
              disabled: joining,
              onClick: () => setTab('sessions'),
            }, tr('projects.tabSessions'))) : null,
          joinProject ? h('div', { style: projectStyles.group },
            h('span', { style: projectStyles.heading }, joinProject.name || joinProject.id),
            h('p', { style: projectStyles.hint }, tr('projects.rootHint', {
              root: status?.defaultWorkspace ?? '',
            })),
            h('span', { style: projectStyles.heading }, tr('projects.savePath')),
            h('div', { style: projectStyles.row },
              h('span', { style: projectStyles.path, title: joinPath }, joinPath || '—'),
              h('button', {
                type: 'button',
                style: projectStyles.button,
                disabled: joining,
                onClick: () => setEditingPath((value) => !value),
              }, tr('projects.changePath'))),
            editingPath ? h('input', {
              value: joinPath,
              style: projectStyles.input,
              disabled: joining,
              onChange: (event) => setJoinPath(event.target.value),
            }) : null,
            h('p', { style: projectStyles.hint }, tr('projects.emptyWarning')),
            h('div', { style: projectStyles.actions },
              h('button', {
                type: 'button',
                style: projectStyles.button,
                disabled: joining,
                onClick: () => {
                  setJoinPath(defaultPath(joinProject))
                  setEditingPath(false)
                },
              }, tr('projects.defaultPath')),
              h('button', {
                type: 'button',
                style: projectStyles.button,
                disabled: joining,
                onClick: () => {
                  setJoinProject(null)
                  setEditingPath(false)
                },
              }, tr('projects.cancel')),
              h('button', {
                type: 'button',
                style: projectStyles.primary,
                disabled: joining || !joinPath.trim(),
                onClick: confirmJoin,
              }, tr('projects.confirm'))),
            joining ? h('p', { style: projectStyles.hint }, tr('projects.joining')) : null) : h(React.Fragment, null,
            h('p', { style: projectStyles.hint },
              tab === 'projects' ? tr('projects.mergedHint') : tr('projects.sessionsHint')),
            tab === 'projects' ? h(React.Fragment, null,
              projectsError ? h('p', { style: projectStyles.hint }, projectsError) : null,
              unified.length ? unified.map(projectRow)
                : !projectsError ? h('p', { style: projectStyles.hint }, tr('projects.empty')) : null)
              : h(React.Fragment, null,
                sessionsError ? h('p', { style: projectStyles.hint }, sessionsError) : null,
                hubSessions.length ? hubSessions.map(sessionRow)
                  : !sessionsError ? h('p', { style: projectStyles.hint }, tr('projects.sessionsEmpty')) : null)),
        )) : null)
    }

    function SessionSyncSection() {
      const [status, setStatus] = useState(null)
      const [busy, setBusy] = useState('')
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [update, setUpdate] = useState(null)
      const [language, setLanguage] = useState(readLanguage)
      const [detected, setDetected] = useState(detectLanguage)
      const [mode, setMode] = useState('host')
      const [hostPort, setHostPort] = useState('8787')
      const [hostBind, setHostBind] = useState('127.0.0.1')
      const [target, setTarget] = useState('')
      const [code, setCode] = useState('')
      const [name, setName] = useState('')
      const [workspace, setWorkspace] = useState('')
      const [initialized, setInitialized] = useState(false)

      const lang = language === 'auto' ? detected : language
      const t = (key, params) => translate(lang, key, params)

      useEffect(() => {
        if (typeof MutationObserver === 'undefined') return undefined
        const observer = new MutationObserver(() => setDetected(detectLanguage()))
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
        return () => observer.disconnect()
      }, [])

      const refresh = async (initial = false) => {
        const next = await call('status')
        setStatus(next)
        setUpdate(next.update ?? null)
        if (initial || !initialized) {
          setMode(next.mode ?? 'host')
          setHostPort(String(next.hub.port ?? 8787))
          setHostBind(next.hub.host ?? '127.0.0.1')
          setTarget(next.client.hubUrl ?? hostUrl(next))
          setCode(next.hub.pairingCode ?? '')
          setName(next.client.deviceName ?? '')
          const firstShared = next.knownWorkspaces?.find((ws) => ws.shared)?.path
          setWorkspace(next.workspace.path || firstShared || next.defaultWorkspace || '')
          setInitialized(true)
        }
        return next
      }

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
          setNotice(t('action.done', { label }))
          return next
        } catch (reason) {
          setError(localizeError(reason, t))
          return undefined
        } finally {
          setBusy('')
        }
      }

      useEffect(() => {
        void refresh(true).then(() => {
          void call('update', { force: false }).then(setUpdate).catch(() => {})
        }).catch((reason) => setError(localizeError(reason, t)))
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      const checkUpdate = () => run(t('action.checkUpdate'), async () => {
        const result = await call('update', { force: true })
        setUpdate(result)
        return result
      })

      const applyMode = () => run(t('applyMode'), () => call('mode', {
        mode,
        port: Number(hostPort),
        bind: hostBind,
      }))

      const pair = () => run(t('client.pair'), () => call('pair', {
        hubUrl: target.trim(),
        code: code.trim(),
        name: name.trim(),
      }))

      const unpair = () => run(t('client.unpair'), () => call('unpair', {}))

      const mark = () => run(t('workspace.mark'), () => call('workspace', { path: workspace.trim() }))

      const unmark = () => run(t('workspace.unmark'), () => call('workspace/unmark', { path: workspace.trim() }))

      const scan = () => run(t('workspace.scan'), async () => {
        const result = await call('workspaces/scan', {})
        if (result.workspace?.path) setWorkspace(result.workspace.path)
        return result
      })

      const syncNow = () => run(t('sync.heading'), () => call('sync', {}))

      const rotate = () => run(t('host.rotate'), () => call('code', { rotate: true }))

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
          () => setNotice(t('copy.done')),
          () => setError(t('copy.failed')),
        )
      }

      const changeLanguage = (value) => {
        setLanguage(value)
        writeLanguage(value)
      }

      const showHost = mode === 'host'
      const showClient = mode === 'client'
      const showSync = mode === 'host' || mode === 'client'
      const pending = status ? mode !== status.mode : false
      const selectedWorkspace = status?.knownWorkspaces?.find((ws) => ws.path === workspace)
      const selectedShared = selectedWorkspace
        ? selectedWorkspace.shared
        : Boolean(status?.workspace?.marked && status.workspace.path === workspace)
      const last = status?.lastSync
      const lastPush = last
        ? `v${last.pushed?.version ?? '-'}${last.pushed?.skipped ? ` ${t('sync.noChanges')}` : ''}`
        : ''
      const lastSessions = last
        ? `${last.sessions?.pushed ?? 0}${last.sessions?.errors ? ` ${t('sync.errors', { count: last.sessions.errors })}` : ''}`
        : ''
      const sharedProjects = status?.knownWorkspaces?.filter((ws) => ws.shared) ?? []
      const localProjects = status?.knownWorkspaces?.filter((ws) => !ws.shared) ?? []
      const projectRow = (ws) => h('button', {
        key: ws.path,
        type: 'button',
        style: ws.path === workspace ? styles.workspaceRowActive : styles.workspaceRow,
        onClick: () => setWorkspace(ws.path),
      },
        h('span', { style: styles.workspacePath }, ws.path),
        h('span', { style: ws.shared ? styles.sharedBadge : styles.localBadge },
          ws.shared ? t('workspace.badgeShared') : t('workspace.badgeLocal')))

      return h('div', { style: styles.root },
        h('div', { style: styles.titleRow },
          h('h2', { style: styles.title }, 'Session sync'),
          h('div', { style: styles.languageField },
            h('span', { style: styles.label }, t('language')),
            h(LanguagePicker, { language, onChange: changeLanguage, t }))),
        h('p', { style: styles.muted }, t('intro')),

        h('div', { style: styles.modeRow },
          h('div', { style: styles.segmented },
            MODES.map((value) => h('button', {
              key: value,
              style: mode === value ? styles.segmentActive : styles.segment,
              disabled: Boolean(busy),
              onClick: () => setMode(value),
            }, t(`mode.${value}`)))),
          h('button', { style: styles.button, disabled: Boolean(busy), onClick: applyMode }, t('applyMode')),
          h('span', { style: styles.badge }, t('currentStatus', { state: currentLabel(status, t) })),
          pending ? h('span', { style: styles.pending }, t('pendingApply')) : null,
        ),

        showHost ? h('section', { style: styles.section },
          h('h3', { style: styles.heading }, t('host.heading')),
          h('div', { style: styles.row },
            fieldRow(t('host.port'), h('input', {
              type: 'number', min: 1, max: 65535, value: hostPort,
              onChange: (event) => setHostPort(event.target.value), style: styles.input,
            })),
            fieldRow(t('host.bind'), h('input', {
              value: hostBind, placeholder: '127.0.0.1',
              onChange: (event) => setHostBind(event.target.value), style: styles.input,
            })),
          ),
          h('p', { style: styles.hint },
            status?.hub.running
              ? t('host.running', { url: status.hub.url })
              : status?.hub.enabled
                ? t('host.configuredStopped')
                : t('host.startHint')),
          status?.hub.running ? h('p', { style: styles.hint }, t('host.selfSync')) : null,
          status?.hub?.pairingCode ? h('div', { style: styles.codeRow },
            h('span', { style: styles.label }, t('host.pairingCode')),
            h('code', { style: styles.code }, status.hub.pairingCode),
            h('button', { style: styles.smallButton, disabled: Boolean(busy), onClick: copyCode }, t('host.copy')),
            h('button', { style: styles.smallButton, disabled: Boolean(busy), onClick: rotate }, t('host.rotate'))) : null,
        ) : null,

        showClient ? h('section', { style: styles.section },
          h('h3', { style: styles.heading }, t('client.heading')),
          field(t('client.target'), h('input', {
            value: target, placeholder: 'http://192.168.0.10:8787',
            onChange: (event) => setTarget(event.target.value), style: styles.input,
          })),
          h('div', { style: styles.buttonRow },
            h('button', { style: styles.smallButton, disabled: Boolean(busy), onClick: useHostInfo }, t('client.useHostInfo'))),
          h('div', { style: styles.row },
            fieldRow(t('client.code'), h('input', {
              value: code, placeholder: 'ABCD-EFGH',
              onChange: (event) => setCode(event.target.value), style: styles.input,
            })),
            fieldRow(t('client.name'), h('input', {
              value: name, placeholder: 'laptop',
              onChange: (event) => setName(event.target.value), style: styles.input,
            })),
          ),
          h('div', { style: styles.buttonRow },
            h('button', { style: styles.button, disabled: Boolean(busy), onClick: pair }, t('client.pair')),
            status?.client?.paired
              ? h('button', { style: styles.smallButton, disabled: Boolean(busy), onClick: unpair }, t('client.unpair'))
              : null),
          h('p', { style: styles.hint },
            status?.client.paired
              ? t('client.paired', { device: status.client.deviceName ?? 'device', url: status.client.hubUrl })
              : t('client.pairHint')),
        ) : null,

        mode === 'off' ? h('p', { style: styles.hint }, t('off.hint')) : null,

        showSync ? h('section', { style: styles.section },
          h('h3', { style: styles.heading }, t('workspace.heading')),
          field(t('workspace.path'), h('input', {
            value: workspace, placeholder: 'C:\\Users\\me\\project',
            onChange: (event) => setWorkspace(event.target.value), style: styles.input,
          })),
          h('div', { style: styles.buttonRow },
            h('button', { style: styles.smallButton, disabled: Boolean(busy), onClick: useCurrent }, t('workspace.useCurrent')),
            h('button', { style: styles.button, disabled: Boolean(busy), onClick: mark }, t('workspace.mark')),
            selectedShared
              ? h('button', { style: styles.smallButton, disabled: Boolean(busy), onClick: unmark }, t('workspace.unmark'))
              : null,
            h('button', { style: styles.smallButton, disabled: Boolean(busy), onClick: scan }, t('workspace.scan'))),
          h('p', { style: styles.hint },
            status?.workspace?.marked
              ? t('workspace.shared', { folderId: status.workspace.folderId })
              : t('workspace.local')),
          status?.knownWorkspaces?.length ? h('div', { style: styles.workspaceGroups },
            sharedProjects.length ? h('div', { style: styles.workspaceGroup },
              h('span', { style: styles.groupHeading }, t('projects.shared')),
              sharedProjects.map(projectRow)) : null,
            localProjects.length ? h('div', { style: styles.workspaceGroup },
              h('span', { style: styles.groupHeading }, t('projects.local')),
              localProjects.map(projectRow)) : null,
          ) : null,
        ) : null,

        showSync ? h('section', { style: styles.section },
          h('h3', { style: styles.heading }, t('sync.heading')),
          h('div', { style: styles.buttonRow },
            h('button', { style: styles.button, disabled: Boolean(busy) || !status?.client?.running || !status?.workspace?.marked, onClick: syncNow }, t('sync.now'))),
          last
            ? h('p', { style: styles.hint }, t('sync.last', {
              time: new Date(last.at).toLocaleString(lang),
              sessions: lastSessions,
              events: last.sessions?.events ?? 0,
              pull: `v${last.pulled?.version ?? '-'}`,
              push: lastPush,
              conflicts: last.pulled?.conflicts?.length ?? 0,
            }))
            : h('p', { style: styles.hint }, t('sync.none')),
        ) : null,

        error ? h('p', { style: styles.error }, error) : null,
        notice ? h('p', { style: styles.notice }, notice) : null,
        h('div', { style: styles.buttonRow },
          h('button', { style: styles.smallButton, disabled: Boolean(busy), onClick: () => run(t('action.refresh'), async () => { await refresh(); return undefined }) }, t('action.refresh')),
          h('button', { style: styles.smallButton, disabled: Boolean(busy), onClick: checkUpdate }, t('action.checkUpdate')),
          h('span', { style: update?.updateAvailable ? styles.updateAvailable : styles.hint }, updateLabel(update, t)),
        ),
        update?.updateAvailable
          ? h('p', { style: styles.updateAvailable }, t('update.reinstall'))
          : null,
        h('p', { style: styles.hint }, `Session sync v${status?.pluginVersion ?? '?'} · protocol ${status?.protocol ?? '?'}`),
      )
    }

    return {
      inject: ['slots', 'workspaces', 'uiWorkspace'],
      apply(ctx) {
        const ProjectsEntry = (props) => h(ProjectsAction, {
          ...props,
          workspaces: ctx.workspaces,
          uiWorkspace: ctx.uiWorkspace,
        })
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'session-sync',
          order: 40,
          label: 'Session sync',
        }, SessionSyncSection))
        ctx.slots.inject('sidebar.session.row.trailing', () => ctx.slots.register({
          name: 'sidebar.session.row.trailing',
          id: 'session-sync-badge',
          order: 500,
        }, SessionBadge))
        ctx.slots.inject('sidebar.session.action', () => ctx.slots.register({
          name: 'sidebar.session.action',
          id: 'session-sync-projects',
        }, ProjectsEntry))
        ctx.slots.inject('settings.general.item', () => ctx.slots.register({
          name: 'settings.general.item',
          id: 'session-sync-update',
          order: 110,
        }, () => h(UpdateControl)))
      },
    }
  },
})
