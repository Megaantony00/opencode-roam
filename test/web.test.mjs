import test from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { readFile } from "node:fs/promises"

import { WebTransport } from "../src/transports/web.mjs"

const TOKEN = "test-token-web"

class MockBridge extends EventEmitter {
  constructor() {
    super()
    this.sessions = new Map([
      ["ses_test", { id: "ses_test", title: "Sessione test", time: { updated: 1 } }],
    ])
    this.config = { sessionID: "ses_test" }
    this.sent = []
    this.lastFiles = null
    this.formReplies = []
    this.permissionReplies = []
    this.viewed = []
    this.api = {
      messages: async () => ({
        data: [
          {
            id: "msg_2",
            type: "assistant",
            time: { created: 2 },
            content: [{ type: "text", text: "Risposta storica" }],
          },
          {
            id: "msg_1",
            type: "user",
            time: { created: 1 },
            text: "Domanda storica",
          },
        ],
      }),
    }
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

  async sendPrompt(text, options = {}) {
    this.sent.push(text)
    this.lastFiles = options.files ?? null
    this.emit("sent", {
      sessionID: this.config.sessionID,
      text,
      files: options.files?.map((file) => file.name),
    })
  }

  async setActive(id) {
    this.config.sessionID = id
    this.emit("active", this.activeSession())
  }

  async replyPermission(request, decision) {
    this.permissionReplies.push({ request, decision })
  }

  async replyForm(form, answer) {
    this.formReplies.push({ form, answer })
  }

  async markViewed(sessionID) {
    this.viewed.push(sessionID)
  }
}

async function startWeb(t) {
  const bridge = new MockBridge()
  const config = {
    sessionID: "ses_test",
    redact: true,
    web: { enabled: true, host: "127.0.0.1", port: 0, token: TOKEN },
  }
  const web = new WebTransport({
    bridge,
    config,
    saveConfig: async () => {},
    logger: { log() {}, warn() {}, error() {} },
  })
  await web.start()
  t.after(() => web.stop())
  const { port } = web.server.address()
  return { bridge, web, base: `http://127.0.0.1:${port}` }
}

test("healthz è pubblico, il resto richiede il token", async (t) => {
  const { base } = await startWeb(t)

  assert.equal((await fetch(`${base}/healthz`)).status, 200)
  assert.equal((await fetch(`${base}/icon-192.png`)).status, 200)
  assert.equal((await fetch(`${base}/manifest.webmanifest`)).status, 200)
  assert.equal((await fetch(`${base}/sw.js`)).status, 200)
  assert.equal((await fetch(`${base}/`)).status, 200)
  assert.equal((await fetch(`${base}/pwa-check`)).status, 200)
  assert.equal((await fetch(`${base}/offline.html`)).status, 200)
  assert.equal((await fetch(`${base}/offline.css`)).status, 200)
  assert.equal((await fetch(`${base}/offline.js`)).status, 200)
  assert.equal((await fetch(`${base}/chat`)).status, 401)
  assert.equal((await fetch(`${base}/?token=sbagliato`)).status, 401)
})

test("la pagina offline è pubblica e apre Tailscale", async (t) => {
  const { base } = await startWeb(t)

  const html = await (await fetch(`${base}/offline.html`)).text()
  assert.match(html, /tailscale:\/\/navigate/)
  assert.doesNotMatch(html, /intent:\/\//)
  assert.match(html, /com\.tailscale\.ipn/)
  assert.match(html, /\/offline\.js/)

  const sw = await (await fetch(`${base}/sw.js`)).text()
  assert.match(sw, /offline\.html/)
  assert.match(sw, /mode === "navigate"/)
})

test("le icone PNG sono servite senza corruzione", async (t) => {
  const { base } = await startWeb(t)

  for (const name of ["icon-192.png", "icon-512.png", "icon-maskable-512.png"]) {
    const response = await fetch(`${base}/${name}`)
    assert.equal(response.headers.get("content-type"), "image/png")

    const body = Buffer.from(await response.arrayBuffer())
    const original = await readFile(new URL(`../src/web/${name}`, import.meta.url))
    assert.deepEqual(body, original)
  }
})

test("il token imposta il cookie e apre la UI", async (t) => {
  const { base } = await startWeb(t)

  const login = await fetch(`${base}/?token=${TOKEN}`, { redirect: "manual" })
  assert.equal(login.status, 302)
  const cookie = login.headers.get("set-cookie").split(";")[0]
  assert.match(cookie, /^ocb=/)

  const deep = await fetch(`${base}/?token=${TOKEN}&session=ses_test`, { redirect: "manual" })
  assert.equal(deep.status, 302)
  assert.equal(deep.headers.get("location"), "/chat?session=ses_test")

  const page = await fetch(`${base}/`, { headers: { cookie } })
  assert.equal(page.status, 200)
  assert.match(await page.text(), /Apri la chat/)

  const chat = await fetch(`${base}/chat`, { headers: { cookie } })
  assert.equal(chat.status, 200)
  assert.match(await chat.text(), /id="chat"/)

  const script = await fetch(`${base}/app.js`, { headers: { cookie } })
  assert.equal(script.status, 200)
  assert.match(await script.text(), /EventSource/)
})

test("POST /api/prompt richiede JSON, cookie e inoltra il testo", async (t) => {
  const { bridge, base } = await startWeb(t)
  const login = await fetch(`${base}/?token=${TOKEN}`, { redirect: "manual" })
  const cookie = login.headers.get("set-cookie").split(";")[0]

  const plain = await fetch(`${base}/api/prompt`, {
    method: "POST",
    headers: { cookie, "content-type": "text/plain" },
    body: "ciao",
  })
  assert.equal(plain.status, 415)

  const unauthorized = await fetch(`${base}/api/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "ciao" }),
  })
  assert.equal(unauthorized.status, 401)

  const ok = await fetch(`${base}/api/prompt`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ text: "ciao da web" }),
  })
  assert.equal(ok.status, 200)
  assert.deepEqual(bridge.sent, ["ciao da web"])
})

test("la risposta ai permessi usa la chiave della richiesta", async (t) => {
  const { bridge, base } = await startWeb(t)
  const login = await fetch(`${base}/?token=${TOKEN}`, { redirect: "manual" })
  const cookie = login.headers.get("set-cookie").split(";")[0]

  bridge.emit("permission", {
    id: "per_1",
    sessionID: "ses_test",
    action: "bash",
    resources: ["echo ciao"],
  })

  await new Promise((resolve) => setTimeout(resolve, 20))

  const response = await fetch(`${base}/api/permission`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ key: "1", decision: "once" }),
  })
  assert.equal(response.status, 200)
  assert.equal(bridge.permissionReplies.length, 1)
  assert.equal(bridge.permissionReplies[0].decision, "once")
})

test("la cronologia espone testo utente e assistente", async (t) => {
  const { base } = await startWeb(t)
  const login = await fetch(`${base}/?token=${TOKEN}`, { redirect: "manual" })
  const cookie = login.headers.get("set-cookie").split(";")[0]

  const response = await fetch(`${base}/api/history?session=ses_test`, { headers: { cookie } })
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.equal(data.messages.length, 2)
  assert.equal(data.messages[0].kind, "user")
  assert.equal(data.messages[0].text, "Domanda storica")
  assert.equal(data.messages[1].kind, "assistant")
  assert.equal(data.messages[1].text, "Risposta storica")
})

test("POST /api/prompt accetta allegati data:", async (t) => {
  const { bridge, base } = await startWeb(t)
  const login = await fetch(`${base}/?token=${TOKEN}`, { redirect: "manual" })
  const cookie = login.headers.get("set-cookie").split(";")[0]

  const response = await fetch(`${base}/api/prompt`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      text: "",
      files: [
        {
          name: "ciao.txt",
          uri: "data:text/plain;base64,SGVsbG8=",
          preview: "data:image/png;base64,iVBORw0KGgo=",
        },
      ],
    }),
  })
  assert.equal(response.status, 200)
  assert.equal(bridge.lastFiles.length, 1)
  assert.equal(bridge.lastFiles[0].name, "ciao.txt")
  assert.equal(bridge.lastFiles[0].preview, "data:image/png;base64,iVBORw0KGgo=")
})

test("la cronologia produce anteprime per gli allegati inline", async (t) => {
  const { bridge, base } = await startWeb(t)
  bridge.api.messages = async () => ({
    data: [
      {
        id: "mfile",
        type: "user",
        time: { created: 1 },
        text: "",
        files: [
          {
            name: "C:\\tmp\\screen.png",
            mime: "image/png",
            data: "SGVsbG8=",
          },
        ],
      },
    ],
  })

  const login = await fetch(`${base}/?token=${TOKEN}`, { redirect: "manual" })
  const cookie = login.headers.get("set-cookie").split(";")[0]
  const response = await fetch(`${base}/api/history?session=ses_test`, {
    headers: { cookie },
  })
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.equal(data.messages[0].files[0].name, "screen.png")
  assert.equal(data.messages[0].files[0].preview, "data:image/png;base64,SGVsbG8=")
})

test("POST /api/view segna la sessione come vista", async (t) => {
  const { bridge, base } = await startWeb(t)
  const login = await fetch(`${base}/?token=${TOKEN}`, { redirect: "manual" })
  const cookie = login.headers.get("set-cookie").split(";")[0]

  const response = await fetch(`${base}/api/view`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ session: "ses_test" }),
  })
  assert.equal(response.status, 200)
  assert.deepEqual(bridge.viewed, ["ses_test"])
})

test("POST /api/prompt rifiuta se la sessione è occupata", async (t) => {
  const { bridge, base } = await startWeb(t)
  bridge.isBusy = () => true

  const login = await fetch(`${base}/?token=${TOKEN}`, { redirect: "manual" })
  const cookie = login.headers.get("set-cookie").split(";")[0]
  const response = await fetch(`${base}/api/prompt`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ text: "ciao" }),
  })

  assert.equal(response.status, 409)
  assert.deepEqual(bridge.sent, [])
})

test("POST /api/prompt usa la sessione indicata dalla UI", async (t) => {
  const { bridge, base } = await startWeb(t)

  const login = await fetch(`${base}/?token=${TOKEN}`, { redirect: "manual" })
  const cookie = login.headers.get("set-cookie").split(";")[0]
  const response = await fetch(`${base}/api/prompt`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ text: "ciao", session: "ses_other" }),
  })

  assert.equal(response.status, 200)
  assert.equal(bridge.config.sessionID, "ses_other")
  assert.deepEqual(bridge.sent, ["ciao"])
})

test("SSE invia init con lo stato", async (t) => {
  const { base } = await startWeb(t)
  const login = await fetch(`${base}/?token=${TOKEN}`, { redirect: "manual" })
  const cookie = login.headers.get("set-cookie").split(";")[0]

  const response = await fetch(`${base}/events`, { headers: { cookie } })
  assert.equal(response.status, 200)

  const reader = response.body.getReader()
  const { value } = await reader.read()
  const text = new TextDecoder().decode(value)
  assert.match(text, /"type":"init"/)
  assert.match(text, /"id":"ses_test"/)
  await reader.cancel()
})
