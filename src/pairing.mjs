import { randomInt, timingSafeEqual } from "node:crypto"

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

export function generatePairCode(length = 6) {
  let out = ""
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)]
  return out
}

export function normalizePairCode(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
}

/** Restituisce il codice se il testo è /pair <codice>, altrimenti null. */
export function isPairCommand(text) {
  const match = /^\/pair(?:@\w+)?(?:\s+(.*))?$/i.exec(String(text ?? "").trim())
  if (!match) return null
  return normalizePairCode(match[1] ?? "")
}

export function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ""))
  const right = Buffer.from(String(b ?? ""))
  if (left.length === 0 || left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
