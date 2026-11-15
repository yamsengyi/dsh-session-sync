/**
 * Host-side HTTP routes for the Session sync settings page.
 *
 * The page is a browser client under the same origin, so it calls these exact
 * routes instead of a generated Typert Remote. That keeps the bundle build-free
 * while still using Connection's Host/Origin fence and browser authentication:
 * every route runs `requestRejection` and `admit` before touching a handler.
 */

import { SyncHttpError, readJsonBody, sendError, sendJson } from './protocol.js'

const MAX_BODY_BYTES = 64 * 1024

/**
 * @param {object} options
 * @param {{ register: (route: object) => () => void }} options.webServer
 * @param {{ requestRejection: Function, admit: Function }} options.connection
 * @param {Record<string, Function>} options.handlers
 * @param {Console} [options.logger]
 * @returns {() => void} disposer removing every registered route
 */
export function createSessionSyncRoutes(options) {
  const { webServer, connection, handlers, logger = console } = options
  const disposers = []

  const dispatch = async (method, request, response, handler) => {
    try {
      if (request.method !== method) {
        response.statusCode = 405
        response.setHeader('allow', method)
        response.end()
        return
      }
      const rejection = connection.requestRejection({ headers: request.headers })
      if (rejection !== undefined) {
        response.statusCode = rejection
        response.end()
        return
      }
      const admission = connection.admit({ headers: request.headers })
      if (!('peer' in admission)) {
        response.statusCode = admission.rejection
        response.end()
        return
      }
      const body = method === 'POST' ? await readJsonBody(request, MAX_BODY_BYTES) : undefined
      const result = await handler(body, admission.peer)
      sendJson(response, 200, result ?? { ok: true })
    } catch (error) {
      if (!(error instanceof SyncHttpError)) {
        logger.error?.(`[session-sync] ${request.method} ${request.url} failed: ${error?.stack ?? error}`)
      }
      sendError(response, error)
    }
  }

  const register = (method, path, handler) => {
    disposers.push(webServer.register({
      kind: 'exact',
      path,
      handler: (request, response) => {
        void dispatch(method, request, response, handler)
      },
    }))
  }

  register('GET', '/session-sync/api/status', () => handlers.status())
  register('POST', '/session-sync/api/mode', (body) => handlers.setMode(body))
  register('POST', '/session-sync/api/pair', (body) => handlers.pair(body))
  register('POST', '/session-sync/api/unpair', () => handlers.unpair())
  register('POST', '/session-sync/api/workspace', (body) => handlers.markWorkspace(body))
  register('POST', '/session-sync/api/workspace/unmark', (body) => handlers.unmarkWorkspace(body))
  register('POST', '/session-sync/api/sync', () => handlers.syncNow())
  register('POST', '/session-sync/api/code', (body) => handlers.code(body))
  register('POST', '/session-sync/api/update', (body) => handlers.checkUpdate(body))

  return () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}
