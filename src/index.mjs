import { loadConfig, saveConfig } from "./config.mjs"
import { Bridge } from "./bridge.mjs"
import { OpenCodeApi } from "./opencode.mjs"
import { TelegramApi } from "./telegram.mjs"
import { TelegramTransport } from "./transports/telegram.mjs"
import { WebTransport } from "./transports/web.mjs"
import { errorMessage, retry, sleep } from "./util.mjs"

const controller = new AbortController()

function shutdown(reason) {
  if (controller.signal.aborted) return
  console.log(`\n[bridge] chiusura (${reason})`)
  controller.abort()
  setTimeout(() => process.exit(0), 1500).unref()
}

process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("unhandledRejection", (error) => {
  console.error(`[bridge] promessa rifiutata: ${errorMessage(error)}`)
})
process.on("uncaughtException", (error) => {
  console.error(`[bridge] eccezione: ${errorMessage(error)}`)
  process.exit(1)
})

async function main() {
  const config = await loadConfig()
  const useTelegram = config.telegramEnabled !== false
  const useWeb = Boolean(config.web?.enabled)

  if (!useTelegram && !useWeb) {
    console.error("Nessun trasporto attivo: abilita Telegram oppure la UI web nelle impostazioni.")
    process.exit(1)
  }
  if (useTelegram && !config.token) {
    console.error("Token Telegram mancante. Esegui: npm run setup")
    process.exit(1)
  }

  const api = await retry(() => OpenCodeApi.connect(), {
    attempts: 20,
    delayMs: 3000,
    onRetry: ({ attempt, attempts, error }) => {
      console.log(
        `[opencode] tentativo ${attempt}/${attempts} fallito: ${errorMessage(error)}; riprovo tra 3s`,
      )
    },
  })
  const bridge = new Bridge({ api, config, saveConfig })

  const transports = []
  const telegram = useTelegram
    ? new TelegramTransport({
        api: new TelegramApi(config.token),
        bridge,
        config,
        saveConfig,
      })
    : null
  if (telegram) transports.push(telegram)

  const web = useWeb ? new WebTransport({ bridge, config, saveConfig }) : null
  if (web) transports.push(web)

  let telegramOK = !useTelegram
  if (telegram) {
    try {
      await telegram.start(controller.signal)
      telegramOK = true
    } catch (error) {
      console.error(`[telegram] avvio fallito: ${errorMessage(error)}`)
    }
  }

  let webOK = !useWeb
  if (web) {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        await web.start(controller.signal)
        webOK = true
        break
      } catch (error) {
        console.error(`[web] avvio fallito (tentativo ${attempt}/5): ${errorMessage(error)}`)
        await web.stop().catch(() => {})
        if (attempt < 5) await sleep(1000)
      }
    }
    if (!webOK) {
      console.error("[web] UI web non disponibile: chiudo il bridge per evitare un'istanza senza web.")
      process.exit(1)
    }
  }

  if (!telegramOK && !webOK) process.exit(1)

  bridge.loop(controller.signal).catch((error) => {
    console.error(`[bridge] eventi: ${errorMessage(error)}`)
  })

  try {
    await bridge.init()
  } catch (error) {
    console.error(`[opencode] inizializzazione fallita: ${errorMessage(error)}`)
    process.exit(1)
  }

  const session = bridge.activeSession()
  console.log(`[bridge] OpenCode ${bridge.serverInfo?.version ?? "?"} · ${api.url}`)
  console.log(`[bridge] sessione: ${session ? session.title || session.id : "nessuna"}`)
  console.log(`[bridge] redazione: ${config.redact ? "attiva" : "disattivata"}`)
  console.log(
    `[bridge] Telegram: ${useTelegram ? (config.telegramMode === "notify" ? "solo notifiche" : "completa") : "disattivato"}`,
  )
  console.log(`[bridge] trasporti: ${[useTelegram && "telegram", useWeb && "web"].filter(Boolean).join(", ")}`)

  if (useTelegram && config.telegramMode === "notify" && !useWeb) {
    console.log("[bridge] solo notifiche senza UI web: per scrivere/approvare usa OpenCode dal PC.")
  }

  if (useTelegram && !config.allowedUsers.length) {
    console.log("[telegram] in attesa di pairing. Esegui npm run setup mentre il bot è fermo.")
  }

  await new Promise((resolve) => controller.signal.addEventListener("abort", resolve, { once: true }))
  await Promise.allSettled(transports.map((transport) => transport.stop?.()))
  process.exit(0)
}

main().catch((error) => {
  console.error(`[bridge] ${errorMessage(error)}`)
  process.exit(1)
})
