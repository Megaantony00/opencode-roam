import test from "node:test"
import assert from "node:assert/strict"

import { Bridge } from "../src/bridge.mjs"

function makeBridge() {
  return new Bridge({
    api: {},
    config: {
      sessionID: "ses_x",
      notifyToolFailures: true,
      mirrorActive: false,
    },
    saveConfig: async () => {},
  })
}

test("assembla il testo dell'assistente e lo emette a idle", async () => {
  const bridge = makeBridge()
  bridge.expected.add("ses_x")

  const received = new Promise((resolve) => bridge.once("text", resolve))

  await bridge.handleEvent({
    type: "session.execution.started",
    data: { sessionID: "ses_x" },
  })
  await bridge.handleEvent({
    type: "session.text.ended",
    data: { sessionID: "ses_x", assistantMessageID: "msg_1", ordinal: 0, text: "Ciao " },
  })
  await bridge.handleEvent({
    type: "session.text.ended",
    data: { sessionID: "ses_x", assistantMessageID: "msg_1", ordinal: 1, text: "mondo" },
  })
  await bridge.handleEvent({ type: "session.idle", data: { sessionID: "ses_x" } })

  assert.deepEqual(await received, { sessionID: "ses_x", text: "Ciao mondo" })
  assert.equal(bridge.expected.size, 0)
})

test("non emette testi di turni non richiesti dal bot", async () => {
  const bridge = makeBridge()
  let emitted = false
  bridge.on("text", () => {
    emitted = true
  })

  await bridge.handleEvent({
    type: "session.text.ended",
    data: { sessionID: "ses_x", assistantMessageID: "msg_1", ordinal: 0, text: "locale" },
  })
  await bridge.handleEvent({ type: "session.idle", data: { sessionID: "ses_x" } })

  assert.equal(emitted, false)
})

test("con mirrorActive inoltra anche i turni avviati dal PC", async () => {
  const bridge = makeBridge()
  bridge.config.mirrorActive = true
  const received = new Promise((resolve) => bridge.once("text", resolve))

  await bridge.handleEvent({
    type: "session.execution.started",
    data: { sessionID: "ses_x" },
  })
  await bridge.handleEvent({
    type: "session.text.ended",
    data: { sessionID: "ses_x", assistantMessageID: "msg_1", ordinal: 0, text: "dal PC" },
  })
  await bridge.handleEvent({ type: "session.idle", data: { sessionID: "ses_x" } })

  assert.deepEqual(await received, { sessionID: "ses_x", text: "dal PC" })
})

test("deduplica le richieste di permesso e le risolve", async () => {
  const bridge = makeBridge()
  const asked = []
  bridge.on("permission", (request) => asked.push(request))

  const request = { id: "per_1", sessionID: "ses_x", action: "bash", resources: ["echo"] }
  await bridge.handleEvent({ type: "permission.asked", data: request })
  await bridge.handleEvent({ type: "permission.asked", data: request })
  assert.equal(asked.length, 1)
  assert.equal(bridge.permissions.size, 1)

  const resolved = new Promise((resolve) => bridge.once("permission:resolved", resolve))
  await bridge.handleEvent({
    type: "permission.replied",
    data: { sessionID: "ses_x", requestID: "per_1", reply: "once" },
  })

  assert.deepEqual(await resolved, { request, decision: "once" })
  assert.equal(bridge.permissions.size, 0)
})

test("inoltra il fallimento di un tool solo se abilitato", async () => {
  const bridge = makeBridge()
  const failures = []
  bridge.on("tool:failed", (payload) => failures.push(payload))

  await bridge.handleEvent({
    type: "session.tool.failed",
    data: {
      sessionID: "ses_x",
      id: "bash",
      error: { type: "tool", message: "comando fallito" },
    },
  })
  assert.equal(failures.length, 1)
  assert.equal(failures[0].message, "comando fallito")

  bridge.config.notifyToolFailures = false
  await bridge.handleEvent({
    type: "session.tool.failed",
    data: { sessionID: "ses_x", id: "bash", error: { message: "ancora" } },
  })
  assert.equal(failures.length, 1)
})

test("un errore di esecuzione svuota lo stato del turno", async () => {
  const bridge = makeBridge()
  bridge.expected.add("ses_x")
  bridge.turns.set("ses_x", new Map())

  const received = new Promise((resolve) => bridge.once("error", resolve))
  await bridge.handleEvent({
    type: "session.execution.failed",
    data: { sessionID: "ses_x", error: { type: "provider", message: "quota esaurita" } },
  })

  assert.deepEqual(await received, { sessionID: "ses_x", message: "quota esaurita" })
  assert.equal(bridge.expected.has("ses_x"), false)
})

test("registra e risolve i form", async () => {
  const bridge = makeBridge()
  const form = { id: "form_1", sessionID: "ses_x", title: "Scelta", fields: [] }
  const seen = []
  bridge.on("form", (value) => seen.push(value))

  await bridge.handleEvent({ type: "form.created", data: { form } })
  await bridge.handleEvent({ type: "form.created", data: { form } })
  assert.equal(seen.length, 1)
  assert.equal(bridge.forms.size, 1)

  const resolved = new Promise((resolve) => bridge.once("form:resolved", resolve))
  await bridge.handleEvent({ type: "form.replied", data: { id: "form_1", sessionID: "ses_x", answer: {} } })

  const payload = await resolved
  assert.equal(payload.form.id, "form_1")
  assert.equal(payload.cancelled, false)
})

test("emette finished a fine turno", async () => {
  const bridge = makeBridge()
  bridge.on("error", () => {})
  const finished = []
  bridge.on("finished", (payload) => finished.push(payload))

  await bridge.handleEvent({
    type: "session.execution.started",
    data: { sessionID: "ses_x" },
  })
  await bridge.handleEvent({ type: "session.idle", data: { sessionID: "ses_x" } })

  assert.equal(finished.length, 1)
  assert.equal(finished[0].status, "succeeded")
})

test("finished riporta il fallimento e non duplica sull'idle", async () => {
  const bridge = makeBridge()
  bridge.on("error", () => {})
  const finished = []
  bridge.on("finished", (payload) => finished.push(payload))

  await bridge.handleEvent({
    type: "session.execution.started",
    data: { sessionID: "ses_x" },
  })
  await bridge.handleEvent({
    type: "session.execution.failed",
    data: { sessionID: "ses_x", error: { type: "provider", message: "quota esaurita" } },
  })
  await bridge.handleEvent({ type: "session.idle", data: { sessionID: "ses_x" } })

  assert.equal(finished.length, 1)
  assert.equal(finished[0].status, "failed")
  assert.equal(finished[0].error, "quota esaurita")
})

test("registra le sessioni create e i nuovi titoli", async () => {
  const bridge = makeBridge()

  await bridge.handleEvent({
    type: "session.created",
    data: { sessionID: "ses_new", title: "Nuova sessione" },
  })
  assert.equal(bridge.sessions.get("ses_new").title, "Nuova sessione")

  await bridge.handleEvent({
    type: "session.renamed",
    data: { sessionID: "ses_new", title: "Titolo cambiato" },
  })
  assert.equal(bridge.sessions.get("ses_new").title, "Titolo cambiato")
})
