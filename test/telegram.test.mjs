import test from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"

import { TelegramApi, TelegramError } from "../src/telegram.mjs"

const TOKEN = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw"

async function withServer(handler, fn) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address()
  try {
    return await fn(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test("getMe restituisce il risultato", async () => {
  await withServer(
    (request, response) => {
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify({ ok: true, result: { id: 1, username: "test_bot" } }))
    },
    async (baseUrl) => {
      const api = new TelegramApi(TOKEN, { baseUrl })
      const me = await api.getMe()
      assert.equal(me.username, "test_bot")
    },
  )
})

test("setMyCommands registra il menu", async () => {
  let received = null

  await withServer(
    (request, response) => {
      let body = ""
      request.on("data", (chunk) => {
        body += chunk
      })
      request.on("end", () => {
        received = { url: request.url, body: JSON.parse(body) }
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ ok: true, result: true }))
      })
    },
    async (baseUrl) => {
      const api = new TelegramApi(TOKEN, { baseUrl })
      await api.setMyCommands([{ command: "status", description: "Stato" }])
    },
  )

  assert.match(received.url, /\/setMyCommands$/)
  assert.deepEqual(received.body.commands, [{ command: "status", description: "Stato" }])
})

test("gli errori non contengono il token", async () => {
  await withServer(
    (request, response) => {
      response.writeHead(401, { "content-type": "application/json" })
      response.end(
        JSON.stringify({
          ok: false,
          description: `Unauthorized token ${TOKEN}`,
        }),
      )
    },
    async (baseUrl) => {
      const api = new TelegramApi(TOKEN, { baseUrl })
      await assert.rejects(
        () => api.getMe(),
        (error) => {
          assert.ok(error instanceof TelegramError)
          assert.equal(error.status, 401)
          assert.ok(!error.message.includes(TOKEN), "il token non deve comparire")
          assert.match(error.message, /<token>/)
          return true
        },
      )
    },
  )
})

test("un errore di rete non contiene il token", async () => {
  const api = new TelegramApi(TOKEN, { baseUrl: "http://127.0.0.1:1" })
  await assert.rejects(
    () => api.getMe(),
    (error) => {
      assert.ok(error instanceof TelegramError)
      assert.ok(!error.message.includes(TOKEN))
      assert.match(error.message, /rete non raggiungibile/)
      return true
    },
  )
})
