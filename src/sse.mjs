/**
 * Legge un flusso SSE e restituisce solo gli eventi JSON con un campo `type`.
 * I commenti (heartbeat) e le righe non valide vengono ignorati.
 */
export async function* parseSse(stream) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let match
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, match.index)
        buffer = buffer.slice(match.index + match[0].length)

        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n")

        if (!data) continue

        let event
        try {
          event = JSON.parse(data)
        } catch {
          continue
        }
        if (event && typeof event.type === "string") yield event
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // lo stream potrebbe essere già chiuso
    }
  }
}
