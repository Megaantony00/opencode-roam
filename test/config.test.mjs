import test from "node:test"
import assert from "node:assert/strict"

import { DEFAULTS, mergeConfig } from "../src/config.mjs"

test("mergeConfig mantiene i default mancanti", () => {
  const cfg = mergeConfig(DEFAULTS, { token: "x", web: { port: 9000 } })
  assert.equal(cfg.token, "x")
  assert.equal(cfg.web.port, 9000)
  assert.equal(cfg.web.host, "127.0.0.1")
  assert.equal(cfg.redact, true)
  assert.deepEqual(cfg.allowedUsers, [])
})

test("mergeConfig non condivide gli array con i default", () => {
  const cfg = mergeConfig(DEFAULTS, {})
  cfg.allowedUsers.push({ id: 1 })
  assert.deepEqual(DEFAULTS.allowedUsers, [])
})
