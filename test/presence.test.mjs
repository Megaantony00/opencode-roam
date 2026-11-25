import test from "node:test"
import assert from "node:assert/strict"

import { Presence } from "../src/presence.mjs"

function fakeExec(result) {
  return async () => {
    if (result instanceof Error) throw result
    return { stdout: String(result), stderr: "" }
  }
}

test("Presence considera il PC in uso con idle basso", async () => {
  const presence = new Presence({ exec: fakeExec(30_000), thresholdMs: 120_000, platform: "win32" })
  assert.equal(await presence.isAtPc(), true)
})

test("Presence considera il PC non in uso con idle alto", async () => {
  const presence = new Presence({ exec: fakeExec(600_000), thresholdMs: 120_000, platform: "win32" })
  assert.equal(await presence.isAtPc(), false)
})

test("Presence non considera il PC in uso se è bloccato", async () => {
  const presence = new Presence({ exec: fakeExec(-1), thresholdMs: 120_000, platform: "win32" })
  assert.equal(await presence.isAtPc(), false)
})

test("Presence non considera il PC in uso se il probe fallisce", async () => {
  const presence = new Presence({ exec: fakeExec(new Error("boom")), thresholdMs: 120_000, platform: "win32" })
  assert.equal(await presence.isAtPc(), false)
})
