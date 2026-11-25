import { Service } from "@opencode/client/service"

import { parseSse } from "./sse.mjs"

export class OpenCodeError extends Error {
  constructor(message, status = 0) {
    super(message)
    this.name = "OpenCodeError"
    this.status = status
  }
}

export class OpenCodeApi {
  constructor(endpoint) {
    this.endpoint = endpoint
    this.headers = Service.headers(endpoint) ?? {}
  }

  static async connect(options = {}) {
    const startIfMissing = options.startIfMissing ?? true
    let endpoint = await Service.discover()
    if (!endpoint && startIfMissing) {
      endpoint = await Service.ensure({
        onStart: (reason) => {
          console.log(`[opencode] avvio del servizio in background (${reason})`)
        },
      })
    }
    if (!endpoint) {
      throw new OpenCodeError(
        "Servizio OpenCode non trovato. Apri OpenCode Desktop oppure esegui: opencode serve --service",
      )
    }
    return new OpenCodeApi(endpoint)
  }

  get url() {
    return this.endpoint.url
  }

  async request(method, path, payload) {
    let response
    try {
      response = await fetch(`${this.url}${path}`, {
        method,
        headers: {
          ...this.headers,
          ...(payload === undefined ? {} : { "content-type": "application/json" }),
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      })
    } catch (error) {
      const cause = error?.cause?.code ? ` (${error.cause.code})` : ""
      throw new OpenCodeError(`rete non raggiungibile${cause}`)
    }

    const text = await response.text()
    let body = null
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = text
      }
    }

    if (!response.ok) {
      const detail =
        (typeof body === "object" && body && (body.message || body.error?.message || body.error)) ||
        (typeof body === "string" ? body.slice(0, 300) : "") ||
        response.statusText
      throw new OpenCodeError(
        `OpenCode ${method} ${path}: ${response.status} ${String(detail).slice(0, 300)}`,
        response.status,
      )
    }

    return body
  }

  info() {
    return this.request("GET", "/api/info")
  }

  listSessions(limit = 20) {
    return this.request("GET", `/api/session?limit=${encodeURIComponent(limit)}`)
  }

  getSession(sessionID) {
    return this.request("GET", `/api/session/${encodeURIComponent(sessionID)}`)
  }

  viewSession(sessionID, idle) {
    return this.request("POST", `/api/session/${encodeURIComponent(sessionID)}/view`, {
      idle: Number(idle) || 0,
    })
  }

  createSession({ directory, title }) {
    return this.request("POST", "/api/session", {
      location: { directory },
      ...(title ? { title } : {}),
    })
  }

  prompt(sessionID, text, files) {
    const attachments = Array.isArray(files)
      ? files.map((file) => ({
          uri: file.uri,
          ...(file.name ? { name: file.name } : {}),
          ...(file.description ? { description: file.description } : {}),
        }))
      : undefined

    return this.request("POST", `/api/session/${encodeURIComponent(sessionID)}/prompt`, {
      text,
      ...(attachments?.length ? { files: attachments } : {}),
    })
  }

  messages(sessionID, options = {}) {
    const limit = options.limit ?? 100
    const order = options.order ?? "desc"
    const params = new URLSearchParams({ limit: String(limit), order })
    return this.request(
      "GET",
      `/api/session/${encodeURIComponent(sessionID)}/message?${params.toString()}`,
    )
  }

  interrupt(sessionID) {
    return this.request("POST", `/api/session/${encodeURIComponent(sessionID)}/interrupt`)
  }

  sessionPermissions(sessionID) {
    return this.request("GET", `/api/session/${encodeURIComponent(sessionID)}/permission`)
  }

  replyPermission(sessionID, requestID, decision) {
    return this.request(
      "POST",
      `/api/session/${encodeURIComponent(sessionID)}/permission/${encodeURIComponent(requestID)}/reply`,
      { decision },
    )
  }

  sessionForms(sessionID) {
    return this.request("GET", `/api/session/${encodeURIComponent(sessionID)}/form`)
  }

  replyForm(sessionID, formID, answer) {
    return this.request(
      "POST",
      `/api/session/${encodeURIComponent(sessionID)}/form/${encodeURIComponent(formID)}/reply`,
      { answer },
    )
  }

  async *events(signal) {
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    if (signal) {
      if (signal.aborted) controller.abort()
      else signal.addEventListener("abort", onAbort, { once: true })
    }

    const timer = setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await fetch(`${this.url}/api/event`, {
        headers: this.headers,
        signal: controller.signal,
      })
      clearTimeout(timer)

      if (!response.ok || !response.body) {
        throw new OpenCodeError(`stream eventi: HTTP ${response.status}`, response.status)
      }

      yield* parseSse(response.body)
    } catch (error) {
      if (controller.signal.aborted && signal?.aborted) return
      if (error?.name === "AbortError") {
        throw new OpenCodeError("timeout durante la connessione agli eventi")
      }
      throw error
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
    }
  }
}
