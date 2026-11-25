import assert from "node:assert/strict"
import test from "node:test"

import { retry } from "../src/util.mjs"

test("retry riprova fino al successo", async () => {
  const waits = []
  const retries = []
  let calls = 0

  const result = await retry(
    async () => {
      calls += 1
      if (calls < 3) throw new Error(`errore ${calls}`)
      return "ok"
    },
    {
      attempts: 3,
      delayMs: 10,
      wait: async (ms) => waits.push(ms),
      onRetry: (info) => retries.push(info.attempt),
    },
  )

  assert.equal(result, "ok")
  assert.equal(calls, 3)
  assert.deepEqual(retries, [1, 2])
  assert.deepEqual(waits, [10, 10])
})

test("retry rilancia l'ultimo errore dopo i tentativi", async () => {
  let calls = 0

  await assert.rejects(
    retry(
      async () => {
        calls += 1
        throw new Error(`errore ${calls}`)
      },
      { attempts: 2, delayMs: 0 },
    ),
    /errore 2/,
  )

  assert.equal(calls, 2)
})
