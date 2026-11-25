const messages = {
  en: {
    headerTitle: "OpenCode Roam — configuration",
    headerLead: "Telegram is optional. The web UI is the primary transport.",
    resetDone: "Telegram users removed.",
    modePrompt: "Install mode: (1) Web/PWA only, (2) Web/PWA + Telegram",
    keepToken: "A token is already saved. Replace it? (y/n)",
    tokenVisible: "Bot token (visible, paste with Ctrl+V and press Enter)",
    tokenHidden: "Bot token (hidden input): ",
    tokenFormat: "Unrecognized format: it must start with the bot numbers, then ':', then the part after the colon.",
    tokenFormatHint: "Copy the token directly from the BotFather message, without quotes or spaces.",
    tokenRetry: "Paste the token again (Enter to exit)",
    tokenMissing: "Token missing.",
    tokenRead: "Token read: {count} characters.",
    telegramUnreachable: "Telegram is unreachable: check the internet connection and run npm run setup again.",
    telegramRejected: "Telegram rejected the token (attempt {attempt}/3): {error}",
    tokenRejected: "Token not accepted. Copy it again from BotFather and run npm run setup again.",
    botLabel: "Bot: @{username}",
    alreadyPaired: "Already paired with {name} ({id}). Pair again? (y/n)",
    pairingSkipped: "Pairing skipped.",
    pairCode: "Pairing code: {code}  (valid for 10 minutes)",
    pairOpen: "Open Telegram, search @{username}, press START and send:",
    pairNoButton: "There is no button: paste /pair <code> in the message field and press Enter.",
    pairWaiting: "Waiting… (make sure the bot is not already running)",
    pairNotCompleted: "Pairing not completed. Run npm run setup again when you want.",
    telegramConnected: "Telegram connected.",
    telegramMode: "Telegram mode: (c) full chat, (n) finish notifications only",
    webEnable: "Enable the web UI/PWA? (y/n)",
    webUrl: "Web UI URL over Tailscale (optional, e.g. https://<host>.<tailnet>.ts.net)",
    chooseSessionError: "OpenCode is not running: the session will be chosen on first start.",
    cannotReadSessions: "Cannot read sessions: {error}",
    noRecentSessions: "No recent sessions: the session will be chosen on first start.",
    recentSessions: "Recent sessions:",
    chooseSession: "Choose the default session (1-{count})",
    untitled: "(untitled)",
    configSaved: "Configuration saved.",
    configFile: "File: {path}",
    configSession: "Session: {session}",
    chosenOnFirstStart: "(chosen on first start)",
    configDirectory: "Directory: {path}",
    configTelegram: "Telegram: {value}",
    telegramDisabled: "disabled",
    telegramNotify: "notify only",
    telegramFull: "full chat",
    configRedaction: "Redaction: {value}",
    on: "on",
    off: "off",
    configWeb: "Web: {value}",
    webDisabled: "disabled",
    webLink: "Web link (contains a secret, do not share):\n{url}",
    tailscaleServe: "Tailscale Serve: tailscale serve --bg http://127.0.0.1:{port}",
    tailscaleUrl: "Tailscale URL: {url}",
    start: "Start with: npm start",
    keepAwake: "Keep the PC awake while you need remote access.",
    botRunning: "The bot is already running. Stop it (Ctrl+C in its window) and run npm run setup again.",
    startPair: "Hello. Send me /pair <code> (the code is on the PC).",
    wrongCode: "Wrong code.",
    pairSuccess: "✅ Pairing complete, {name}.",
    setupHelp: `Usage: npm run setup [-- --web-only|--telegram] [--reset] [--token-file <file>] [--no-pair] [--token-hidden] [--lang en|it]

  --web-only      configure only the web UI/PWA (no Telegram bot)
  --telegram      configure the web UI/PWA and Telegram
  --reset         remove Telegram users already paired
  --token-file    read the Telegram bot token from a file
  --no-pair       save token and session without pairing
  --token-hidden  ask for the Telegram token without showing it (default: visible)
  --lang          setup language: en or it (default: system)

Without --web-only or --telegram, the setup asks which mode to use.`,
  },
  it: {
    headerTitle: "OpenCode Roam — configurazione",
    headerLead: "Telegram è opzionale. La web UI è il trasporto principale.",
    resetDone: "Utenti Telegram rimossi.",
    modePrompt: "Modalità: (1) Solo Web/PWA, (2) Web/PWA + Telegram",
    keepToken: "C'è già un token salvato. Vuoi sostituirlo? (s/n)",
    tokenVisible: "Token del bot (visibile, incolla con Ctrl+V e premi Invio)",
    tokenHidden: "Token del bot (input nascosto): ",
    tokenFormat: "Formato non riconosciuto: deve iniziare con i numeri del bot, poi ':', poi la parte dopo i due punti.",
    tokenFormatHint: "Copia il token direttamente dal messaggio di BotFather, senza virgolette o spazi.",
    tokenRetry: "Incolla il token di nuovo (Invio per uscire)",
    tokenMissing: "Token mancante.",
    tokenRead: "Token letto: {count} caratteri.",
    telegramUnreachable: "Telegram non è raggiungibile: controlla la connessione internet e rilancia npm run setup.",
    telegramRejected: "Telegram ha rifiutato il token (tentativo {attempt}/3): {error}",
    tokenRejected: "Token non accettato. Copialo di nuovo da BotFather e rilancia npm run setup.",
    botLabel: "Bot: @{username}",
    alreadyPaired: "Già collegato a {name} ({id}). Ricollegare? (s/n)",
    pairingSkipped: "Pairing saltato.",
    pairCode: "Codice di pairing: {code}  (valido 10 minuti)",
    pairOpen: "Apri Telegram, cerca @{username}, premi START e invia:",
    pairNoButton: "Non c'è nessun pulsante: incolla /pair <codice> nel campo messaggio e premi Invio.",
    pairWaiting: "In attesa… (assicurati che il bot non sia già in esecuzione)",
    pairNotCompleted: "Pairing non completato. Rilancia npm run setup quando vuoi.",
    telegramConnected: "Telegram collegato.",
    telegramMode: "Modalità Telegram: (c) chat completa, (n) solo notifiche di fine",
    webEnable: "Abilitare la web UI/PWA? (s/n)",
    webUrl: "URL della web UI su Tailscale (opzionale, es. https://<host>.<tailnet>.ts.net)",
    chooseSessionError: "Servizio OpenCode non attivo: la sessione verrà scelta al primo avvio.",
    cannotReadSessions: "Non riesco a leggere le sessioni: {error}",
    noRecentSessions: "Nessuna sessione recente: verrà scelta al primo avvio.",
    recentSessions: "Sessioni recenti:",
    chooseSession: "Scegli la sessione predefinita (1-{count})",
    untitled: "(senza titolo)",
    configSaved: "Configurazione salvata.",
    configFile: "File: {path}",
    configSession: "Sessione: {session}",
    chosenOnFirstStart: "(scelta al primo avvio)",
    configDirectory: "Cartella: {path}",
    configTelegram: "Telegram: {value}",
    telegramDisabled: "disattivato",
    telegramNotify: "solo notifiche",
    telegramFull: "chat completa",
    configRedaction: "Redazione: {value}",
    on: "attiva",
    off: "disattiva",
    configWeb: "Web: {value}",
    webDisabled: "disattivata",
    webLink: "Link web (contiene un segreto, non condividerlo):\n{url}",
    tailscaleServe: "Tailscale Serve: tailscale serve --bg http://127.0.0.1:{port}",
    tailscaleUrl: "URL Tailscale: {url}",
    start: "Avvio: npm start",
    keepAwake: "Tieni il PC sveglio quando ti serve l'accesso remoto.",
    botRunning: "Il bot è già in esecuzione. Fermalo (Ctrl+C nella sua finestra) e rilancia npm run setup.",
    startPair: "Ciao. Inviami /pair <codice> (il codice è sul PC).",
    wrongCode: "Codice errato.",
    pairSuccess: "✅ Collegamento riuscito, {name}.",
    setupHelp: `Uso: npm run setup [-- --web-only|--telegram] [--reset] [--token-file <file>] [--no-pair] [--token-hidden] [--lang en|it]

  --web-only      configura solo la web UI/PWA (senza bot Telegram)
  --telegram      configura web UI/PWA e Telegram
  --reset         rimuove gli utenti Telegram già collegati
  --token-file    legge il token del bot Telegram da un file
  --no-pair       salva token e sessione senza pairing
  --token-hidden  chiede il token Telegram senza mostrarlo (default: visibile)
  --lang          lingua del setup: en o it (default: sistema)

Senza --web-only o --telegram, il setup chiede quale modalità usare.`,
  },
}

export function resolveSetupLanguage(args = process.argv.slice(2)) {
  const index = args.indexOf("--lang")
  const explicit = index >= 0 ? args[index + 1] : process.env.OPENCODE_ROAM_LANG
  if (explicit) {
    return /^it/i.test(String(explicit).trim()) ? "it" : "en"
  }

  const locale =
    process.env.LC_ALL ||
    process.env.LC_MESSAGES ||
    process.env.LANG ||
    Intl.DateTimeFormat().resolvedOptions().locale ||
    "en"
  return /^it/i.test(locale) ? "it" : "en"
}

export function createTranslator(language) {
  const table = messages[language] || messages.en
  return (key, vars = {}) => {
    const value = table[key] ?? messages.en[key] ?? key
    return String(value).replace(/\{(\w+)\}/g, (match, name) =>
      vars[name] == null ? match : String(vars[name]),
    )
  }
}

export function isYes(value) {
  return /^(s|y)/i.test(String(value ?? "").trim())
}

export function isNo(value) {
  return /^(n)/i.test(String(value ?? "").trim())
}
