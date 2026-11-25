import { generatePairCode, isPairCommand, safeEqual } from "../pairing.mjs"
import { Presence } from "../presence.mjs"
import { redactText, splitMessage } from "../redact.mjs"
import { errorMessage, formatTime, isPrivateChat, oneLine, sleep, truncate } from "../util.mjs"
import { TelegramError } from "../telegram.mjs"
import { VpnManager } from "../vpn.mjs"

const HELP = `Comandi disponibili:
/status — stato del servizio e della sessione
/sessions — elenca le sessioni recenti
/use <numero|id> — cambia sessione attiva
/new [titolo] — crea una nuova sessione
/stop — interrompe l'esecuzione in corso
/forms — form in attesa
/form [numero] — compila un form
/cancel — annulla il form aperto
/mode full|notify — chat completa o solo notifiche
/mirror on|off — inoltra anche i turni avviati dal PC
/presence on|off — notifiche solo quando non sei al PC
/vpn status — stato di Tailscale
/vpn on — avvia Tailscale sul PC
/redact on|off — attiva o disattiva i filtri privacy
/id — mostra i tuoi identificativi
/ping — verifica la connessione
/help — questo messaggio

Scrivi un messaggio normale per inviarlo a OpenCode.
Le richieste di permesso arrivano con i pulsanti ✅ / ♾️ / ❌.`

const BOT_COMMANDS = [
  { command: "status", description: "Stato del servizio e della sessione" },
  { command: "sessions", description: "Elenca le sessioni recenti" },
  { command: "use", description: "Cambia sessione attiva" },
  { command: "new", description: "Crea una nuova sessione" },
  { command: "stop", description: "Interrompe l'esecuzione in corso" },
  { command: "forms", description: "Elenca i form in attesa" },
  { command: "form", description: "Compila un form in attesa" },
  { command: "cancel", description: "Annulla il form aperto" },
  { command: "mode", description: "Chat completa o solo notifiche" },
  { command: "mirror", description: "Inoltra i turni avviati dal PC" },
  { command: "presence", description: "Notifiche solo quando non sei al PC" },
  { command: "vpn", description: "Stato o avvio di Tailscale sul PC" },
  { command: "redact", description: "Attiva o disattiva i filtri privacy" },
  { command: "id", description: "Mostra i tuoi identificativi" },
  { command: "ping", description: "Verifica la connessione" },
  { command: "pair", description: "Collega il bot con il codice di setup" },
  { command: "help", description: "Mostra i comandi disponibili" },
]

const DECISIONS = {
  o: "once",
  a: "always",
  r: "reject",
}

const DECISION_LABEL = {
  once: "✅ Approvato una volta",
  always: "♾️ Approvato sempre",
  reject: "❌ Negato",
}

function commandOf(text) {
  const match = /^\/([a-z0-9_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(String(text ?? "").trim())
  if (!match) return null
  return { name: match[1].toLowerCase(), args: (match[2] ?? "").trim() }
}

export class TelegramTransport {
  constructor({
    api,
    bridge,
    config,
    saveConfig,
    logger = console,
    vpn = new VpnManager(),
    presence = new Presence({ thresholdMs: config.atPcIdleMs }),
  }) {
    this.api = api
    this.bridge = bridge
    this.config = config
    this.save = saveConfig
    this.log = logger
    this.vpn = vpn
    this.presence = presence

    this.offset = Number(config.telegramOffset) || 0
    this.stopped = false
    this.signal = null

    this.pendingPermissions = new Map()
    this.permissionByRequest = new Map()
    this.permissionSeq = 0

    this.formsByKey = new Map()
    this.formsByChat = new Map()
    this.formSeq = 0

    this.sessionChoices = []
    this.formChoices = []

    this.pairAttempts = new Map()
    this.viewedAt = new Map()

    this.typingTimer = null
    this.typingGeneration = 0

    this.bindBridge()
  }

  async start(signal) {
    this.signal = signal
    const me = await this.api.getMe()
    this.config.botUsername = me.username ?? ""
    await this.save(this.config)
    this.log.log(`[telegram] connesso come @${me.username ?? me.id}`)

    try {
      await this.api.setMyCommands(BOT_COMMANDS)
    } catch (error) {
      this.log.warn(`[telegram] menu comandi non aggiornato: ${errorMessage(error)}`)
    }

    if (this.config.allowedUsers.length === 0) {
      const valid = this.config.pairCode && Number(this.config.pairCodeExpires) > Date.now()
      if (!valid) {
        this.config.pairCode = generatePairCode(6)
        this.config.pairCodeExpires = Date.now() + 10 * 60 * 1000
        await this.save(this.config)
      }
      this.log.log(
        `[telegram] non ancora collegato. Invia al bot: /pair ${this.config.pairCode} (scade tra 10 minuti)`,
      )
    }

    void this.pollLoop(signal)
  }

  bindBridge() {
    this.bridge.on("text", (payload) => {
      void this.onAssistantText(payload).catch((error) =>
        this.log.error(`[telegram] testo: ${errorMessage(error)}`),
      )
    })
    this.bridge.on("permission", (request) => {
      void this.onPermission(request).catch((error) =>
        this.log.error(`[telegram] permesso: ${errorMessage(error)}`),
      )
    })
    this.bridge.on("permission:resolved", (payload) => {
      void this.onPermissionResolved(payload).catch((error) =>
        this.log.error(`[telegram] permesso risolto: ${errorMessage(error)}`),
      )
    })
    this.bridge.on("form", (form) => {
      void this.onForm(form).catch((error) =>
        this.log.error(`[telegram] form: ${errorMessage(error)}`),
      )
    })
    this.bridge.on("form:resolved", (payload) => {
      void this.onFormResolved(payload).catch((error) =>
        this.log.error(`[telegram] form risolto: ${errorMessage(error)}`),
      )
    })
    this.bridge.on("error", (payload) => {
      void this.onSessionError(payload).catch(() => {})
    })
    this.bridge.on("finished", (payload) => {
      void this.onFinished(payload).catch((error) =>
        this.log.error(`[telegram] fine sessione: ${errorMessage(error)}`),
      )
    })
    this.bridge.on("viewed", (payload) => {
      void this.onSessionViewed(payload).catch((error) =>
        this.log.error(`[telegram] sessione vista: ${errorMessage(error)}`),
      )
    })
    this.bridge.on("tool:failed", (payload) => {
      void this.onToolFailed(payload).catch(() => {})
    })
    this.bridge.on("busy", ({ sessionID, busy }) => {
      if (sessionID !== this.config.sessionID) return
      if (busy) this.startTyping()
      else this.stopTyping()
    })
    this.bridge.on("warn", (message) => this.log.warn(`[bridge] ${message}`))
  }

  isAllowed(userID) {
    return this.config.allowedUsers.some((user) => user.id === userID)
  }

  isNotify() {
    return this.config.telegramMode === "notify"
  }

  webLink(sessionID) {
    const base = String(this.config.web?.publicUrl ?? "").trim()
    if (!base) return ""
    try {
      const url = new URL(base)
      url.pathname = "/chat"
      if (sessionID) url.searchParams.set("session", sessionID)
      return `\nUI: ${url.toString()}`
    } catch {
      return ""
    }
  }

  prepareText(text) {
    const raw = String(text ?? "")
    if (!this.config.redact) return raw
    return redactText(raw, { maxChars: this.config.maxChars })
  }

  async send(chatID, text, extra = {}) {
    const chunks = splitMessage(this.prepareText(text), 3800)
    const messages = []
    for (const chunk of chunks) {
      messages.push(await this.api.sendMessage(chatID, chunk, extra))
    }
    return messages
  }

  async safeSend(chatID, text, extra = {}) {
    try {
      return await this.send(chatID, text, extra)
    } catch (error) {
      this.log.warn(`[telegram] invio fallito: ${errorMessage(error)}`)
      return []
    }
  }

  async sendToAllowed(text) {
    for (const user of this.config.allowedUsers) {
      await this.safeSend(user.chatId, text)
    }
  }

  startTyping() {
    const chatID = this.config.allowedUsers[0]?.chatId
    if (!chatID) return
    this.stopTyping()
    const generation = ++this.typingGeneration
    this.api.sendChatAction(chatID).catch(() => {})
    this.typingTimer = setInterval(() => {
      this.api.sendChatAction(chatID).catch(() => {})
    }, 4500)
    this.typingTimer.unref?.()
    const timer = setTimeout(() => {
      if (this.typingGeneration === generation) this.stopTyping()
    }, 5 * 60 * 1000)
    timer.unref?.()
  }

  stopTyping() {
    this.typingGeneration++
    if (this.typingTimer) {
      clearInterval(this.typingTimer)
      this.typingTimer = null
    }
  }

  async stop() {
    this.stopped = true
    this.stopTyping()
  }

  async pollLoop(signal) {
    let backoff = 1000

    while (!signal?.aborted && !this.stopped) {
      try {
        const updates = await this.api.getUpdates(this.offset, 50)
        backoff = 1000

        for (const update of updates) {
          this.offset = Math.max(this.offset, update.update_id + 1)
          try {
            await this.handleUpdate(update)
          } catch (error) {
            this.log.error(`[telegram] update: ${errorMessage(error)}`)
          }
        }

        if (updates.length > 0) {
          this.config.telegramOffset = this.offset
          await this.save(this.config).catch(() => {})
        }
      } catch (error) {
        if (signal?.aborted || this.stopped) return

        if (error instanceof TelegramError && error.status === 401) {
          this.log.error("[telegram] token rifiutato. Rilancia npm run setup.")
          return
        }
        if (error instanceof TelegramError && error.status === 409) {
          this.log.error("[telegram] un'altra istanza del bot è già in esecuzione.")
          await sleep(10_000)
          continue
        }

        this.log.warn(`[telegram] polling: ${errorMessage(error)}`)
        await sleep(backoff)
        backoff = Math.min(backoff * 2, 30_000)
      }
    }
  }

  async handleUpdate(update) {
    if (update.message) return this.handleMessage(update.message)
    if (update.callback_query) return this.handleCallback(update.callback_query)
  }

  async handleMessage(message) {
    if (!isPrivateChat(message.chat)) return
    const text = message.text?.trim()
    if (!text) return
    const chatID = message.chat.id
    const userID = message.from?.id

    const pairCode = isPairCommand(text)
    if (pairCode !== null) return this.handlePair(message, pairCode)

    if (!this.isAllowed(userID)) {
      if (/^\/(?:start|help)(?:@\w+)?$/i.test(text)) {
        await this.safeSend(
          chatID,
          "Bot privato. Per collegarlo invia /pair <codice>.\nIl codice lo trovi nel terminale dove hai eseguito npm run setup.",
        )
      }
      return
    }

    const command = commandOf(text)
    if (command) return this.handleCommand(command, message)

    const wizard = this.formsByChat.get(chatID)
    if (wizard) {
      if (wizard.awaitingField) return this.handleFormText(wizard, text)
      await this.safeSend(chatID, "Stai compilando un form: usa i pulsanti, oppure /cancel.")
      return
    }

    return this.handlePrompt(message, text)
  }

  async handlePrompt(message, text) {
    const chatID = message.chat.id
    if (this.isNotify()) {
      await this.safeSend(
        chatID,
        "Modalità solo notifiche: apri la UI web via Tailscale (o il PC) per scrivere a OpenCode.\nPer tornare alla chat: /mode full",
      )
      return
    }

    const session = this.bridge.activeSession()
    if (!session) {
      await this.safeSend(chatID, "Nessuna sessione attiva. Creane una con /new.")
      return
    }

    const busy = this.bridge.isBusy(session.id)
    if (busy && this.config.rejectWhenBusy !== false) {
      await this.safeSend(chatID, "⏳ OpenCode sta lavorando: attendi la fine del turno.")
      return
    }

    try {
      await this.bridge.sendPrompt(text)
      this.startTyping()
      await this.safeSend(chatID, "⏳ Inviato a OpenCode.")
    } catch (error) {
      this.stopTyping()
      await this.safeSend(chatID, `❌ ${errorMessage(error)}`)
    }
  }

  async handleCommand(command, message) {
    const chatID = message.chat.id

    switch (command.name) {
      case "start":
        await this.safeSend(
          chatID,
          `👋 Collegato a OpenCode.\n\n${HELP}`,
        )
        break

      case "help":
        await this.safeSend(chatID, HELP)
        break

      case "status":
        await this.safeSend(chatID, this.statusText())
        break

      case "ping":
        await this.safeSend(chatID, `pong · ${formatTime(Date.now())}`)
        break

      case "id":
        await this.safeSend(
          chatID,
          `User ID: ${message.from.id}\nChat ID: ${chatID}\nBot: @${this.config.botUsername || "?"}`,
        )
        break

      case "sessions":
        await this.showSessions(chatID)
        break

      case "use":
        await this.useSession(chatID, command.args)
        break

      case "new":
        await this.newSession(chatID, command.args)
        break

      case "stop":
        await this.stopSession(chatID)
        break

      case "redact":
        await this.setRedact(chatID, command.args)
        break

      case "mirror":
        await this.setMirror(chatID, command.args)
        break

      case "presence":
        await this.setPresence(chatID, command.args)
        break

      case "mode":
        await this.setMode(chatID, command.args)
        break

      case "vpn":
        await this.handleVpn(chatID, command.args)
        break

      case "forms":
        await this.listForms(chatID)
        break

      case "form":
        await this.chooseForm(chatID, command.args)
        break

      case "cancel":
        await this.cancelWizard(chatID)
        break

      default:
        await this.safeSend(chatID, `Comando sconosciuto.\n\n${HELP}`)
        break
    }
  }

  statusText() {
    const session = this.bridge.activeSession()
    const version = this.bridge.serverInfo?.version ?? "?"
    const lines = [`📡 OpenCode ${version}`]

    if (session) {
      lines.push(`Sessione: ${oneLine(session.title || "(senza titolo)", 70)}`)
      lines.push(session.id)
      lines.push(`Stato: ${this.bridge.isBusy(session.id) ? "in esecuzione" : "in attesa"}`)
    } else {
      lines.push("Nessuna sessione attiva")
    }

    lines.push(`Permessi in attesa: ${this.bridge.permissions.size}`)
    lines.push(`Form in attesa: ${this.bridge.forms.size}`)
    lines.push(`Modalità: ${this.isNotify() ? "solo notifiche" : "completa"}`)
    lines.push(`Redazione: ${this.config.redact ? "attiva" : "disattivata"}`)
    lines.push(
      `Presenza PC: ${
        this.config.suppressAtPc !== false
          ? `attiva (idle < ${Math.round((this.config.atPcIdleMs ?? 120000) / 1000)}s)`
          : "disattivata"
      }`,
    )
    lines.push(`Riflesso sessione attiva: ${this.config.mirrorActive !== false ? "attivo" : "disattivato"}`)
    lines.push(
      `Web: ${
        this.config.web?.enabled
          ? `attiva sulla porta ${this.config.web.port}`
          : "disattivata"
      }`,
    )

    return lines.join("\n")
  }

  async showSessions(chatID) {
    const list = await this.bridge.refreshSessions(10)
    list.sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))
    this.sessionChoices = list

    if (!list.length) {
      await this.safeSend(chatID, "Nessuna sessione trovata. Creane una con /new.")
      return
    }

    const lines = list.map((session, index) => {
      const active = session.id === this.config.sessionID ? "▶ " : "  "
      return `${active}${index + 1}. ${oneLine(session.title || "(senza titolo)", 60)}\n     ${session.id} · ${formatTime(session.time?.updated)}`
    })

    await this.safeSend(chatID, `Sessioni:\n${lines.join("\n")}\n\n/use <numero|id>`)
  }

  async useSession(chatID, arg) {
    if (!arg) return this.showSessions(chatID)

    let target = null
    if (/^\d+$/.test(arg)) target = this.sessionChoices[Number(arg) - 1] ?? null
    else if (arg.startsWith("ses_")) target = { id: arg }
    else {
      const needle = arg.toLowerCase()
      target =
        this.sessionChoices.find((session) =>
          String(session.title ?? "").toLowerCase().includes(needle),
        ) ?? null
    }

    if (!target) {
      await this.safeSend(chatID, "Sessione non trovata. Usa /sessions per l'elenco.")
      return
    }

    try {
      const session = await this.bridge.setActive(target.id)
      this.stopTyping()
      await this.safeSend(
        chatID,
        `✅ Sessione attiva: ${oneLine(session.title || "(senza titolo)", 70)}\n${session.id}`,
      )
    } catch (error) {
      await this.safeSend(chatID, `❌ ${errorMessage(error)}`)
    }
  }

  async newSession(chatID, arg) {
    const title = arg || `Telegram ${new Date().toLocaleString("it-IT")}`
    try {
      const session = await this.bridge.createSession(title)
      this.stopTyping()
      await this.safeSend(
        chatID,
        `✅ Nuova sessione: ${oneLine(session.title || title, 70)}\n${session.id}`,
      )
    } catch (error) {
      await this.safeSend(chatID, `❌ ${errorMessage(error)}`)
    }
  }

  async stopSession(chatID) {
    try {
      await this.bridge.interrupt()
      this.stopTyping()
      await this.safeSend(chatID, "⏹ Esecuzione interrotta.")
    } catch (error) {
      await this.safeSend(chatID, `❌ ${errorMessage(error)}`)
    }
  }

  async setRedact(chatID, arg) {
    const value = arg.toLowerCase()
    if (["on", "true", "1", "si", "sì"].includes(value)) this.config.redact = true
    else if (["off", "false", "0", "no"].includes(value)) this.config.redact = false
    else {
      await this.safeSend(chatID, "Uso: /redact on|off")
      return
    }

    await this.save(this.config)
    await this.safeSend(
      chatID,
      this.config.redact
        ? "🔒 Redazione attiva."
        : "⚠️ Redazione disattivata: le risposte arriveranno su Telegram senza filtri.",
    )
  }

  async setMirror(chatID, arg) {
    const value = arg.toLowerCase()
    if (["on", "true", "1", "si", "sì"].includes(value)) this.config.mirrorActive = true
    else if (["off", "false", "0", "no"].includes(value)) this.config.mirrorActive = false
    else {
      await this.safeSend(chatID, "Uso: /mirror on|off")
      return
    }

    await this.save(this.config)
    await this.safeSend(
      chatID,
      this.config.mirrorActive
        ? "👁 Inoltro anche i turni avviati dal PC nella sessione attiva."
        : "🔕 Inoltro solo i turni avviati da Telegram/web.",
    )
  }

  async setMode(chatID, arg) {
    const value = arg.toLowerCase()
    if (["notify", "notifiche", "n"].includes(value)) this.config.telegramMode = "notify"
    else if (["full", "completa", "chat", "c"].includes(value)) this.config.telegramMode = "full"
    else {
      await this.safeSend(chatID, "Uso: /mode full|notify")
      return
    }

    await this.save(this.config)
    await this.safeSend(
      chatID,
      this.isNotify()
        ? "🔔 Modalità solo notifiche: ti avviso a fine sessione e quando serve un'approvazione. Per scrivere usa la UI web via Tailscale."
        : "💬 Modalità chat completa: i messaggi che scrivi qui vanno a OpenCode.",
    )
  }

  async setPresence(chatID, arg) {
    const value = arg.toLowerCase()
    if (["on", "true", "1", "si", "sì"].includes(value)) this.config.suppressAtPc = true
    else if (["off", "false", "0", "no"].includes(value)) this.config.suppressAtPc = false
    else {
      await this.safeSend(chatID, "Uso: /presence on|off")
      return
    }

    await this.save(this.config)
    await this.safeSend(
      chatID,
      this.config.suppressAtPc
        ? `🔕 Non ti avviso quando il PC è in uso (ultimi ${Math.round((this.config.atPcIdleMs ?? 120000) / 1000)} secondi).`
        : "🔔 Ti avviso sempre, anche quando sei al PC.",
    )
  }

  async handleVpn(chatID, arg) {
    const action = (arg || "status").toLowerCase()

    if (["on", "start", "up", "attiva", "avvia"].includes(action)) {
      await this.safeSend(chatID, "⏳ Controllo e avvio Tailscale…")
      try {
        const result = await this.vpn.ensure()
        const lines = [
          result.running && result.online ? "✅ Tailscale connesso." : "⚠️ Tailscale non connesso.",
          `Stato: ${result.backend || "?"}`,
        ]
        if (result.message) lines.push(result.message)
        if (result.steps?.length) lines.push(`Azioni: ${result.steps.join("; ")}`)
        if (!result.online) lines.push("Se serve il login, aprilo sul PC.")
        await this.safeSend(chatID, lines.join("\n"))
      } catch (error) {
        await this.safeSend(chatID, `❌ ${errorMessage(error)}`)
      }
      return
    }

    if (!["status", "stato", ""].includes(action)) {
      await this.safeSend(chatID, "Uso: /vpn status | /vpn on")
      return
    }

    try {
      const status = await this.vpn.status()
      if (!status.installed) {
        await this.safeSend(chatID, "Tailscale non installato sul PC.")
        return
      }
      const lines = [
        status.running && status.online ? "✅ Tailscale connesso." : "⚠️ Tailscale non connesso.",
        `Stato: ${status.backend || "?"}`,
      ]
      if (status.backend === "NeedsLogin") lines.push("Serve il login sul PC.")
      if (status.error) lines.push(status.error)
      await this.safeSend(chatID, lines.join("\n"))
    } catch (error) {
      await this.safeSend(chatID, `❌ ${errorMessage(error)}`)
    }
  }

  async onAssistantText({ sessionID, text }) {
    if (this.isNotify()) return
    if (!this.config.allowedUsers.length) return
    if (sessionID === this.config.sessionID) this.stopTyping()

    const active = sessionID === this.config.sessionID
    const prefix = active ? "" : `[${oneLine(this.bridge.sessionTitle(sessionID), 60)}]\n`
    for (const user of this.config.allowedUsers) {
      await this.safeSend(user.chatId, `${prefix}${text}`)
    }
  }

  async onSessionError({ sessionID, message }) {
    if (this.isNotify()) return
    if (sessionID === this.config.sessionID) this.stopTyping()
    const prefix =
      sessionID === this.config.sessionID
        ? ""
        : `[${oneLine(this.bridge.sessionTitle(sessionID), 60)}]\n`
    await this.sendToAllowed(`${prefix}⚠️ Errore: ${message}`)
  }

  async onToolFailed({ sessionID, tool, message }) {
    if (this.isNotify()) return
    if (sessionID !== this.config.sessionID) return
    await this.sendToAllowed(`⚠️ Tool ${oneLine(tool, 40)} fallito: ${truncate(message, 500)}`)
  }

  async onFinished({ sessionID, status, error }) {
    if (!this.isNotify()) return
    if (this.config.notifyAllSessions === false && sessionID !== this.config.sessionID) return
    if (!this.config.allowedUsers.length) return

    const session = this.bridge.sessions.get(sessionID)
    if (!session && sessionID !== this.config.sessionID) return
    if (session?.parentID) return

    if (this.config.suppressAtPc !== false) {
      try {
        if (await this.presence.isAtPc()) {
          await this.onSessionViewed({ sessionID })
          return
        }
      } catch {
        // se il probe fallisce, meglio mandare la notifica
      }
    }

    const title = oneLine(this.bridge.sessionTitle(sessionID), 70)
    const link = this.webLink(sessionID)
    let message

    if (Date.now() - (this.viewedAt.get(sessionID) ?? 0) < 5000) return
    const startedAt = Date.now()

    if (status === "failed") {
      message = `⚠️ Sessione fallita: ${title}\n${truncate(error || "errore sconosciuto", 400)}${link}`
    } else if (status === "interrupted") {
      message = `⏹ Sessione interrotta: ${title}${link}`
    } else {
      message = `✅ Sessione finita: ${title}${link}`
    }

    const notifications = (this.config.notificationMessages ??= {})

    for (const user of this.config.allowedUsers) {
      const key = `${user.chatId}:${sessionID}`
      const previous = notifications[key]

      if (previous?.messageIds?.length) {
        for (const messageId of previous.messageIds) {
          try {
            await this.api.deleteMessage(previous.chatId, messageId)
          } catch {
            // Telegram non permette di eliminare messaggi troppo vecchi
          }
        }
        delete notifications[key]
        await this.save(this.config).catch(() => {})
      }

      try {
        const sent = await this.send(user.chatId, message)
        const messageIds = sent.map((item) => item?.message_id).filter(Boolean)
        if (messageIds.length) {
          notifications[key] = { chatId: user.chatId, messageIds, sentAt: Date.now() }
          await this.save(this.config).catch(() => {})
        }
      } catch (error) {
        this.log.warn(`[telegram] notifica fine sessione: ${errorMessage(error)}`)
      }
    }

    if ((this.viewedAt.get(sessionID) ?? 0) >= startedAt) {
      await this.onSessionViewed({ sessionID })
    }
  }

  async onPermissionNotify(request) {
    if (!this.config.allowedUsers.length) return
    const lines = [
      "🔐 Permesso in attesa",
      `Sessione: ${oneLine(this.bridge.sessionTitle(request.sessionID), 60)}`,
      `Azione: ${request.action}`,
      `Apri la UI web o il PC per approvare.${this.webLink(request.sessionID)}`,
    ]
    await this.sendToAllowed(lines.join("\n"))
  }

  async onSessionViewed({ sessionID }) {
    this.viewedAt.set(sessionID, Date.now())
    const notifications = (this.config.notificationMessages ??= {})
    let changed = false

    for (const user of this.config.allowedUsers) {
      const key = `${user.chatId}:${sessionID}`
      const previous = notifications[key]
      if (!previous?.messageIds?.length) continue

      for (const messageId of previous.messageIds) {
        try {
          await this.api.deleteMessage(previous.chatId, messageId)
        } catch {
          // messaggio troppo vecchio o già cancellato
        }
      }

      delete notifications[key]
      changed = true
    }

    if (changed) await this.save(this.config).catch(() => {})
  }

  async onPermission(request) {
    if (!this.config.allowedUsers.length) return
    if (this.isNotify()) return this.onPermissionNotify(request)

    const resources = (request.resources ?? []).slice(0, 4).map((item) => truncate(item, 300))
    const extra = (request.resources ?? []).length > 4 ? "\n…" : ""
    const lines = [
      "🔐 Permesso richiesto",
      `Sessione: ${oneLine(this.bridge.sessionTitle(request.sessionID), 60)}`,
      `Azione: ${request.action}`,
    ]
    if (resources.length) lines.push(`Risorsa: ${resources.join(", ")}${extra}`)
    if (request.message) lines.push(`Motivo: ${truncate(request.message, 600)}`)

    const key = String(++this.permissionSeq)
    const entry = {
      key,
      request,
      messages: [],
      text: this.prepareText(lines.join("\n")),
    }
    this.pendingPermissions.set(key, entry)
    this.permissionByRequest.set(request.id, entry)

    const keyboard = {
      inline_keyboard: [
        [
          { text: "✅ Una volta", callback_data: `p:${key}:o` },
          { text: "♾️ Sempre", callback_data: `p:${key}:a` },
        ],
        [{ text: "❌ Nega", callback_data: `p:${key}:r` }],
      ],
    }

    for (const user of this.config.allowedUsers) {
      try {
        const sent = await this.api.sendMessage(user.chatId, entry.text, {
          reply_markup: keyboard,
        })
        entry.messages.push({ chatID: user.chatId, messageID: sent.message_id })
      } catch (error) {
        this.log.warn(`[telegram] permesso non inviato: ${errorMessage(error)}`)
      }
    }

    if (!entry.messages.length) {
      this.pendingPermissions.delete(key)
      this.permissionByRequest.delete(request.id)
    }
  }

  async onPermissionResolved({ request, decision }) {
    if (request.sessionID === this.config.sessionID) this.stopTyping()
    const entry = this.permissionByRequest.get(request.id)
    if (!entry) return

    this.permissionByRequest.delete(request.id)
    this.pendingPermissions.delete(entry.key)

    const label = DECISION_LABEL[decision] ?? `✅ Risolto (${decision})`
    for (const { chatID, messageID } of entry.messages) {
      try {
        await this.api.editMessageText(chatID, messageID, `${entry.text}\n\n${label}`, {
          reply_markup: { inline_keyboard: [] },
        })
      } catch {
        // messaggio già modificato o troppo vecchio
      }
    }
  }

  pairRateOk(userID) {
    const now = Date.now()
    const previous = (this.pairAttempts.get(userID) ?? []).filter((time) => now - time < 10 * 60 * 1000)
    if (previous.length >= 5) {
      this.pairAttempts.set(userID, previous)
      return false
    }
    previous.push(now)
    this.pairAttempts.set(userID, previous)
    return true
  }

  async handlePair(message, code) {
    const chatID = message.chat.id
    const userID = message.from?.id

    if (this.config.allowedUsers.length > 0 && !this.isAllowed(userID)) {
      await this.safeSend(chatID, "Questo bot è già collegato a un altro account.")
      return
    }

    if (!this.config.pairCode || Number(this.config.pairCodeExpires) < Date.now()) {
      await this.safeSend(chatID, "Nessun codice attivo. Esegui npm run setup sul PC.")
      return
    }

    if (!this.pairRateOk(userID)) {
      await this.safeSend(chatID, "Troppi tentativi. Riprova tra qualche minuto.")
      return
    }

    if (!safeEqual(code, this.config.pairCode)) {
      await this.safeSend(chatID, "Codice errato.")
      return
    }

    const name =
      [message.from.first_name, message.from.last_name].filter(Boolean).join(" ") ||
      message.from.username ||
      "utente"

    this.config.allowedUsers = [
      ...this.config.allowedUsers.filter((user) => user.id !== userID),
      { id: userID, chatId: chatID, name },
    ]
    this.config.pairCode = ""
    this.config.pairCodeExpires = 0
    this.pairAttempts.delete(userID)
    await this.save(this.config)

    await this.safeSend(chatID, `✅ Collegamento riuscito, ${name}.\n\n${HELP}`)
  }

  async handleCallback(query) {
    const userID = query.from?.id
    const chatID = query.message?.chat?.id
    let answered = false

    try {
      if (!this.isAllowed(userID)) {
        await this.api.answerCallbackQuery(query.id, "Non autorizzato")
        answered = true
        return
      }

      const data = String(query.data ?? "")
      const parts = data.split(":")

      if (parts[0] === "p" && parts.length === 3) {
        const entry = this.pendingPermissions.get(parts[1])
        const decision = DECISIONS[parts[2]]
        if (!entry || !decision) {
          await this.api.answerCallbackQuery(query.id, "Richiesta non più valida")
          answered = true
          return
        }
        try {
          await this.bridge.replyPermission(entry.request, decision)
          await this.api.answerCallbackQuery(query.id, DECISION_LABEL[decision])
        } catch (error) {
          await this.api.answerCallbackQuery(query.id, errorMessage(error))
        }
        answered = true
        return
      }

      if (parts[0] === "f" && parts.length >= 3) {
        answered = await this.handleFormCallback(query, parts)
        return
      }

      await this.api.answerCallbackQuery(query.id)
      answered = true
    } catch (error) {
      this.log.warn(`[telegram] callback: ${errorMessage(error)}`)
      if (!answered) {
        try {
          await this.api.answerCallbackQuery(query.id, "Errore")
        } catch {
          // ignorato
        }
      }
    }
  }

  visibleFields(form) {
    return (form.fields ?? []).filter((field) => !field.hidden)
  }

  async listForms(chatID) {
    const session = this.bridge.activeSession()
    if (!session) {
      await this.safeSend(chatID, "Nessuna sessione attiva.")
      return
    }

    this.formChoices = [...this.bridge.forms.values()].filter(
      (form) => form.sessionID === session.id,
    )

    if (!this.formChoices.length) {
      await this.safeSend(chatID, "Nessun form in attesa.")
      return
    }

    const lines = this.formChoices.map(
      (form, index) => `${index + 1}. ${oneLine(form.title || "(senza titolo)", 70)}`,
    )
    await this.safeSend(chatID, `Form in attesa:\n${lines.join("\n")}\n\n/form <numero>`)
  }

  async chooseForm(chatID, arg) {
    if (arg) {
      const index = Number(arg)
      if (!Number.isInteger(index) || index < 1 || index > this.formChoices.length) {
        await this.safeSend(chatID, "Numero non valido. Usa /forms.")
        return
      }
      return this.startForm(this.formChoices[index - 1])
    }

    const session = this.bridge.activeSession()
    const form = [...this.bridge.forms.values()].find(
      (candidate) => candidate.sessionID === session?.id,
    )
    if (!form) {
      await this.safeSend(chatID, "Nessun form in attesa. Usa /forms.")
      return
    }
    return this.startForm(form)
  }

  async onForm(form) {
    if (!this.config.allowedUsers.length) return
    if (this.isNotify()) {
      const link = this.webLink(form.sessionID)
      await this.sendToAllowed(
        `📝 Form in attesa: ${oneLine(form.title || "(senza titolo)", 70)}\nSessione: ${oneLine(this.bridge.sessionTitle(form.sessionID), 60)}\nApri la UI web per compilarlo.${link}`,
      )
      return
    }
    if (form.sessionID !== this.config.sessionID) {
      await this.sendToAllowed(
        `📝 C'è un form in attesa nella sessione "${oneLine(this.bridge.sessionTitle(form.sessionID), 50)}".\nUsa /use per passare a quella sessione, poi /forms.`,
      )
      return
    }
    await this.startForm(form)
  }

  async startForm(form) {
    const chatID = this.config.allowedUsers[0]?.chatId
    if (!chatID) return
    if (this.formsByChat.has(chatID)) {
      await this.safeSend(chatID, "C'è già un form aperto. Usa /cancel per annullarlo.")
      return
    }

    const key = String(++this.formSeq)
    const wizard = {
      key,
      form,
      chatID,
      messageID: null,
      fieldIndex: 0,
      awaitingField: null,
      values: {},
      selections: new Map(),
    }

    this.formsByKey.set(key, wizard)
    this.formsByChat.set(chatID, wizard)
    await this.renderForm(wizard)
  }

  formField(wizard) {
    return this.visibleFields(wizard.form)[wizard.fieldIndex] ?? null
  }

  formKeyboard(wizard, field) {
    const index = wizard.fieldIndex
    const rows = []

    if (field.type === "boolean") {
      rows.push([
        { text: "Sì", callback_data: `f:${wizard.key}:b:${index}:1` },
        { text: "No", callback_data: `f:${wizard.key}:b:${index}:0` },
      ])
    } else if (field.type === "multiselect") {
      const selected = wizard.selections.get(field.key) ?? new Set()
      for (let optionIndex = 0; optionIndex < (field.options ?? []).length; optionIndex++) {
        const option = field.options[optionIndex]
        rows.push([
          {
            text: `${selected.has(option.value) ? "✅" : "⬜"} ${option.label}`,
            callback_data: `f:${wizard.key}:m:${index}:${optionIndex}`,
          },
        ])
      }
      rows.push([{ text: "➡️ Avanti", callback_data: `f:${wizard.key}:n:${index}` }])
    } else if (field.options?.length) {
      for (let optionIndex = 0; optionIndex < field.options.length; optionIndex++) {
        const option = field.options[optionIndex]
        rows.push([
          {
            text: option.label,
            callback_data: `f:${wizard.key}:o:${index}:${optionIndex}`,
          },
        ])
      }
      if (field.custom) {
        rows.push([{ text: "✏️ Altro…", callback_data: `f:${wizard.key}:t:${index}` }])
      }
    }

    if (!field.required) {
      rows.push([{ text: "⏭ Salta", callback_data: `f:${wizard.key}:k:${index}` }])
    }

    return rows.length ? { inline_keyboard: rows } : undefined
  }

  formText(wizard) {
    const fields = this.visibleFields(wizard.form)
    const field = fields[wizard.fieldIndex]

    if (!field) {
      const summary = Object.entries(wizard.values)
        .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
        .join("\n")
      return `📝 ${wizard.form.title}\n\nRiepilogo:\n${summary || "(nessun valore)"}\n\nInvia o annulla.`
    }

    const lines = [
      `📝 ${wizard.form.title}`,
      `Campo ${wizard.fieldIndex + 1}/${fields.length}: ${field.title || field.key}`,
    ]
    if (field.description) lines.push(field.description)
    if (field.placeholder && !field.options?.length) lines.push(`Esempio: ${field.placeholder}`)
    if (field.type === "external") lines.push(`Apri dal desktop: ${field.url}`)
    if (!field.required) lines.push("(facoltativo)")

    if (wizard.awaitingField === field && field.type === "string") {
      lines.push("\nScrivi il valore come messaggio.")
    } else if (field.type === "string" && !field.options?.length) {
      lines.push("\nScrivi il valore come messaggio.")
    } else if (field.type === "number" || field.type === "integer") {
      lines.push("\nScrivi un numero come messaggio.")
    } else if (field.type === "external") {
      lines.push("\nApri il link, poi incolla qui il risultato.")
    }

    return lines.join("\n")
  }

  async renderForm(wizard, notice = "") {
    const fields = this.visibleFields(wizard.form)
    const field = fields[wizard.fieldIndex] ?? null
    const text = this.prepareText(`${notice ? `${notice}\n\n` : ""}${this.formText(wizard)}`)

    if (!field) {
      const keyboard = {
        inline_keyboard: [
          [
            { text: "✅ Invia", callback_data: `f:${wizard.key}:s:0` },
            { text: "❌ Annulla", callback_data: `f:${wizard.key}:x:0` },
          ],
        ],
      }
      if (wizard.messageID) {
        await this.api
          .editMessageText(wizard.chatID, wizard.messageID, text, { reply_markup: keyboard })
          .catch(() => {})
      } else {
        const sent = await this.api.sendMessage(wizard.chatID, text, { reply_markup: keyboard })
        wizard.messageID = sent.message_id
      }
      return
    }

    const forceText = wizard.awaitingField === field
    const freeText =
      forceText ||
      (field.type === "string" && !field.options?.length) ||
      field.type === "number" ||
      field.type === "integer" ||
      field.type === "external"

    wizard.awaitingField = freeText ? field : null
    const keyboard = freeText ? undefined : this.formKeyboard(wizard, field)

    if (wizard.messageID) {
      await this.api
        .editMessageText(wizard.chatID, wizard.messageID, text, {
          ...(keyboard ? { reply_markup: keyboard } : { reply_markup: { inline_keyboard: [] } }),
        })
        .catch(async () => {
          const sent = await this.api.sendMessage(wizard.chatID, text, {
            ...(keyboard ? { reply_markup: keyboard } : {}),
          })
          wizard.messageID = sent.message_id
        })
    } else {
      const sent = await this.api.sendMessage(wizard.chatID, text, {
        ...(keyboard ? { reply_markup: keyboard } : {}),
      })
      wizard.messageID = sent.message_id
    }
  }

  async handleFormText(wizard, text) {
    const field = wizard.awaitingField
    if (!field) return

    let value
    if (field.type === "number") {
      value = Number(text.replace(",", "."))
      if (!Number.isFinite(value)) {
        await this.renderForm(wizard, "❌ Numero non valido. Riprova.")
        return
      }
    } else if (field.type === "integer") {
      if (!/^-?\d+$/.test(text.trim())) {
        await this.renderForm(wizard, "❌ Numero intero non valido. Riprova.")
        return
      }
      value = Number.parseInt(text, 10)
      if (!Number.isInteger(value)) {
        await this.renderForm(wizard, "❌ Numero intero non valido. Riprova.")
        return
      }
    } else {
      value = text
      if (field.required && !value.trim()) {
        await this.renderForm(wizard, "❌ Il campo è obbligatorio.")
        return
      }
      if (field.minLength && value.length < field.minLength) {
        await this.renderForm(wizard, `❌ Minimo ${field.minLength} caratteri.`)
        return
      }
      if (field.maxLength && value.length > field.maxLength) {
        await this.renderForm(wizard, `❌ Massimo ${field.maxLength} caratteri.`)
        return
      }
      if (field.pattern) {
        try {
          if (!new RegExp(field.pattern).test(value)) {
            await this.renderForm(wizard, "❌ Formato non valido. Riprova.")
            return
          }
        } catch {
          // pattern non valido: lascia passare, validerà il server
        }
      }
    }

    wizard.values[field.key] = value
    wizard.awaitingField = null
    wizard.fieldIndex++
    await this.renderForm(wizard)
  }

  async handleFormCallback(query, parts) {
    const wizard = this.formsByKey.get(parts[1])
    if (!wizard) {
      await this.api.answerCallbackQuery(query.id, "Form non più valido")
      return true
    }

    if (query.message?.chat?.id !== wizard.chatID) {
      await this.api.answerCallbackQuery(query.id, "Chat non valida")
      return true
    }

    const action = parts[2]
    const fieldIndex = Number(parts[3])
    const field = this.visibleFields(wizard.form)[fieldIndex]
    let notice = ""

    if (action === "x") {
      this.dropWizard(wizard)
      await this.api.answerCallbackQuery(query.id, "Annullato")
      await this.api
        .editMessageText(wizard.chatID, wizard.messageID, "❌ Form annullato. Resta in attesa sul PC.", {
          reply_markup: { inline_keyboard: [] },
        })
        .catch(() => {})
      return true
    }

    if (action === "s") {
      const missing = this.visibleFields(wizard.form).find(
        (candidate) => candidate.required && !(candidate.key in wizard.values),
      )
      if (missing) {
        wizard.fieldIndex = this.visibleFields(wizard.form).indexOf(missing)
        await this.renderForm(wizard, `❌ Manca il campo obbligatorio: ${missing.title || missing.key}`)
        await this.api.answerCallbackQuery(query.id, "Manca un campo")
        return true
      }

      const answer = {}
      for (const [key, value] of Object.entries(wizard.values)) {
        if (value !== undefined && value !== null && value !== "") answer[key] = value
      }

      try {
        await this.bridge.replyForm(wizard.form, answer)
        this.dropWizard(wizard)
        await this.api.answerCallbackQuery(query.id, "Inviato")
        await this.api
          .editMessageText(wizard.chatID, wizard.messageID, `✅ Form inviato: ${wizard.form.title}`, {
            reply_markup: { inline_keyboard: [] },
          })
          .catch(() => {})
      } catch (error) {
        await this.api.answerCallbackQuery(query.id, errorMessage(error))
      }
      return true
    }

    if (!field) {
      await this.api.answerCallbackQuery(query.id, "Campo non valido")
      return true
    }

    if (action === "o" || action === "m" || action === "k" || action === "n" || action === "t") {
      if (action === "o") {
        const option = field.options?.[Number(parts[4])]
        if (!option) {
          await this.api.answerCallbackQuery(query.id, "Opzione non valida")
          return true
        }
        wizard.values[field.key] = option.value
        wizard.fieldIndex = fieldIndex + 1
      }

      if (action === "m") {
        const option = field.options?.[Number(parts[4])]
        if (!option) {
          await this.api.answerCallbackQuery(query.id, "Opzione non valida")
          return true
        }
        const selected = wizard.selections.get(field.key) ?? new Set()
        if (selected.has(option.value)) selected.delete(option.value)
        else selected.add(option.value)
        wizard.selections.set(field.key, selected)
        await this.api.answerCallbackQuery(query.id)
        await this.renderForm(wizard)
        return true
      }

      if (action === "n") {
        const selected = [...(wizard.selections.get(field.key) ?? new Set())]
        if (field.minItems && selected.length < field.minItems) {
          await this.api.answerCallbackQuery(query.id, `Scegli almeno ${field.minItems}`)
          return true
        }
        if (field.maxItems && selected.length > field.maxItems) {
          await this.api.answerCallbackQuery(query.id, `Massimo ${field.maxItems}`)
          return true
        }
        wizard.values[field.key] = selected
        wizard.fieldIndex = fieldIndex + 1
      }

      if (action === "t") {
        wizard.awaitingField = field
        await this.api.answerCallbackQuery(query.id)
        await this.renderForm(wizard)
        return true
      }

      if (action === "k") {
        wizard.fieldIndex = fieldIndex + 1
      }

      await this.api.answerCallbackQuery(query.id)
      await this.renderForm(wizard, notice)
      return true
    }

    if (action === "b") {
      wizard.values[field.key] = parts[4] === "1"
      wizard.fieldIndex = fieldIndex + 1
      await this.api.answerCallbackQuery(query.id)
      await this.renderForm(wizard)
      return true
    }

    await this.api.answerCallbackQuery(query.id, "Azione non valida")
    return true
  }

  dropWizard(wizard) {
    this.formsByKey.delete(wizard.key)
    this.formsByChat.delete(wizard.chatID)
  }

  async onFormResolved({ form, cancelled }) {
    const wizard = [...this.formsByKey.values()].find((item) => item.form.id === form.id)
    if (!wizard) return

    this.dropWizard(wizard)
    if (!wizard.messageID) return
    await this.api
      .editMessageText(
        wizard.chatID,
        wizard.messageID,
        cancelled ? `❌ Form annullato: ${wizard.form.title}` : `✅ Form risolto: ${wizard.form.title}`,
        { reply_markup: { inline_keyboard: [] } },
      )
      .catch(() => {})
  }

  async cancelWizard(chatID) {
    const wizard = this.formsByChat.get(chatID)
    if (!wizard) {
      await this.safeSend(chatID, "Nessun form aperto.")
      return
    }
    this.dropWizard(wizard)
    await this.safeSend(chatID, "❌ Form annullato. Resta in attesa sul PC.")
  }
}
