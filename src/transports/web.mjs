import { randomBytes } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { safeEqual } from "../pairing.mjs"
import { redactText } from "../redact.mjs"
import { fetchLatestRelease, isNewer, repoFromPackage } from "../update.mjs"
import { errorMessage } from "../util.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = join(HERE, "..", "web")
const PACKAGE = JSON.parse(
  await readFile(join(HERE, "..", "..", "package.json"), "utf8"),
)
const PACKAGE_VERSION = PACKAGE.version || "0.0.0"
const GITHUB_REPO = process.env.OPENCODE_ROAM_REPO || repoFromPackage(PACKAGE)
const REPO_URL = GITHUB_REPO ? `https://github.com/${GITHUB_REPO}` : ""

const ASSETS = {
  "/": ["landing.html", "text/html; charset=utf-8"],
  "/landing.html": ["landing.html", "text/html; charset=utf-8"],
  "/landing.css": ["landing.css", "text/css; charset=utf-8"],
  "/landing.js": ["landing.js", "text/javascript; charset=utf-8"],
  "/pwa-check": ["pwa-check.html", "text/html; charset=utf-8"],
  "/pwa-check.html": ["pwa-check.html", "text/html; charset=utf-8"],
  "/pwa-check.js": ["pwa-check.js", "text/javascript; charset=utf-8"],
  "/offline.html": ["offline.html", "text/html; charset=utf-8"],
  "/offline.css": ["offline.css", "text/css; charset=utf-8"],
  "/offline.js": ["offline.js", "text/javascript; charset=utf-8"],
  "/icon-192.png": ["icon-192.png", "image/png"],
  "/icon-512.png": ["icon-512.png", "image/png"],
  "/icon-maskable-512.png": ["icon-maskable-512.png", "image/png"],
  "/apple-touch-icon.png": ["apple-touch-icon.png", "image/png"],
  "/favicon-32.png": ["favicon-32.png", "image/png"],
  "/manifest.webmanifest": ["manifest.webmanifest", "application/manifest+json"],
  "/chat": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/i18n.js": ["i18n.js", "text/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/sw.js": ["sw.js", "text/javascript; charset=utf-8"],
}

const PUBLIC_ASSETS = new Set([
  "/",
  "/landing.html",
  "/landing.css",
  "/landing.js",
  "/pwa-check",
  "/pwa-check.html",
  "/pwa-check.js",
  "/offline.html",
  "/offline.css",
  "/offline.js",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
  "/favicon-32.png",
  "/manifest.webmanifest",
  "/i18n.js",
  "/sw.js",
])

const CSP =
  "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

const DECISION_LABEL = {
  once: "✅ Approved once",
  always: "♾️ Approved always",
  reject: "❌ Denied",
}

function languageFrom(request) {
  const header = String(request.headers["accept-language"] ?? "").toLowerCase()
  return header.includes("it") ? "it" : "en"
}

function httpError(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function parseCookies(header) {
  const cookies = {}
  for (const part of String(header ?? "").split(";")) {
    const index = part.indexOf("=")
    if (index < 0) continue
    const name = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (name) cookies[name] = decodeURIComponent(value)
  }
  return cookies
}

function readJson(request, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []

    request.on("data", (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(httpError(413, "too_large", "Request too large"))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {})
      } catch {
        reject(httpError(400, "invalid_json", "Invalid JSON"))
      }
    })
    request.on("error", reject)
  })
}

function sendError(response, status, code, message) {
  sendJson(response, status, { code, error: message })
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  })
  response.end(body)
}

function sendText(response, status, text) {
  response.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  })
  response.end(text)
}

/**
 * UI web locale, senza dipendenze. Nasce per l'uso futuro via Tailscale:
 * in locale resta su 127.0.0.1 e non espone nulla su internet.
 */
export class WebTransport {
  constructor({ bridge, config, saveConfig, logger = console, fetchImpl = globalThis.fetch }) {
    this.bridge = bridge
    this.config = config
    this.save = saveConfig
    this.log = logger
    this.fetchImpl = fetchImpl

    this.server = null
    this.clients = new Set()
    this.entries = []
    this.seq = 0
    this.startedAt = Date.now()
    this.updateCache = null

    this.permissions = new Map()
    this.permissionEntries = new Map()
    this.forms = new Map()
    this.formEntries = new Map()

    this.assets = new Map()
    this.token = ""

    this.bindBridge()
  }

  async start(signal) {
    this.signal = signal

    for (const [route, [file]] of Object.entries(ASSETS)) {
      this.assets.set(route, await readFile(join(PUBLIC_DIR, file)))
    }

    if (!this.config.web?.token) {
      this.config.web = {
        ...this.config.web,
        token: randomBytes(24).toString("base64url"),
      }
      await this.save(this.config)
    }
    this.token = this.config.web.token

    const host = this.config.web.host || "127.0.0.1"
    const configuredPort = Number(this.config.web.port)
    const port =
      Number.isInteger(configuredPort) && configuredPort >= 0 ? configuredPort : 8787

    this.server = createServer((request, response) => {
      this.handle(request, response).catch((error) => {
        this.log.warn(`[web] ${errorMessage(error)}`)
        if (!response.headersSent) {
          sendError(
            response,
            Number(error?.status) || 500,
            error?.code || "internal",
            error?.code ? error.message : "Internal error",
          )
        } else response.end()
      })
    })

    await new Promise((resolve, reject) => {
      const onError = (error) => reject(error)
      this.server.once("error", onError)
      this.server.listen(port, host, () => {
        this.server.off("error", onError)
        resolve()
      })
    })

    const displayHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host
    this.log.log(
      `[web] attiva su http://${displayHost}:${port}/?token=${this.token}`,
    )
    if (host === "0.0.0.0" || host === "::") {
      this.log.warn("[web] in ascolto su tutte le interfacce: usala solo dietro Tailscale/firewall.")
    }

    signal?.addEventListener(
      "abort",
      () => {
        void this.stop()
      },
      { once: true },
    )
  }

  bindBridge() {
    this.bridge.on("sent", ({ sessionID, text, files }) => {
      this.push({ kind: "user", sessionID, text, files })
    })
    this.bridge.on("text", ({ sessionID, text }) => {
      this.push({ kind: "assistant", sessionID, text })
    })
    this.bridge.on("permission", (request) => {
      this.addPermission(request)
    })
    this.bridge.on("permission:resolved", ({ request, decision }) => {
      this.resolvePermission(request, decision)
    })
    this.bridge.on("form", (form) => {
      this.addForm(form)
    })
    this.bridge.on("form:resolved", ({ form, cancelled }) => {
      this.resolveForm(form, cancelled)
    })
    this.bridge.on("error", ({ sessionID, message }) => {
      this.push({ kind: "error", sessionID, text: this.withPrefix(sessionID, message) })
    })
    this.bridge.on("tool:failed", ({ sessionID, tool, message }) => {
      this.push({
        kind: "notice",
        sessionID,
        text: this.withPrefix(sessionID, `Tool ${tool}: ${message}`),
      })
    })
    this.bridge.on("busy", () => this.broadcastState())
    this.bridge.on("active", () => this.broadcastState())
    this.bridge.on("sessions", () => this.broadcastState())
    this.bridge.on("server", () => this.broadcastState())
  }

  withPrefix(sessionID, text) {
    if (sessionID === this.config.sessionID) return text
    return `[${this.bridge.sessionTitle(sessionID)}] ${text}`
  }

  push(entry) {
    const value = {
      id: `e${++this.seq}`,
      time: Date.now(),
      ...entry,
    }
    this.entries.push(value)
    if (this.entries.length > 100) this.entries.splice(0, this.entries.length - 100)
    this.broadcast({ type: "entry", entry: value })
    return value
  }

  redactValue(value) {
    const text = String(value ?? "")
    if (this.config.redact === false) return text
    return redactText(text, { maxChars: 5000 })
  }

  addPermission(request) {
    const key = String(++this.seq)
    this.permissions.set(key, request)

    const sessionTitle = this.redactValue(
      this.bridge.sessionTitle(request.sessionID),
    ).slice(0, 200)
    const action = this.redactValue(request.action).slice(0, 200)
    const resources = (request.resources ?? [])
      .slice(0, 4)
      .map((item) => this.redactValue(item).slice(0, 300))
    const reason = request.message
      ? this.redactValue(request.message).slice(0, 600)
      : ""

    const lines = [`Session: ${sessionTitle}`, `Action: ${action}`]
    if (resources.length) lines.push(`Resource: ${resources.join(", ")}`)
    if (reason) lines.push(`Reason: ${reason}`)

    const entry = this.push({
      kind: "permission",
      key,
      requestID: request.id,
      sessionTitle,
      action,
      resources,
      reason,
      text: lines.join("\n"),
      resolved: false,
    })
    this.permissionEntries.set(request.id, entry)
  }

  resolvePermission(request, decision) {
    const entry = this.permissionEntries.get(request.id)
    if (!entry) return
    this.permissionEntries.delete(request.id)
    for (const [key, value] of this.permissions) {
      if (value.id === request.id) this.permissions.delete(key)
    }
    entry.resolved = true
    entry.resultCode = decision
    entry.result = DECISION_LABEL[decision] ?? `Resolved (${decision})`
    this.broadcast({ type: "entry", entry })
  }

  addForm(form) {
    const key = String(++this.seq)
    this.forms.set(key, form)
    const entry = this.push({
      kind: "form",
      key,
      form,
      text: `Form waiting: ${form.title}`,
      resolved: false,
    })
    this.formEntries.set(form.id, entry)
  }

  resolveForm(form, cancelled) {
    const entry = this.formEntries.get(form.id)
    if (!entry) return
    this.formEntries.delete(form.id)
    for (const [key, value] of this.forms) {
      if (value.id === form.id) this.forms.delete(key)
    }
    entry.resolved = true
    entry.resultCode = cancelled ? "cancelled" : "sent"
    entry.result = cancelled ? "❌ Form cancelled" : "✅ Form submitted"
    this.broadcast({ type: "entry", entry })
  }

  async latestRelease() {
    const now = Date.now()
    if (this.updateCache && now - this.updateCache.time < 10 * 60 * 1000) {
      return this.updateCache.value
    }
    const value = await fetchLatestRelease(GITHUB_REPO, { fetchImpl: this.fetchImpl })
    this.updateCache = { time: now, value }
    return value
  }

  state() {
    const active = this.bridge.activeSession()
    const list = [...this.bridge.sessions.values()]
      .sort((left, right) => (right.time?.updated ?? 0) - (left.time?.updated ?? 0))
      .slice(0, 20)
      .map((session) => ({ id: session.id, title: session.title || "(untitled)" }))

    if (active && !list.some((session) => session.id === active.id)) {
      list.unshift({ id: active.id, title: active.title || "(untitled)" })
    }

    return {
      active: active ? { id: active.id, title: active.title || "(untitled)" } : null,
      busy: this.bridge.isBusy(),
      sessions: list,
      version: PACKAGE_VERSION,
      repo: GITHUB_REPO,
      repoUrl: REPO_URL,
    }
  }

  broadcastState() {
    this.broadcast({ type: "state", state: this.state() })
  }

  broadcast(payload) {
    const data = `data: ${JSON.stringify(payload)}\n\n`
    for (const client of this.clients) {
      try {
        client.write(data)
      } catch {
        this.clients.delete(client)
      }
    }
  }

  tokenFrom(request, url) {
    const header = String(request.headers.authorization ?? "")
    if (header.startsWith("Bearer ")) return header.slice(7)
    const query = url.searchParams.get("token")
    if (query) return query
    return parseCookies(request.headers.cookie).ocb ?? ""
  }

  isAuthenticated(request, url) {
    return safeEqual(this.tokenFrom(request, url), this.token)
  }

  async handle(request, response) {
    const url = new URL(request.url ?? "/", "http://localhost")

    if (url.pathname === "/healthz") {
      sendJson(response, 200, { ok: true })
      return
    }

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/chat") && url.searchParams.has("token")) {
      if (!safeEqual(url.searchParams.get("token") ?? "", this.token)) {
        sendText(response, 401, languageFrom(request) === "it" ? "Token non valido" : "Invalid token")
        return
      }
      const sessionParam = url.searchParams.get("session")
      const target = sessionParam ? `/chat?session=${encodeURIComponent(sessionParam)}` : "/"
      response.writeHead(302, {
        location: target,
        "set-cookie": `ocb=${encodeURIComponent(this.token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`,
        "cache-control": "no-store",
      })
      response.end()
      return
    }

    if (request.method === "GET" && PUBLIC_ASSETS.has(url.pathname)) {
      this.serveAsset(response, url.pathname)
      return
    }

    if (!this.isAuthenticated(request, url)) {
      sendText(
        response,
        401,
        languageFrom(request) === "it"
          ? "Accesso negato. Apri il link completo con ?token=... (il token è nella configurazione del bridge)."
          : "Access denied. Open the full link with ?token=... (the token is in the bridge configuration).",
      )
      return
    }

    if (request.method === "GET" && ASSETS[url.pathname]) {
      this.serveAsset(response, url.pathname)
      return
    }

    if (request.method === "GET" && url.pathname === "/events") {
      this.serveEvents(request, response)
      return
    }

    if (request.method === "GET" && url.pathname === "/api/state") {
      sendJson(response, 200, this.state())
      return
    }

    if (request.method === "GET" && url.pathname === "/api/update") {
      if (!GITHUB_REPO) {
        sendError(response, 503, "update_check_failed", "Update repository not configured")
        return
      }
      try {
        const release = await this.latestRelease()
        sendJson(response, 200, {
          current: PACKAGE_VERSION,
          latest: release.tag,
          newer: isNewer(release.tag, PACKAGE_VERSION),
          url: release.url,
        })
      } catch (error) {
        this.log.warn(`[web] update check: ${errorMessage(error)}`)
        sendError(response, 502, "update_check_failed", "Could not check for updates")
      }
      return
    }

    if (request.method === "GET" && url.pathname === "/api/history") {
      const sessionID = url.searchParams.get("session") || ""
      if (!sessionID) {
        sendError(response, 400, "missing_session", "Session missing")
        return
      }
      try {
        const result = await this.bridge.api.messages(sessionID, { limit: 100, order: "desc" })
        const data = Array.isArray(result?.data) ? result.data.slice().reverse() : []
        const messages = []
        for (const message of data) {
          const time = Number(message.time?.created ?? 0)

          if (message.type === "user") {
            const text = String(message.text ?? "").trim()
            const files = Array.isArray(message.files)
              ? message.files.map((file) => {
                  const rawName = String(file?.name ?? "file")
                  const name = rawName.split(/[\\/]/).pop() || "file"
                  const preview =
                    typeof file?.data === "string" &&
                    file?.mime?.startsWith("image/") &&
                    file.data.length <= 2_500_000
                      ? `data:${file.mime};base64,${file.data}`
                      : null
                  return { name, ...(preview ? { preview } : {}) }
                })
              : []
            if (text || files.length) {
              messages.push({
                id: `h-${message.id}`,
                kind: "user",
                sessionID,
                text,
                files,
                time,
              })
            }
            continue
          }

          if (message.type === "assistant") {
            const text = (message.content ?? [])
              .filter((part) => part?.type === "text" && typeof part.text === "string")
              .map((part) => part.text)
              .join("\n\n")
              .trim()
            if (text) {
              messages.push({
                id: `h-${message.id}`,
                kind: "assistant",
                sessionID,
                text,
                time,
              })
            }
          }
        }
        sendJson(response, 200, { messages })
        if (typeof this.bridge.markViewed === "function") {
          void this.bridge.markViewed(sessionID).catch(() => {})
        }
      } catch (error) {
        sendError(response, 500, "history_failed", errorMessage(error))
      }
      return
    }

    if (request.method === "POST") {
      if (!String(request.headers["content-type"] ?? "").includes("application/json")) {
        sendError(response, 415, "content_type_required", "application/json content type required")
        return
      }

      if (url.pathname === "/api/view") {
        const body = await readJson(request, 4096)
        const sessionID = String(body.session ?? "")
        if (!sessionID) {
          sendError(response, 400, "missing_session", "Session missing")
          return
        }
        if (typeof this.bridge.markViewed === "function") {
          await this.bridge.markViewed(sessionID)
        }
        sendJson(response, 200, { ok: true })
        return
      }

      if (url.pathname === "/api/prompt") {
        const body = await readJson(request, 30 * 1024 * 1024)
        const sessionID = String(body.session ?? "").trim()
        if (this.bridge.isBusy(sessionID || undefined) && this.config.rejectWhenBusy !== false) {
          sendError(response, 409, "busy", "OpenCode is working: wait for the turn to finish.")
          return
        }

        const text = String(body.text ?? "").trim()
        const files = Array.isArray(body.files) ? body.files.slice(0, 5) : []

        if (!text && files.length === 0) {
          sendError(response, 400, "empty_message", "Empty message")
          return
        }
        if (text.length > 20_000) {
          sendError(response, 400, "message_too_long", "Message too long")
          return
        }

        for (const file of files) {
          if (!file || typeof file.uri !== "string" || !file.uri.startsWith("data:")) {
            sendError(response, 400, "invalid_attachment", "Invalid attachment")
            return
          }
          if (file.uri.length > 28 * 1024 * 1024) {
            sendError(response, 400, "attachment_too_large", "Attachment too large")
            return
          }
          if (file.name && String(file.name).length > 200) {
            sendError(response, 400, "attachment_name_too_long", "Attachment name too long")
            return
          }
        }

        const normalized = files.map((file, index) => {
          const preview =
            typeof file.preview === "string" &&
            file.preview.startsWith("data:image/") &&
            file.preview.length <= 200_000
              ? file.preview
              : null
          return {
            uri: file.uri,
            name: file.name ? String(file.name).slice(0, 200) : `file-${index + 1}`,
            ...(file.description ? { description: String(file.description).slice(0, 500) } : {}),
            ...(preview ? { preview } : {}),
          }
        })

        try {
          if (sessionID && sessionID !== this.config.sessionID) {
            await this.bridge.setActive(sessionID)
          }
          await this.bridge.sendPrompt(text, {
            files: normalized,
            ...(sessionID ? { sessionID } : {}),
          })
          sendJson(response, 200, { ok: true })
        } catch (error) {
          sendError(response, 400, "prompt_failed", errorMessage(error))
        }
        return
      }

      if (url.pathname === "/api/permission") {
        const body = await readJson(request)
        const requestValue = this.permissions.get(String(body.key ?? ""))
        const decision = String(body.decision ?? "")
        if (!requestValue) {
          sendError(response, 404, "permission_invalid", "Request is no longer valid")
          return
        }
        if (!["once", "always", "reject"].includes(decision)) {
          sendError(response, 400, "decision_invalid", "Invalid decision")
          return
        }
        try {
          await this.bridge.replyPermission(requestValue, decision)
          sendJson(response, 200, { ok: true })
        } catch (error) {
          sendError(response, 400, "permission_failed", errorMessage(error))
        }
        return
      }

      if (url.pathname === "/api/form") {
        const body = await readJson(request)
        const form = this.forms.get(String(body.key ?? ""))
        const answer = body.answer
        if (!form) {
          sendError(response, 404, "form_invalid", "Form is no longer valid")
          return
        }
        if (!answer || typeof answer !== "object" || Array.isArray(answer)) {
          sendError(response, 400, "answer_invalid", "Invalid answer")
          return
        }
        try {
          await this.bridge.replyForm(form, answer)
          sendJson(response, 200, { ok: true })
        } catch (error) {
          sendError(response, 400, "form_failed", errorMessage(error))
        }
        return
      }

      if (url.pathname === "/api/session") {
        const body = await readJson(request)
        const id = String(body.id ?? "")
        if (!id) {
          sendError(response, 400, "missing_session", "Session missing")
          return
        }
        try {
          await this.bridge.setActive(id)
          sendJson(response, 200, { ok: true, state: this.state() })
        } catch (error) {
          sendError(response, 400, "session_unavailable", errorMessage(error))
        }
        return
      }
    }

    sendError(response, 404, "not_found", "Not found")
  }

  serveAsset(response, path) {
    const [file, type] = ASSETS[path]
    const body = this.assets.get(path) ?? Buffer.alloc(0)
    response.writeHead(200, {
      "content-type": type,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "x-frame-options": "DENY",
      ...(file.endsWith(".html") ? { "content-security-policy": CSP } : {}),
    })
    response.end(body)
  }

  serveEvents(request, response) {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    })

    response.write(
      `data: ${JSON.stringify({ type: "init", entries: this.entries, state: this.state() })}\n\n`,
    )
    this.clients.add(response)

    const heartbeat = setInterval(() => {
      try {
        response.write(": heartbeat\n\n")
      } catch {
        clearInterval(heartbeat)
      }
    }, 20_000)
    heartbeat.unref?.()

    request.on("close", () => {
      clearInterval(heartbeat)
      this.clients.delete(response)
    })
  }

  async stop() {
    for (const client of this.clients) {
      try {
        client.end()
      } catch {
        // ignorato
      }
    }
    this.clients.clear()
    if (this.server) {
      await new Promise((resolve) => this.server.close(resolve))
      this.server = null
    }
  }
}
