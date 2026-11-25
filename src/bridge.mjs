import { EventEmitter } from "node:events"

import { errorMessage, sleep } from "./util.mjs"

function structuredError(error) {
  if (!error) return "errore sconosciuto"
  if (typeof error === "string") return error
  if (typeof error.message === "string" && error.message) return error.message
  if (typeof error.type === "string" && error.type) return error.type
  try {
    return JSON.stringify(error).slice(0, 300)
  } catch {
    return "errore sconosciuto"
  }
}

/**
 * Nucleo indipendente dal trasporto: parla con OpenCode e pubblica eventi
 * che Telegram e la UI web consumano.
 */
export class Bridge extends EventEmitter {
  constructor({ api, config, saveConfig }) {
    super()
    this.api = api
    this.config = config
    this.saveConfig = saveConfig
    this.sessions = new Map()
    this.busy = new Set()
    this.turns = new Map()
    this.expected = new Set()
    this.permissions = new Map()
    this.forms = new Map()
    this.serverInfo = null
    this.connected = false
    this.running = new Set()
    this.lastFinish = new Map()
  }

  async init() {
    this.serverInfo = await this.api.info()
    this.emit("server", this.serverInfo)

    await this.refreshSessions()

    if (this.config.sessionID) {
      try {
        const result = await this.api.getSession(this.config.sessionID)
        this.sessions.set(this.config.sessionID, result?.data ?? result)
      } catch {
        this.config.sessionID = ""
        await this.saveConfig(this.config)
      }
    }

    if (!this.config.sessionID) {
      const latest = [...this.sessions.values()].sort(
        (a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0),
      )[0]
      if (latest) {
        this.config.sessionID = latest.id
        await this.saveConfig(this.config)
      }
    }

    await this.refreshPending()
    this.emit("active", this.activeSession())
  }

  activeSession() {
    const id = this.config.sessionID
    if (!id) return null
    return this.sessions.get(id) ?? { id, title: "" }
  }

  sessionTitle(sessionID) {
    return this.sessions.get(sessionID)?.title || sessionID
  }

  isBusy(sessionID = this.config.sessionID) {
    return this.busy.has(sessionID)
  }

  shouldCollect(sessionID) {
    if (this.expected.has(sessionID)) return true
    return this.config.mirrorActive !== false && sessionID === this.config.sessionID
  }

  async refreshSessions(limit = 20) {
    const result = await this.api.listSessions(limit)
    const list = Array.isArray(result?.data) ? result.data : []
    for (const session of list) this.sessions.set(session.id, session)
    return list
  }

  async setActive(sessionID) {
    const result = await this.api.getSession(sessionID)
    const session = result?.data ?? result
    this.config.sessionID = session.id
    this.sessions.set(session.id, session)
    await this.saveConfig(this.config)

    const idle = Number(session.time?.idle ?? 0)
    if (idle > 0) {
      try {
        await this.api.viewSession(session.id, idle)
      } catch {
        // marcare come letto è un extra
      }
    }

    this.emit("active", session)
    await this.refreshPending()
    return session
  }

  async markViewed(sessionID) {
    try {
      const result = await this.api.getSession(sessionID)
      const session = result?.data ?? result
      const idle = Number(session.time?.idle ?? 0)
      if (idle > 0) await this.api.viewSession(sessionID, idle)
    } catch {
      // best effort
    }
    this.emit("viewed", { sessionID })
  }

  async createSession(title) {
    const directory = this.config.location
    if (!directory) throw new Error("Cartella di lavoro non configurata. Rilancia npm run setup.")
    const result = await this.api.createSession({ directory, title })
    const session = result?.data ?? result
    this.sessions.set(session.id, session)
    this.config.sessionID = session.id
    await this.saveConfig(this.config)
    this.emit("active", session)
    return session
  }

  async refreshPending() {
    const sessionID = this.config.sessionID
    if (!sessionID) return

    try {
      const result = await this.api.sessionPermissions(sessionID)
      for (const request of result?.data ?? []) this.emitPermission(request)
    } catch (error) {
      this.emit("warn", `permessi pendenti: ${errorMessage(error)}`)
    }

    try {
      const result = await this.api.sessionForms(sessionID)
      for (const form of result?.data ?? []) this.emitForm(form)
    } catch (error) {
      this.emit("warn", `form pendenti: ${errorMessage(error)}`)
    }
  }

  async sendPrompt(text, options = {}) {
    const sessionID = options.sessionID ?? this.config.sessionID
    if (!sessionID) throw new Error("Nessuna sessione attiva. Usa /new oppure /use.")
    const files = Array.isArray(options.files) ? options.files : undefined
    let clean = String(text ?? "").trim()
    if (!clean && !files?.length) throw new Error("Messaggio vuoto.")
    if (!clean) clean = "Allego un file."

    this.expected.add(sessionID)
    this.turns.delete(sessionID)
    try {
      const result = await this.api.prompt(sessionID, clean, files)
      this.emit("sent", {
        sessionID,
        text: clean,
        files: files?.map((file) => ({
          name: file.name,
          ...(file.preview ? { preview: file.preview } : {}),
        })),
      })
      return result
    } catch (error) {
      this.expected.delete(sessionID)
      throw error
    }
  }

  async interrupt() {
    const sessionID = this.config.sessionID
    if (!sessionID) throw new Error("Nessuna sessione attiva.")
    this.expected.delete(sessionID)
    this.turns.delete(sessionID)
    return this.api.interrupt(sessionID)
  }

  async replyPermission(request, decision) {
    const target = typeof request === "string" ? this.permissions.get(request) : request
    if (!target) throw new Error("Richiesta di permesso non più valida.")
    await this.api.replyPermission(target.sessionID, target.id, decision)
    if (this.permissions.delete(target.id)) {
      this.emit("permission:resolved", { request: target, decision })
    }
  }

  async replyForm(form, answer) {
    const target = typeof form === "string" ? this.forms.get(form) : form
    if (!target) throw new Error("Form non più valido.")
    await this.api.replyForm(target.sessionID, target.id, answer)
    if (this.forms.delete(target.id)) {
      this.emit("form:resolved", { form: target, answer, cancelled: false })
    }
  }

  emitPermission(request) {
    if (!request?.id || !request?.sessionID) return
    if (this.permissions.has(request.id)) return
    this.permissions.set(request.id, request)
    this.emit("permission", request)
  }

  emitForm(form) {
    if (!form?.id || !form?.sessionID) return
    if (this.forms.has(form.id)) return
    this.forms.set(form.id, form)
    this.emit("form", form)
  }

  addSegment(sessionID, messageID, ordinal, text) {
    let turn = this.turns.get(sessionID)
    if (!turn) {
      turn = new Map()
      this.turns.set(sessionID, turn)
    }
    let segments = turn.get(messageID)
    if (!segments) {
      segments = new Map()
      turn.set(messageID, segments)
    }
    segments.set(Number(ordinal) || 0, String(text ?? ""))
  }

  collectText(sessionID) {
    const turn = this.turns.get(sessionID)
    if (!turn) return ""
    const blocks = []
    for (const segments of turn.values()) {
      const text = [...segments.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([, value]) => value)
        .join("")
      if (text.trim()) blocks.push(text)
    }
    return blocks.join("\n\n")
  }

  async handleEvent(event) {
    const data = event.data ?? {}
    const sessionID = data.sessionID

    switch (event.type) {
      case "server.connected":
        this.connected = true
        this.emit("connected")
        break

      case "session.created": {
        if (!data.sessionID) break
        const known = this.sessions.get(data.sessionID)
        this.sessions.set(data.sessionID, {
          ...(known ?? {}),
          id: data.sessionID,
          ...(data.parentID ? { parentID: data.parentID } : {}),
          title: data.title ?? known?.title ?? "",
          ...(data.location ? { location: data.location } : {}),
          time: known?.time ?? { created: event.created, updated: event.created },
        })
        this.emit("sessions")
        break
      }

      case "session.renamed": {
        if (!data.sessionID) break
        const known = this.sessions.get(data.sessionID) ?? { id: data.sessionID }
        known.title = data.title ?? known.title ?? ""
        this.sessions.set(data.sessionID, known)
        this.emit("sessions")
        break
      }

      case "session.execution.started":
        if (!sessionID) break
        this.busy.add(sessionID)
        this.running.add(sessionID)
        this.emit("busy", { sessionID, busy: true })
        if (this.shouldCollect(sessionID)) this.turns.set(sessionID, new Map())
        break

      case "session.execution.succeeded":
      case "session.execution.failed":
      case "session.execution.interrupted":
        if (!sessionID) break
        this.busy.delete(sessionID)
        this.emit("busy", { sessionID, busy: false })
        if (event.type === "session.execution.succeeded") {
          this.running.delete(sessionID)
          this.lastFinish.set(sessionID, Date.now())
          this.emit("finished", { sessionID, status: "succeeded" })
        }
        if (event.type === "session.execution.failed") {
          this.expected.delete(sessionID)
          this.turns.delete(sessionID)
          this.running.delete(sessionID)
          this.lastFinish.set(sessionID, Date.now())
          const message = structuredError(data.error)
          this.emit("error", { sessionID, message })
          this.emit("finished", { sessionID, status: "failed", error: message })
        }
        if (event.type === "session.execution.interrupted") {
          this.expected.delete(sessionID)
          this.turns.delete(sessionID)
          this.running.delete(sessionID)
          this.lastFinish.set(sessionID, Date.now())
          this.emit("interrupted", { sessionID })
          this.emit("finished", { sessionID, status: "interrupted" })
        }
        break

      case "session.text.ended":
        if (!sessionID || !this.shouldCollect(sessionID)) break
        this.addSegment(sessionID, data.assistantMessageID ?? "unknown", data.ordinal, data.text)
        break

      case "session.idle": {
        if (!sessionID) break
        this.busy.delete(sessionID)
        const wasRunning = this.running.delete(sessionID)
        this.emit("busy", { sessionID, busy: false })
        const collect = this.shouldCollect(sessionID)
        const text = collect ? this.collectText(sessionID) : ""
        this.turns.delete(sessionID)
        this.expected.delete(sessionID)
        if (text.trim()) this.emit("text", { sessionID, text })

        const last = this.lastFinish.get(sessionID) ?? 0
        if (wasRunning || Date.now() - last > 30_000) {
          this.lastFinish.set(sessionID, Date.now())
          this.emit("finished", { sessionID, status: "succeeded" })
        }
        break
      }

      case "session.tool.failed":
        if (this.config.notifyToolFailures && sessionID) {
          this.emit("tool:failed", {
            sessionID,
            tool: data.id ?? "tool",
            message: structuredError(data.error),
          })
        }
        break

      case "permission.asked":
        this.emitPermission(data)
        break

      case "permission.replied": {
        const request = this.permissions.get(data.requestID)
        if (request && this.permissions.delete(data.requestID)) {
          this.emit("permission:resolved", { request, decision: data.reply })
        }
        break
      }

      case "form.created":
        this.emitForm(data.form)
        break

      case "form.replied":
      case "form.cancelled": {
        const form = this.forms.get(data.id)
        if (form && this.forms.delete(data.id)) {
          this.emit("form:resolved", {
            form,
            answer: data.answer ?? null,
            cancelled: event.type === "form.cancelled",
          })
        }
        break
      }

      default:
        break
    }
  }

  async loop(signal) {
    let backoff = 2000
    while (!signal?.aborted) {
      try {
        for await (const event of this.api.events(signal)) {
          backoff = 2000
          await this.handleEvent(event)
        }
      } catch (error) {
        if (signal?.aborted) break
        this.emit("warn", `eventi: ${errorMessage(error)}`)
      }

      if (signal?.aborted) break
      await sleep(backoff)
      backoff = Math.min(backoff * 2, 30_000)
      await this.refreshPending().catch(() => {})
    }
  }
}
