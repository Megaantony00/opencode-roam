import test from "node:test"
import assert from "node:assert/strict"

import { generatePairCode, isPairCommand, normalizePairCode, safeEqual } from "../src/pairing.mjs"

test("generatePairCode usa solo caratteri non ambigui", () => {
  for (let i = 0; i < 200; i++) {
    const code = generatePairCode(6)
    assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/)
  }
})

test("normalizePairCode rimuove spazi e trattini", () => {
  assert.equal(normalizePairCode(" ab-c12 "), "ABC12")
  assert.equal(normalizePairCode("a b c"), "ABC")
})

test("isPairCommand riconosce /pair anche con @bot", () => {
  assert.equal(isPairCommand("/pair ABC123"), "ABC123")
  assert.equal(isPairCommand("/pair@MyBot abc-123"), "ABC123")
  assert.equal(isPairCommand("/pair"), "")
  assert.equal(isPairCommand("ciao"), null)
})

test("safeEqual confronta in modo corretto", () => {
  assert.equal(safeEqual("ABC123", "ABC123"), true)
  assert.equal(safeEqual("ABC123", "ABC124"), false)
  assert.equal(safeEqual("ABC123", "ABC12"), false)
  assert.equal(safeEqual("", ""), false)
})
