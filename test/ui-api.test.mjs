import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionSyncRoutes } from '../src/ui-api.js'

const quiet = { info() {}, warn() {}, error() {}, log() {} }

function harness(handlers, options = {}) {
  const routes = new Map()
  const webServer = {
    register(route) {
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  }
  const connection = {
    requestRejection: () => options.rejection,
    admit: () => options.admission ?? { peer: { principal: {} } },
  }
  const dispose = createSessionSyncRoutes({ webServer, connection, handlers, logger: quiet })
  return { routes, dispose }
}

function request(method, body) {
  return {
    method,
    headers: {},
    url: '/session-sync/api/test',
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body))
    },
  }
}

function response() {
  let finish
  const done = new Promise((resolve) => { finish = resolve })
  return {
    statusCode: 0,
    headers: {},
    body: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value },
    end(body) { this.body = body; finish() },
    done,
  }
}

function baseHandlers(overrides = {}) {
  return {
    status: async () => ({ ok: true }),
    setMode: async (body) => ({ host: body }),
    pair: async (body) => ({ pair: body }),
    unpair: async () => ({ paired: false }),
    markWorkspace: async (body) => ({ workspace: body }),
    unmarkWorkspace: async (body) => ({ unmarked: body }),
    sessionInfo: async (body) => ({ session: body }),
    scanWorkspaces: async () => ({ scan: true }),
    listProjects: async () => ({ projects: [] }),
    prepareProject: async (body) => ({ prepare: body }),
    syncProject: async (body) => ({ sync: body }),
    syncNow: async () => ({ synced: true }),
    code: async (body) => ({ code: body?.rotate ? 'ROTATED' : 'CODE' }),
    checkUpdate: async (body) => ({ update: body }),
    ...overrides,
  }
}

test('status route answers JSON and GET routes reject a POST', async () => {
  const { routes } = harness(baseHandlers())
  const statusRes = response()
  routes.get('/session-sync/api/status').handler(request('GET'), statusRes)
  await statusRes.done
  assert.equal(statusRes.statusCode, 200)
  assert.deepEqual(JSON.parse(statusRes.body), { ok: true })

  const hostRes = response()
  routes.get('/session-sync/api/mode').handler(request('GET'), hostRes)
  await hostRes.done
  assert.equal(hostRes.statusCode, 405)
  assert.equal(hostRes.headers.allow, 'POST')
})

test('a POST body reaches its handler', async () => {
  let received
  const { routes } = harness(baseHandlers({
    setMode: async (body) => {
      received = body
      return { applied: true }
    },
  }))
  const res = response()
  routes.get('/session-sync/api/mode').handler(request('POST', { enabled: true, port: 9000 }), res)
  await res.done
  assert.deepEqual(received, { enabled: true, port: 9000 })
  assert.equal(res.statusCode, 200)
})

test('trust rejection and admission rejection stop before the handler', async () => {
  let called = false
  const handlers = baseHandlers({
    status: async () => {
      called = true
      return { ok: true }
    },
  })

  const rejected = harness(handlers, { rejection: 401 })
  const first = response()
  rejected.routes.get('/session-sync/api/status').handler(request('GET'), first)
  await first.done
  assert.equal(first.statusCode, 401)
  assert.equal(called, false)

  const unauthenticated = harness(handlers, { admission: { rejection: 403 } })
  const second = response()
  unauthenticated.routes.get('/session-sync/api/status').handler(request('GET'), second)
  await second.done
  assert.equal(second.statusCode, 403)
  assert.equal(called, false)
})

test('disposing the routes removes every registration', () => {
  const { routes, dispose } = harness(baseHandlers())
  assert.equal(routes.size, 14)
  dispose()
  assert.equal(routes.size, 0)
})






