import { homedir, hostname as osHostname } from "node:os"

const USER_PATH = String.raw`C:\Users\<utente>`

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Riduce i dati personali e i segreti prima di mandare un testo a Telegram.
 * Non è una garanzia assoluta: evita di inviare segreti in chat.
 */
export function redactText(input, options = {}) {
  if (typeof input !== "string") return ""
  const home = options.home ?? homedir()
  const hostname = options.hostname ?? osHostname()
  const maxChars = Math.max(0, options.maxChars ?? 3500)
  const maxCodeLines = Math.max(2, options.maxCodeLines ?? 40)

  let text = input.replace(/\r\n/g, "\n")

  if (home && home.length > 3) {
    text = text.replace(new RegExp(escapeRegExp(home), "gi"), USER_PATH)
  }
  text = text.replace(/C:\\Users\\[^\\\s]+/gi, USER_PATH)
  text = text.replace(/\/home\/[^/\s]+/g, "/home/<utente>")
  text = text.replace(/\/Users\/[^/\s]+/g, "/Users/<utente>")

  if (hostname && hostname.length > 3) {
    text = text.replace(new RegExp(escapeRegExp(hostname), "gi"), "<host>")
  }
  text = text.replace(/\b(?:DESKTOP|LAPTOP)-[A-Z0-9]{6,}\b/gi, "<host>")

  text = text.replace(/(https?:\/\/)[^\s/@]+@/gi, "$1<credenziali>@")
  text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<email>")

  text = text.replace(/\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g, "<token>")
  text = text.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "<token>")
  text = text.replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g, "<chiave>")
  text = text.replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "<chiave>")
  text = text.replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "<chiave>")
  text = text.replace(/\bAKIA[0-9A-Z]{16}\b/g, "<chiave>")
  text = text.replace(
    /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret)\b(\s*[:=]\s*)("[^"]{8,}"|'[^']{8,}'|[^\s,;]{8,})/gi,
    "$1$2<segreto>",
  )

  text = text.replace(/\b(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}\b/gi, "<mac>")
  text = text.replace(
    /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
    "<ip>",
  )

  text = text.replace(/\bIT\d{2}[A-Z]\d{10}[A-Z0-9]{12}\b/g, "<iban>")
  text = text.replace(/\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/g, "<codice-fiscale>")
  text = text.replace(/\+39(?:[\s.-]?\d){6,13}\b/g, "<telefono>")

  text = text.replace(/(```[^\n]*\n)([\s\S]*?)```/g, (whole, open, body) => {
    const lines = body.split("\n")
    if (lines.length <= maxCodeLines) return whole
    const half = Math.max(1, Math.floor(maxCodeLines / 2))
    const omitted = lines.length - maxCodeLines
    const head = lines.slice(0, half).join("\n")
    const tail = lines.slice(-half).join("\n")
    return `${open}${head}\n… [${omitted} righe omesse]\n${tail}\n\`\`\``
  })

  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars).trimEnd()}\n… [troncato]`
  }

  return text
}

/** Divide un testo in blocchi che Telegram accetta (max 4096 caratteri). */
export function splitMessage(text, limit = 3500) {
  if (typeof text !== "string" || text.length === 0) return []
  const max = Math.max(1, Math.min(limit, 4000))
  const parts = []
  let rest = text

  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max - 1)
    if (cut < Math.floor(max * 0.4)) cut = rest.lastIndexOf(" ", max - 1)
    if (cut < Math.floor(max * 0.4)) cut = max
    else cut += 1
    parts.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }

  if (rest.length > 0) parts.push(rest)
  return parts
}
