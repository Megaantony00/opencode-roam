import { randomBytes } from "node:crypto"
import { stat } from "node:fs/promises"
import { createInterface } from "node:readline/promises"
import { stdin, stdout } from "node:process"

import { CONFIG_PATH, loadConfig, saveConfig } from "./config.mjs"
import { OpenCodeApi } from "./opencode.mjs"
import { generatePairCode, isPairCommand, safeEqual } from "./pairing.mjs"
import { TelegramApi } from "./telegram.mjs"
import { errorMessage, formatTime, isPrivateChat, oneLine } from "./util.mjs"

let rl = null

function getRl() {
  if (!rl) {
    rl = createInterface({ input: stdin, output: stdout })
    stdin.resume()
  }
  return rl
}

async function ask(question, defaultValue = "") {
  const suffix = defaultValue ? ` [${defaultValue}]` : ""
  const answer = (await getRl().question(`${question}${suffix}: `)).trim()
  return answer || defaultValue
}

async function askHidden(question) {
  if (!stdin.isTTY) {
    const answer = await getRl().question(question)
    return answer.trim()
  }

  return new Promise((resolve) => {
    stdout.write(question)
    const wasRaw = Boolean(stdin.isRaw)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding("utf8")

    let value = ""

    const cleanup = () => {
      stdin.off("data", onData)
      stdin.setRawMode(wasRaw)
      stdin.pause()
    }

    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          cleanup()
          stdout.write("\n")
          resolve(value.replace(/\[[0-9;]*[A-Za-z~]/g, "").replace(/\u001b\[[0-9;]*[A-Za-z~]/g, "").trim())
          return
        }
        if (char === "\u0003") {
          cleanup()
          stdout.write("\n")
          process.exit(130)
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1)
          continue
        }
        if (char >= " " && char !== "\u001b") value += char
      }
    }

    stdin.on("data", onData)
  })
}

function tokenFromArgs(args) {
  const index = args.indexOf("--token-file")
  if (index < 0) return null
  return args[index + 1] ?? null
}

async function readTokenFile(path) {
  const { readFile } = await import("node:fs/promises")
  return (await readFile(path, "utf8")).trim()
}

async function pair(api, config, code) {
  let offset = Number(config.telegramOffset) || 0
  const deadline = Date.now() + 10 * 60 * 1000

  while (Date.now() < deadline) {
    let updates
    try {
      updates = await api.getUpdates(offset, 50)
    } catch (error) {
      if (error?.status === 409) {
        console.error(
          "\nIl bot è già in esecuzione. Fermalo (Ctrl+C nella sua finestra) e rilancia npm run setup.",
        )
        return false
      }
      throw error
    }

    for (const update of updates) {
      offset = Math.max(offset, update.update_id + 1)
      const message = update.message
      if (!message || !isPrivateChat(message.chat) || !message.text) continue

      const text = message.text.trim()
      if (/^\/start(?:@\w+)?$/i.test(text)) {
        await api
          .sendMessage(message.chat.id, "Ciao. Inviami /pair <codice> (il codice è sul PC).")
          .catch(() => {})
        continue
      }

      const candidate = isPairCommand(text)
      if (candidate === null) continue

      if (!safeEqual(candidate, code)) {
        await api.sendMessage(message.chat.id, "Codice errato.").catch(() => {})
        continue
      }

      const name =
        [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") ||
        message.from?.username ||
        "utente"

      config.allowedUsers = [{ id: message.from.id, chatId: message.chat.id, name }]
      config.pairCode = ""
      config.pairCodeExpires = 0
      config.telegramOffset = offset
      await saveConfig(config)
      await api.sendMessage(message.chat.id, `✅ Collegamento riuscito, ${name}.`).catch(() => {})
      return true
    }

    if (updates.length > 0) {
      config.telegramOffset = offset
      await saveConfig(config).catch(() => {})
    }
  }

  return false
}

async function chooseSession(config) {
  let api
  try {
    api = await OpenCodeApi.connect({ startIfMissing: false })
  } catch {
    console.log("\nServizio OpenCode non attivo: la sessione verrà scelta al primo avvio.")
    if (!config.location) config.location = process.cwd()
    return
  }

  let list = []
  try {
    const result = await api.listSessions(8)
    list = Array.isArray(result?.data) ? result.data : []
  } catch (error) {
    console.log(`\nNon riesco a leggere le sessioni: ${errorMessage(error)}`)
  }

  list.sort((left, right) => (right.time?.updated ?? 0) - (left.time?.updated ?? 0))

  if (!list.length) {
    console.log("\nNessuna sessione recente: verrà scelta al primo avvio.")
    if (!config.location) config.location = process.cwd()
    return
  }

  console.log("\nSessioni recenti:")
  list.forEach((session, index) => {
    console.log(
      `${index + 1}. ${oneLine(session.title || "(senza titolo)", 64)}\n   ${session.id} · ${formatTime(session.time?.updated)} · ${session.location?.directory ?? "?"}`,
    )
  })

  const savedIndex = list.findIndex((session) => session.id === config.sessionID)
  const defaultIndex = savedIndex >= 0 ? String(savedIndex + 1) : "1"
  const answer = await ask(`Scegli la sessione predefinita (1-${list.length})`, defaultIndex)
  const index = Number(answer)
  const chosen =
    Number.isInteger(index) && index >= 1 && index <= list.length ? list[index - 1] : list[0]

  config.sessionID = chosen.id
  config.location = chosen.location?.directory || config.location || process.cwd()
}

async function resolveLocation(config) {
  if (config.location) {
    try {
      const info = await stat(config.location)
      if (!info.isDirectory()) config.location = process.cwd()
    } catch {
      config.location = process.cwd()
    }
  } else {
    config.location = process.cwd()
  }
}

async function enableWeb(config, { askUrl = true } = {}) {
  config.web = {
    ...config.web,
    enabled: true,
    host: "127.0.0.1",
    port: Number(config.web?.port) || 8787,
    token: config.web?.token || randomBytes(24).toString("base64url"),
  }

  if (askUrl) {
    const publicUrl = await ask(
      "\nURL of the web UI over Tailscale (optional, e.g. https://<host>.<tailnet>.ts.net)",
      config.web.publicUrl || "",
    )
    config.web.publicUrl = /^https?:\/\//i.test(publicUrl) ? publicUrl.trim() : ""
  }
}

function printSummary(config) {
  console.log("\nConfiguration saved.")
  console.log(`File: ${CONFIG_PATH}`)
  console.log(`Session: ${config.sessionID || "(chosen on first start)"}`)
  console.log(`Directory: ${config.location}`)
  console.log(
    `Telegram: ${config.telegramEnabled ? (config.telegramMode === "notify" ? "notify only" : "full chat") : "disabled"}`,
  )
  console.log(`Redaction: ${config.redact ? "on" : "off"}`)
  console.log(
    `Web: ${config.web.enabled ? `http://127.0.0.1:${config.web.port}` : "disabled"}`,
  )

  if (config.web.enabled) {
    console.log(
      `\nWeb link (contains a secret, do not share):\nhttp://127.0.0.1:${config.web.port}/?token=${config.web.token}`,
    )
    console.log(`Tailscale Serve: tailscale serve --bg http://127.0.0.1:${config.web.port}`)
    if (config.web.publicUrl) console.log(`Tailscale URL: ${config.web.publicUrl}`)
  }

  console.log("\nStart with: npm start")
  console.log("Keep the PC awake while you need remote access.")
}

async function finishWebOnly(config) {
  await chooseSession(config)
  await enableWeb(config)
  await resolveLocation(config)
  await saveConfig(config)
  printSummary(config)
}

async function main() {
  const args = process.argv.slice(2)

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Usage: npm run setup [-- --web-only|--telegram] [--reset] [--token-file <file>] [--no-pair] [--token-hidden]

  --web-only      configure only the web UI/PWA (no Telegram bot)
  --telegram      configure the web UI/PWA and Telegram
  --reset         remove Telegram users already paired
  --token-file    read the Telegram bot token from a file
  --no-pair       save token and session without pairing
  --token-hidden  ask for the Telegram token without showing it (default: visible)

Without --web-only or --telegram, the setup asks which mode to use.`)
    return
  }

  console.log("OpenCode Roam — configuration")
  console.log("Telegram is optional. The web UI is the primary transport.\n")

  const config = await loadConfig()

  if (args.includes("--reset")) {
    config.allowedUsers = []
    console.log("Telegram users removed.")
  }

  let useTelegram = !args.includes("--web-only")
  if (args.includes("--web-only")) {
    useTelegram = false
  } else if (!args.includes("--telegram")) {
    const mode = await ask(
      "Install mode: (1) Web/PWA only, (2) Web/PWA + Telegram",
      config.telegramEnabled ? "2" : "1",
    )
    useTelegram = /^2/.test(mode)
  }

  if (!useTelegram) {
    config.telegramEnabled = false
    await finishWebOnly(config)
    return
  }

  config.telegramEnabled = true

  const tokenPath = tokenFromArgs(args)
  let token = tokenPath ? await readTokenFile(tokenPath) : ""

  if (!token && config.token) {
    const keep = await ask("C'è già un token salvato. Vuoi sostituirlo? (s/n)", "n")
    if (/^s/i.test(keep)) token = ""
    else token = config.token
  }

  if (!token) {
    token = args.includes("--token-hidden")
      ? await askHidden("Token del bot (input nascosto): ")
      : await ask("Token del bot (visibile, incolla con Ctrl+V e premi Invio)")
  }

  token = token.trim().replace(/^["']|["']$/g, "").replace(/\s+/g, "")

  while (token && !/^\d+:.+$/.test(token)) {
    console.error(
      "Formato non riconosciuto: deve iniziare con i numeri del bot, poi ':', poi la parte dopo i due punti.",
    )
    console.error("Copia il token direttamente dal messaggio di BotFather, senza virgolette o spazi.")
    const retry = await ask("Incolla il token di nuovo (Invio per uscire)")
    token = retry.trim().replace(/^["']|["']$/g, "").replace(/\s+/g, "")
  }

  if (!token) {
    console.error("Token mancante.")
    return
  }

  console.log(`Token letto: ${token.length} caratteri.`)

  let api = new TelegramApi(token)
  let me = null
  for (let attempt = 1; attempt <= 3 && !me; attempt++) {
    try {
      me = await api.getMe()
    } catch (error) {
      if (error?.status === 0) {
        console.error("Telegram non è raggiungibile: controlla la connessione internet e rilancia npm run setup.")
        return
      }
      console.error(`Telegram ha rifiutato il token (tentativo ${attempt}/3): ${errorMessage(error)}`)
      if (attempt < 3) {
        const retry = await ask("Incolla di nuovo il token (Invio per uscire)")
        const cleaned = retry.trim().replace(/^["']|["']$/g, "").replace(/\s+/g, "")
        if (!cleaned) break
        if (!/^\d+:.+$/.test(cleaned)) {
          console.error("Formato non riconosciuto: serve la forma 123456789:ABC...")
          break
        }
        token = cleaned
        api = new TelegramApi(token)
        console.log(`Token letto: ${token.length} caratteri.`)
      }
    }
  }

  if (!me) {
    console.error("Token non accettato. Copialo di nuovo da BotFather e rilancia npm run setup.")
    return
  }

  config.token = token
  config.botUsername = me.username ?? ""
  await saveConfig(config)
  console.log(`\nBot: @${me.username ?? me.id}`)

  const shouldPair = !args.includes("--no-pair")
  if (shouldPair) {
    if (config.allowedUsers.length > 0) {
      const replace = await ask(
        `Già collegato a ${config.allowedUsers[0].name} (${config.allowedUsers[0].id}). Ricollegare? (s/n)`,
        "n",
      )
      if (!/^s/i.test(replace)) {
        console.log("Pairing saltato.")
        await finish(config)
        return
      }
    }

    const code = generatePairCode(6)
    const previousUsers = [...config.allowedUsers]
    config.pairCode = code
    config.pairCodeExpires = Date.now() + 10 * 60 * 1000
    config.allowedUsers = []
    await saveConfig(config)

    console.log(`\nCodice di pairing: ${code}  (valido 10 minuti)`)
    console.log(`Apri Telegram, cerca @${me.username ?? me.id}, premi START e invia:`)
    console.log(`  /pair ${code}`)
    console.log("\nNon c'è nessun pulsante: incolla /pair <codice> nel campo messaggio e premi Invio.")
    console.log("In attesa… (assicurati che il bot non sia già in esecuzione)")

    const paired = await pair(api, config, code)
    if (!paired) {
      config.allowedUsers = args.includes("--reset") ? [] : previousUsers
      await saveConfig(config).catch(() => {})
      console.log("Pairing non completato. Rilancia npm run setup quando vuoi.")
      return
    }
    console.log("Telegram collegato.")
  }

  await finish(config)
}

async function finish(config) {
  config.telegramEnabled = true
  await chooseSession(config)

  const mode = await ask(
    "\nTelegram mode: (c) full chat, (n) finish notifications only",
    config.telegramMode === "notify" ? "n" : "c",
  )
  config.telegramMode = /^n/i.test(mode) ? "notify" : "full"

  const web = await ask("\nEnable the web UI/PWA? (y/n)", "y")
  if (/^y/i.test(web)) {
    await enableWeb(config)
  } else {
    config.web = { ...config.web, enabled: false }
  }

  await resolveLocation(config)
  await saveConfig(config)
  printSummary(config)
}

main()
  .catch((error) => {
    console.error(errorMessage(error))
    process.exitCode = 1
  })
  .finally(() => {
    rl?.close()
  })
