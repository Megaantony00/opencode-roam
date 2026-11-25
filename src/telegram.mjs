import { sleep } from "./util.mjs"

export class TelegramError extends Error {
  constructor(method, status, description, retryAfter = 0) {
    super(`${method}: ${description}`)
    this.name = "TelegramError"
    this.method = method
    this.status = status
    this.description = description
    this.retryAfter = retryAfter
  }
}

export class TelegramApi {
  #token

  constructor(token, options = {}) {
    this.#token = token
    this.baseUrl = options.baseUrl ?? process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org"
  }

  #clean(value) {
    return String(value ?? "").replaceAll(this.#token, "<token>")
  }

  async call(method, payload = {}, options = {}) {
    const { timeoutMs = 25_000, retries = 1 } = options
    const url = `${this.baseUrl}/bot${this.#token}/${method}`

    for (let attempt = 0; ; attempt++) {
      let response
      try {
        response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (error) {
        const cause = error?.cause?.code ? ` (${error.cause.code})` : ""
        throw new TelegramError(method, 0, `rete non raggiungibile${cause}`)
      }

      let body = null
      try {
        body = await response.json()
      } catch {
        body = null
      }

      if (response.ok && body?.ok) return body.result

      const description = this.#clean(body?.description ?? `HTTP ${response.status}`)
      const retryAfter = Number(body?.parameters?.retry_after ?? 0)

      if ((response.status === 429 || response.status === 503) && attempt < retries) {
        await sleep(Math.max(1, retryAfter || 2) * 1000)
        continue
      }

      throw new TelegramError(method, response.status, description, retryAfter)
    }
  }

  getMe() {
    return this.call("getMe")
  }

  setMyCommands(commands) {
    return this.call("setMyCommands", { commands })
  }

  getUpdates(offset, timeoutSeconds = 50) {
    return this.call(
      "getUpdates",
      {
        offset,
        timeout: timeoutSeconds,
        allowed_updates: ["message", "callback_query"],
      },
      { timeoutMs: (timeoutSeconds + 20) * 1000, retries: 0 },
    )
  }

  sendMessage(chatId, text, extra = {}) {
    return this.call("sendMessage", {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      ...extra,
    })
  }

  editMessageText(chatId, messageId, text, extra = {}) {
    return this.call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      disable_web_page_preview: true,
      ...extra,
    })
  }

  deleteMessage(chatId, messageId) {
    return this.call("deleteMessage", {
      chat_id: chatId,
      message_id: messageId,
    })
  }

  answerCallbackQuery(callbackQueryId, text) {
    return this.call("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    })
  }

  sendChatAction(chatId, action = "typing") {
    return this.call("sendChatAction", { chat_id: chatId, action })
  }
}
