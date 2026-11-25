import test from "node:test"
import assert from "node:assert/strict"

import { parseSse } from "../src/sse.mjs"

function streamOf(chunks) {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

async function collect(stream) {
  const out = []
  for await (const event of parseSse(stream)) out.push(event)
  return out
}

test("legge eventi SSE separati", async () => {
  const events = await collect(streamOf(['data: {"type":"a"}\n\n', 'data: {"type":"b"}\n\n']))
  assert.deepEqual(events.map((e) => e.type), ["a", "b"])
})

test("gestisce eventi spezzati tra chunk", async () => {
  const events = await collect(
    streamOf(['data: {"type":"a"', "}\n", '\ndata: {"type":"b"}\n\n']),
  )
  assert.deepEqual(events.map((e) => e.type), ["a", "b"])
})

test("gestisce CRLF e heartbeat", async () => {
  const events = await collect(
    streamOf([": heartbeat\r\n\r\n", 'data: {"type":"x"}\r\n\r\n', 'data: {"type":"y"}\r\n\r\n']),
  )
  assert.deepEqual(events.map((e) => e.type), ["x", "y"])
})

test("ignora JSON non valido e righe senza type", async () => {
  const events = await collect(
    streamOf(['data: non-json\n\n', 'data: {"foo":1}\n\n', 'data: {"type":"ok"}\n\n']),
  )
  assert.deepEqual(events.map((e) => e.type), ["ok"])
})
