export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function retry(fn, options = {}) {
  const attempts = Math.max(1, Number(options.attempts) || 1)
  const delayMs = Math.max(0, Number(options.delayMs) || 0)
  const wait = options.wait ?? sleep
  let lastError

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt)
    } catch (error) {
      lastError = error
      if (attempt >= attempts) break
      options.onRetry?.({ attempt, attempts, error, delayMs })
      if (delayMs > 0) await wait(delayMs)
    }
  }

  throw lastError
}

export function errorMessage(error) {
  if (!error) return "errore sconosciuto"
  if (typeof error === "string") return error
  if (typeof error.message === "string" && error.message) return error.message
  return String(error)
}

export function truncate(value, max = 200) {
  const text = String(value ?? "")
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

export function oneLine(value, max = 80) {
  return truncate(String(value ?? "").replace(/\s+/g, " ").trim(), max)
}

export function formatTime(ms) {
  if (!Number.isFinite(ms)) return "?"
  try {
    return new Date(ms).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })
  } catch {
    return new Date(ms).toISOString()
  }
}

export function isPrivateChat(chat) {
  return chat?.type === "private"
}

export function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
