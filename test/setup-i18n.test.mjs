import test from "node:test"
import assert from "node:assert/strict"

import { createTranslator, isYes, resolveSetupLanguage } from "../src/setup-i18n.mjs"

test("resolveSetupLanguage usa --lang", () => {
  assert.equal(resolveSetupLanguage(["--lang", "en"]), "en")
  assert.equal(resolveSetupLanguage(["--lang", "it"]), "it")
  assert.equal(resolveSetupLanguage(["--lang", "fr"]), "en")
})

test("createTranslator traduce e interpola", () => {
  assert.match(createTranslator("en")("tokenRead", { count: 12 }), /12/)
  assert.match(createTranslator("it")("tokenRead", { count: 12 }), /12/)
  assert.notEqual(
    createTranslator("en")("keepToken"),
    createTranslator("it")("keepToken"),
  )
})

test("isYes accetta y e s", () => {
  assert.equal(isYes("y"), true)
  assert.equal(isYes("sì"), true)
  assert.equal(isYes("n"), false)
})
