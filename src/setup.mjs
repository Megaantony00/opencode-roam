import { randomBytes } from "node:crypto"
import { stat } from "node:fs/promises"
import { createInterface } from "node:readline/promises"
import { stdin, stdout } from "node:process"

import { CONFIG_PATH, loadConfig, saveConfig } from "./config.mjs"
import { OpenCodeApi } from "./opencode.mjs"
import { generatePairCode, isPairCommand, safeEqual } from "./pairing.mjs"
import { createTranslator, isYes, resolveSetupLanguage } from "./setup-i18n.mjs"
import { TelegramApi } from "./telegram.mjs"
import { errorMessage, formatTime, isPrivateChat, oneLine } from "./util.mjs"

let rl = null
let t = createTranslator("en")

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
        console.error(`\n${t("botRunning")}`)
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
          .sendMessage(message.chat.id, t("startPair"))
          .catch(() => {})
        continue
      }

      const candidate = isPairCommand(text)
      if (candidate === null) continue

      if (!safeEqual(candidate, code)) {
        await api.sendMessage(message.chat.id, t("wrongCode")).catch(() => {})
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
      await api.sendMessage(message.chat.id, t("pairSuccess", { name })).catch(() => {})
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
    console.log(`\n${t("chooseSessionError")}`)
    if (!config.location) config.location = process.cwd()
    return
  }

  let list = []
  try {
    const result = await api.listSessions(8)
    list = Array.isArray(result?.data) ? result.data : []
  } catch (error) {
    console.log(`\n${t("cannotReadSessions", { error: errorMessage(error) })}`)
  }

  list.sort((left, right) => (right.time?.updated ?? 0) - (left.time?.updated ?? 0))

  if (!list.length) {
    console.log(`\n${t("noRecentSessions")}`)
    if (!config.location) config.location = process.cwd()
    return
  }

  console.log(`\n${t("recentSessions")}`)
  list.forEach((session, index) => {
    console.log(
      `${index + 1}. ${oneLine(session.title || t("untitled"), 64)}\n   ${session.id} · ${formatTime(session.time?.updated)} · ${session.location?.directory ?? "?"}`,
    )
  })

  const savedIndex = list.findIndex((session) => session.id === config.sessionID)
  const defaultIndex = savedIndex >= 0 ? String(savedIndex + 1) : "1"
  const answer = await ask(t("chooseSession", { count: list.length }), defaultIndex)
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
      `\n${t("webUrl")}`,
      config.web.publicUrl || "",
    )
    config.web.publicUrl = /^https?:\/\//i.test(publicUrl) ? publicUrl.trim() : ""
  }
}

function printSummary(config) {
  console.log(`\n${t("configSaved")}`)
  console.log(t("configFile", { path: CONFIG_PATH }))
  console.log(t("configSession", { session: config.sessionID || t("chosenOnFirstStart") }))
  console.log(t("configDirectory", { path: config.location }))
  console.log(
    t("configTelegram", {
      value: config.telegramEnabled
        ? config.telegramMode === "notify"
          ? t("telegramNotify")
          : t("telegramFull")
        : t("telegramDisabled"),
    }),
  )
  console.log(t("configRedaction", { value: config.redact ? t("on") : t("off") }))
  console.log(
    t("configWeb", {
      value: config.web.enabled
        ? `http://127.0.0.1:${config.web.port}`
        : t("webDisabled"),
    }),
  )

  if (config.web.enabled) {
    console.log(
      `\n${t("webLink", {
        url: `http://127.0.0.1:${config.web.port}/?token=${config.web.token}`,
      })}`,
    )
    console.log(t("tailscaleServe", { port: config.web.port }))
    if (config.web.publicUrl) console.log(t("tailscaleUrl", { url: config.web.publicUrl }))
  }

  console.log(`\n${t("start")}`)
  console.log(t("keepAwake"))
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
  t = createTranslator(resolveSetupLanguage(args))

  if (args.includes("--help") || args.includes("-h")) {
    console.log(t("setupHelp"))
    return
  }

  console.log(t("headerTitle"))
  console.log(`${t("headerLead")}\n`)

  const config = await loadConfig()

  if (args.includes("--reset")) {
    config.allowedUsers = []
    console.log(t("resetDone"))
  }

  let useTelegram = !args.includes("--web-only")
  if (args.includes("--web-only")) {
    useTelegram = false
  } else if (!args.includes("--telegram")) {
    const mode = await ask(
      t("modePrompt"),
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
    const keep = await ask(t("keepToken"), "n")
    if (isYes(keep)) token = ""
    else token = config.token
  }

  if (!token) {
    token = args.includes("--token-hidden")
      ? await askHidden(t("tokenHidden"))
      : await ask(t("tokenVisible"))
  }

  token = token.trim().replace(/^["']|["']$/g, "").replace(/\s+/g, "")

  while (token && !/^\d+:.+$/.test(token)) {
    console.error(t("tokenFormat"))
    console.error(t("tokenFormatHint"))
    const retry = await ask(t("tokenRetry"))
    token = retry.trim().replace(/^["']|["']$/g, "").replace(/\s+/g, "")
  }

  if (!token) {
    console.error(t("tokenMissing"))
    return
  }

  console.log(t("tokenRead", { count: token.length }))

  let api = new TelegramApi(token)
  let me = null
  for (let attempt = 1; attempt <= 3 && !me; attempt++) {
    try {
      me = await api.getMe()
    } catch (error) {
      if (error?.status === 0) {
        console.error(t("telegramUnreachable"))
        return
      }
      console.error(t("telegramRejected", { attempt, error: errorMessage(error) }))
      if (attempt < 3) {
        const retry = await ask(t("tokenRetry"))
        const cleaned = retry.trim().replace(/^["']|["']$/g, "").replace(/\s+/g, "")
        if (!cleaned) break
        if (!/^\d+:.+$/.test(cleaned)) {
          console.error(t("tokenFormat"))
          break
        }
        token = cleaned
        api = new TelegramApi(token)
        console.log(t("tokenRead", { count: token.length }))
      }
    }
  }

  if (!me) {
    console.error(t("tokenRejected"))
    return
  }

  config.token = token
  config.botUsername = me.username ?? ""
  await saveConfig(config)
  console.log(`\n${t("botLabel", { username: me.username ?? me.id })}`)

  const shouldPair = !args.includes("--no-pair")
  if (shouldPair) {
    if (config.allowedUsers.length > 0) {
      const replace = await ask(
        t("alreadyPaired", {
          name: config.allowedUsers[0].name,
          id: config.allowedUsers[0].id,
        }),
        "n",
      )
      if (!isYes(replace)) {
        console.log(t("pairingSkipped"))
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

    console.log(`\n${t("pairCode", { code })}`)
    console.log(t("pairOpen", { username: me.username ?? me.id }))
    console.log(`  /pair ${code}`)
    console.log(`\n${t("pairNoButton")}`)
    console.log(t("pairWaiting"))

    const paired = await pair(api, config, code)
    if (!paired) {
      config.allowedUsers = args.includes("--reset") ? [] : previousUsers
      await saveConfig(config).catch(() => {})
      console.log(t("pairNotCompleted"))
      return
    }
    console.log(t("telegramConnected"))
  }

  await finish(config)
}

async function finish(config) {
  config.telegramEnabled = true
  await chooseSession(config)

  const mode = await ask(
    `\n${t("telegramMode")}`,
    config.telegramMode === "notify" ? "n" : "c",
  )
  config.telegramMode = /^n/i.test(mode) ? "notify" : "full"

  const web = await ask(`\n${t("webEnable")}`, "y")
  if (isYes(web)) {
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
