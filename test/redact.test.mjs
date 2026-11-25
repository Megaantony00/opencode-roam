import test from "node:test"
import assert from "node:assert/strict"

import { redactText, splitMessage } from "../src/redact.mjs"

test("sostituisce il percorso dell'utente", () => {
  const input = String.raw`C:\Users\utente1\Documents\x.txt e C:\Users\utente2\y.txt`
  const out = redactText(input, { home: String.raw`C:\Users\utente1` })
  assert.equal(out, String.raw`C:\Users\<utente>\Documents\x.txt e C:\Users\<utente>\y.txt`)
})

test("sostituisce email e IP privati", () => {
  const out = redactText("scrivi a nome.cognome@example.com dal 192.168.1.15:8080", {})
  assert.equal(out, "scrivi a <email> dal <ip>:8080")
})

test("non tocca le versioni con tre numeri", () => {
  assert.equal(redactText("OpenCode 2.3.2", {}), "OpenCode 2.3.2")
})

test("sostituisce MAC, token Telegram e chiavi API", () => {
  // Assembled at runtime: this is a fake fixture, not a credential.
  const token = `${123456789}:${"A".repeat(30)}`
  const key = "sk-proj-abcdefghijklmnopqrstuvwxyz123456"
  const out = redactText(`mac AA:BB:CC:DD:EE:FF token ${token} key ${key}`, {})
  assert.equal(out, "mac <mac> token <token> key <chiave>")
})

test("nasconde le credenziali negli URL", () => {
  const out = redactText("https://utente:segreto@example.com/path", {})
  assert.equal(out, "https://<credenziali>@example.com/path")
})

test("sostituisce il nome host", () => {
  const out = redactText("host DESKTOP-ABC1234 online", { hostname: "DESKTOP-ABC1234" })
  assert.equal(out, "host <host> online")
})

test("tronca il testo oltre il limite", () => {
  const out = redactText("a".repeat(50), { maxChars: 20 })
  assert.ok(out.startsWith("a".repeat(20)))
  assert.ok(out.endsWith("[troncato]"))
  assert.ok(out.length > 20)
})

test("accorcia i blocchi di codice troppo lunghi", () => {
  const code = ["```js", ...Array.from({ length: 30 }, (_, i) => `const n${i} = ${i}`), "```"].join("\n")
  const out = redactText(code, { maxCodeLines: 6 })
  assert.match(out, /righe omesse/)
  assert.ok(out.split("\n").length < 15)
})

test("splitMessage rispetta il limite e non perde testo", () => {
  const text = Array.from({ length: 400 }, (_, i) => `riga ${i} con un po' di testo`).join("\n")
  const parts = splitMessage(text, 500)
  assert.ok(parts.length > 1)
  for (const part of parts) assert.ok(part.length <= 500, `parte troppo lunga: ${part.length}`)
  assert.equal(parts.join(""), text)
})

test("splitMessage taglia una riga singola più lunga del limite", () => {
  const parts = splitMessage("x".repeat(1200), 500)
  assert.equal(parts.length, 3)
  assert.equal(parts.join("").length, 1200)
})

test("splitMessage con testo vuoto restituisce un array vuoto", () => {
  assert.deepEqual(splitMessage("", 500), [])
})
