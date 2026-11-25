import test from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { createServer } from "node:http"

import { TelegramTransport } from "../src/transports/telegram.mjs"
import { TelegramApi } from "../src/telegram.mjs"

const TOKEN = "test-token"

class MockTelegramServer {
  constructor() {
    this.updates = []
    this.sent = []
    this.edits = []
    this.deleted = []
    this.callbacks = []
    this.messageID = 100
    this.server = createServer((request, response) => {
      const url = new URL(request.url, "http://localhost")
      const method = url.pathname.split("/").pop()
      let body = ""
      request.on("data", (chunk) => {
        body += chunk
      })
      request.on("end", () => {
        const payload = body ? JSON.parse(body) : {}
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ ok: true, result: this.handle(method, payload) }))
      })
    })
  }

  handle(method, payload) {
    if (method === "getMe") return { id: 1, username: "test_bot" }
    if (method === "getUpdates") {
      const updates = this.updates.splice(0, this.updates.length)
      return updates
    }
    if (method === "sendMessage") {
      const messageId = ++this.messageID
      this.sent.push({ ...payload, message_id: messageId })
      return { message_id: messageId, chat: { id: payload.chat_id }, text: payload.text }
    }
    if (method === "deleteMessage") {
      this.deleted.push(payload.message_id)
      return true
    }
    if (method === "editMessageText") {
      this.edits.push(payload)
      return true
    }
    if (method === "answerCallbackQuery") {
      this.callbacks.push(payload)
      return true
    }
    if (method === "sendChatAction") return true
    return true
  }

  push(update) {
    this.updates.push(update)
  }

  async start() {
    await new Promise((resolve) => this.server.listen(0, "127.0.0.1", resolve))
    return `http://127.0.0.1:${this.server.address().port}`
  }

  async stop() {
    await new Promise((resolve) => this.server.close(resolve))
  }
}

class MockBridge extends EventEmitter {
  constructor() {
    super()
    this.config = { sessionID: "ses_x" }
    this.permissions = new Map()
    this.forms = new Map()
    this.serverInfo = { version: "2.3.2" }
    this.prompts = []
    this.permissionReplies = []
    this.sessions = new Map([
      ["ses_x", { id: "ses_x", title: "Sessione test", time: { updated: 1 } }],
    ])
  }

  activeSession() {
    return this.sessions.get(this.config.sessionID) ?? null
  }

  sessionTitle(id) {
    return this.sessions.get(id)?.title ?? id
  }

  isBusy() {
    return false
  }

  async sendPrompt(text) {
    this.prompts.push(text)
  }

  async refreshSessions() {
    return [...this.sessions.values()]
  }

  async interrupt() {}

  async setActive(id) {
    this.config.sessionID = id
    this.emit("active", this.activeSession())
  }

  async createSession(title) {
    const session = { id: "ses_new", title, time: { updated: Date.now() } }
    this.sessions.set(session.id, session)
    return session
  }

  async replyPermission(request, decision) {
    this.permissionReplies.push({ request, decision })
    this.emit("permission:resolved", { request, decision })
  }

  async replyForm(form, answer) {
    this.emit("form:resolved", { form, answer, cancelled: false })
  }
}

async function waitFor(predicate, timeout = 3000) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error("timeout in attesa")
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

test("pairing, prompt e approvazione permesso via Telegram", async (t) => {
  const server = new MockTelegramServer()
  const baseUrl = await server.start()
  t.after(() => server.stop())

  const bridge = new MockBridge()
  const config = {
    token: TOKEN,
    allowedUsers: [],
    pairCode: "ABC123",
    pairCodeExpires: Date.now() + 60_000,
    telegramOffset: 0,
    sessionID: "ses_x",
    redact: true,
    maxChars: 3500,
    notifyToolFailures: true,
    telegramMode: "full",
    web: { enabled: false },
  }

  let saves = 0
  const transport = new TelegramTransport({
    api: new TelegramApi(TOKEN, { baseUrl }),
    bridge,
    config,
    saveConfig: async () => {
      saves++
    },
    logger: { log() {}, warn() {}, error() {} },
    presence: { isAtPc: async () => false },
  })

  const controller = new AbortController()
  await transport.start(controller.signal)
  t.after(() => {
    transport.stopped = true
    controller.abort()
  })

  server.push({
    update_id: 1,
    message: {
      message_id: 1,
      chat: { id: 42, type: "private" },
      from: { id: 7, first_name: "Test User" },
      text: "/pair abc123",
    },
  })

  await waitFor(() => config.allowedUsers.length === 1)
  assert.equal(config.allowedUsers[0].id, 7)
  assert.equal(config.allowedUsers[0].chatId, 42)
  assert.equal(config.pairCode, "")
  assert.ok(saves > 0)

  server.push({
    update_id: 2,
    message: {
      message_id: 2,
      chat: { id: 42, type: "private" },
      from: { id: 7, first_name: "Test User" },
      text: "ciao OpenCode",
    },
  })

  await waitFor(() => bridge.prompts.length === 1)
  assert.equal(bridge.prompts[0], "ciao OpenCode")

  bridge.emit("permission", {
    id: "per_1",
    sessionID: "ses_x",
    action: "bash",
    resources: ["echo ciao"],
  })

  await waitFor(() => server.sent.some((message) => message.reply_markup))
  const permissionMessage = server.sent.find((message) => message.reply_markup)
  assert.match(permissionMessage.text, /Permesso richiesto/)
  const callbackData = permissionMessage.reply_markup.inline_keyboard[0][0].callback_data
  assert.match(callbackData, /^p:\d+:o$/)

  server.push({
    update_id: 3,
    callback_query: {
      id: "cb_1",
      from: { id: 7 },
      message: { chat: { id: 42, type: "private" } },
      data: callbackData,
    },
  })

  await waitFor(() => bridge.permissionReplies.length === 1)
  assert.equal(bridge.permissionReplies[0].decision, "once")
  await waitFor(() => server.callbacks.length > 0)
})

test("solo notifiche: nessun prompt, avviso a fine sessione e permessi senza pulsanti", async (t) => {
  const server = new MockTelegramServer()
  const baseUrl = await server.start()
  t.after(() => server.stop())

  const bridge = new MockBridge()
  const config = {
    token: TOKEN,
    allowedUsers: [{ id: 7, chatId: 42, name: "Test" }],
    pairCode: "",
    pairCodeExpires: 0,
    telegramOffset: 0,
    sessionID: "ses_x",
    redact: true,
    maxChars: 3500,
    notifyToolFailures: true,
    telegramMode: "notify",
    notifyAllSessions: true,
    web: { enabled: true, publicUrl: "https://pc.example.ts.net" },
  }

  const transport = new TelegramTransport({
    api: new TelegramApi(TOKEN, { baseUrl }),
    bridge,
    config,
    saveConfig: async () => {},
    logger: { log() {}, warn() {}, error() {} },
    presence: { isAtPc: async () => false },
  })

  const controller = new AbortController()
  await transport.start(controller.signal)
  t.after(() => {
    transport.stopped = true
    controller.abort()
  })

  server.push({
    update_id: 1,
    message: {
      message_id: 1,
      chat: { id: 42, type: "private" },
      from: { id: 7, first_name: "Test" },
      text: "ciao",
    },
  })

  await waitFor(() => server.sent.some((message) => message.text.includes("solo notifiche")))
  assert.equal(bridge.prompts.length, 0)

  bridge.emit("finished", { sessionID: "ses_x", status: "succeeded" })
  await waitFor(() => server.sent.some((message) => message.text.includes("Sessione finita")))
  const finishedMessage = server.sent.find((message) => message.text.includes("Sessione finita"))
  assert.match(finishedMessage.text, /https:\/\/pc\.example\.ts\.net/)
  assert.match(finishedMessage.text, /session=ses_x/)

  bridge.emit("permission", {
    id: "per_1",
    sessionID: "ses_x",
    action: "shell",
    resources: ["git status"],
  })
  await waitFor(() => server.sent.some((message) => message.text.includes("Permesso in attesa")))
  const permissionMessage = server.sent.find((message) => message.text.includes("Permesso in attesa"))
  assert.equal(permissionMessage.reply_markup, undefined)

  bridge.emit("form", { id: "form_1", sessionID: "ses_x", title: "Scelta", fields: [] })
  await waitFor(() => server.sent.some((message) => message.text.includes("Form in attesa")))
})

test("comando /vpn on avvia Tailscale", async (t) => {
  const server = new MockTelegramServer()
  const baseUrl = await server.start()
  t.after(() => server.stop())

  const bridge = new MockBridge()
  const config = {
    token: TOKEN,
    allowedUsers: [{ id: 7, chatId: 42, name: "Test" }],
    pairCode: "",
    pairCodeExpires: 0,
    telegramOffset: 0,
    sessionID: "ses_x",
    redact: true,
    maxChars: 3500,
    notifyToolFailures: true,
    telegramMode: "notify",
    web: { enabled: false },
  }

  const calls = []
  const vpn = {
    status: async () => ({ installed: true, running: true, online: true, backend: "Running" }),
    ensure: async () => {
      calls.push("ensure")
      return {
        installed: true,
        running: true,
        online: true,
        backend: "Running",
        changed: true,
        steps: [],
        message: "Tailscale attivato",
      }
    },
  }

  const transport = new TelegramTransport({
    api: new TelegramApi(TOKEN, { baseUrl }),
    bridge,
    config,
    saveConfig: async () => {},
    logger: { log() {}, warn() {}, error() {} },
    presence: { isAtPc: async () => false },
    vpn,
  })

  const controller = new AbortController()
  await transport.start(controller.signal)
  t.after(() => {
    transport.stopped = true
    controller.abort()
  })

  server.push({
    update_id: 1,
    message: {
      message_id: 1,
      chat: { id: 42, type: "private" },
      from: { id: 7, first_name: "Test" },
      text: "/vpn on",
    },
  })

  await waitFor(() => server.sent.some((message) => message.text.includes("Tailscale connesso")))
  assert.deepEqual(calls, ["ensure"])
})

test("la notifica di fine sessione sostituisce quella precedente", async (t) => {
  const server = new MockTelegramServer()
  const baseUrl = await server.start()
  t.after(() => server.stop())

  const bridge = new MockBridge()
  const config = {
    token: TOKEN,
    allowedUsers: [{ id: 7, chatId: 42, name: "Test" }],
    pairCode: "",
    pairCodeExpires: 0,
    telegramOffset: 0,
    sessionID: "ses_x",
    redact: true,
    maxChars: 3500,
    notifyToolFailures: true,
    telegramMode: "notify",
    notifyAllSessions: true,
    notificationMessages: {},
    web: { enabled: true, publicUrl: "https://pc.example.ts.net" },
  }

  const transport = new TelegramTransport({
    api: new TelegramApi(TOKEN, { baseUrl }),
    bridge,
    config,
    saveConfig: async () => {},
    logger: { log() {}, warn() {}, error() {} },
    presence: { isAtPc: async () => false },
  })

  const controller = new AbortController()
  await transport.start(controller.signal)
  t.after(() => {
    transport.stopped = true
    controller.abort()
  })

  bridge.emit("finished", { sessionID: "ses_x", status: "succeeded" })
  await waitFor(() => server.sent.some((message) => message.text.includes("Sessione finita")))
  await waitFor(() => Object.keys(config.notificationMessages).length === 1)

  const first = server.sent.find((message) => message.text.includes("Sessione finita"))
  assert.ok(first.message_id)

  bridge.emit("finished", { sessionID: "ses_x", status: "succeeded" })
  await waitFor(() => server.deleted.includes(first.message_id))
  assert.equal(server.deleted.filter((id) => id === first.message_id).length, 1)

  const second = [...server.sent].reverse().find((message) => message.text.includes("Sessione finita"))
  assert.ok(second.message_id)

  bridge.emit("viewed", { sessionID: "ses_x", idle: Date.now() })
  await waitFor(() => server.deleted.includes(second.message_id))
  await waitFor(() => Object.keys(config.notificationMessages).length === 0)

  const before = server.sent.filter((message) => message.text.includes("Sessione finita")).length
  bridge.emit("finished", { sessionID: "ses_x", status: "succeeded" })
  await new Promise((resolve) => setTimeout(resolve, 250))
  assert.equal(
    server.sent.filter((message) => message.text.includes("Sessione finita")).length,
    before,
  )
})

test("se il PC è in uso non manda la notifica di fine sessione", async (t) => {
  const server = new MockTelegramServer()
  const baseUrl = await server.start()
  t.after(() => server.stop())

  const bridge = new MockBridge()
  const config = {
    token: TOKEN,
    allowedUsers: [{ id: 7, chatId: 42, name: "Test" }],
    pairCode: "",
    pairCodeExpires: 0,
    telegramOffset: 0,
    sessionID: "ses_x",
    redact: true,
    maxChars: 3500,
    notifyToolFailures: true,
    telegramMode: "notify",
    notifyAllSessions: true,
    notificationMessages: {},
    suppressAtPc: true,
    web: { enabled: false },
  }

  const transport = new TelegramTransport({
    api: new TelegramApi(TOKEN, { baseUrl }),
    bridge,
    config,
    saveConfig: async () => {},
    logger: { log() {}, warn() {}, error() {} },
    presence: { isAtPc: async () => true },
  })

  const controller = new AbortController()
  await transport.start(controller.signal)
  t.after(() => {
    transport.stopped = true
    controller.abort()
  })

  bridge.emit("finished", { sessionID: "ses_x", status: "succeeded" })
  await new Promise((resolve) => setTimeout(resolve, 300))

  assert.equal(
    server.sent.filter((message) => message.text.includes("Sessione finita")).length,
    0,
  )
})
