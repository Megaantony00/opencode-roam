/*
 * Minimal browser i18n shared by the chat, landing, offline and PWA check pages.
 * The selected language is stored in localStorage; "system" follows the browser.
 */
(function () {
  const STORAGE_KEY = "ocb-lang"
  const SUPPORTED = ["en", "it"]

  const messages = {
    en: {
      "common.untitled": "(untitled)",
      "common.remove": "Remove",
      "common.removeNamed": "Remove {name}",

      "status.connecting": "connecting…",
      "status.connected": "connected",
      "status.busy": "running",
      "status.offline": "offline",

      "header.sessionAria": "Active session",
      "header.settingsAria": "Settings",

      "vpn.title": "Connection lost",
      "vpn.message": "Tailscale or the PC/bot is unreachable.",
      "vpn.open": "Open Tailscale",
      "vpn.retry": "Retry",

      "composer.placeholder": "Message OpenCode…",
      "composer.busy": "OpenCode is working…",
      "composer.noSession": "No active session",
      "composer.send": "Send",
      "composer.attach": "Attach files",
      "composer.attachTitle": "Attach files",

      "quote.selection": "❝ Quote selection",
      "quote.jumpTitle": "Go to the original message",
      "quote.notFound": "Original message not found in the loaded history.",

      "permission.title": "🔐 Permission required",
      "permission.session": "Session",
      "permission.action": "Action",
      "permission.resource": "Resource",
      "permission.reason": "Reason",
      "permission.once": "✅ Once",
      "permission.always": "♾️ Always",
      "permission.reject": "❌ Deny",
      "permission.resolved": "Resolved",

      "form.title": "📝 {title}",
      "form.choose": "Choose…",
      "form.none": "(none)",
      "form.yes": "Yes",
      "form.no": "No",
      "form.other": "Other…",
      "form.writeValue": "Type the value",
      "form.submit": "✅ Submit",
      "form.required": "Required field: {field}",
      "form.minOptions": "Choose at least {min} options for {field}",
      "form.maxOptions": "At most {max} options for {field}",
      "form.invalidNumber": "Invalid number for {field}",
      "form.invalidInteger": "Invalid integer for {field}",
      "form.cancelled": "❌ Form cancelled",
      "form.sent": "✅ Form submitted",
      "form.resolved": "Resolved",

      "error.sessionUnavailable": "Session unavailable: {error}",
      "error.readFile": "Could not read {name}",
      "error.tooLarge": "Attachments too large: maximum {size} in total.",
      "error.busyWait": "OpenCode is working: wait for the turn to finish.",
      "error.updateCheck": "Could not check for updates.",
      "notice.newVersion": "A new version is ready: reload when you are done.",

      "server.too_large": "Request too large",
      "server.invalid_json": "Invalid JSON",
      "server.internal": "Internal error",
      "server.missing_session": "Session missing",
      "server.content_type_required": "application/json content type required",
      "server.busy": "OpenCode is working: wait for the turn to finish.",
      "server.empty_message": "Empty message",
      "server.message_too_long": "Message too long",
      "server.invalid_attachment": "Invalid attachment",
      "server.attachment_too_large": "Attachment too large",
      "server.attachment_name_too_long": "Attachment name too long",
      "server.permission_invalid": "Request is no longer valid",
      "server.decision_invalid": "Invalid decision",
      "server.form_invalid": "Form is no longer valid",
      "server.answer_invalid": "Invalid answer",
      "server.not_found": "Not found",
      "server.update_check_failed": "Could not check for updates.",
      "server.history_failed": "Could not load the history.",
      "server.prompt_failed": "Could not send the prompt.",
      "server.permission_failed": "Could not send the permission decision.",
      "server.form_failed": "Could not send the form.",
      "server.session_unavailable": "Session unavailable.",
      "server.http": "HTTP {status}",

      "settings.title": "Settings",
      "settings.language": "Language",
      "settings.languageSystem": "System default",
      "settings.languageItalian": "Italiano",
      "settings.languageEnglish": "English",
      "settings.version": "Version",
      "settings.checkUpdates": "Check for updates",
      "settings.checking": "Checking…",
      "settings.upToDate": "You are up to date (version {version}).",
      "settings.updateAvailable": "Version {version} is available.",
      "settings.updateError": "Could not check for updates. Try again later.",
      "settings.github": "GitHub repository",
      "settings.openGitHub": "Open the GitHub repository",
      "settings.close": "Close",
      "settings.languageNote": "In the Android app, the language follows the app settings.",
      "settings.webUpdateHint": "To update the bridge: git pull, npm install, restart.",
      "settings.openRelease": "Open release page",
      "settings.unknownVersion": "unknown",

      "landing.eyebrow": "Private access",
      "landing.lead": "Chat with OpenCode and approve requests from your phone. No messages are shown here: open the chat when you want.",
      "landing.session": "Session: {title}",
      "landing.none": "none",
      "landing.openChat": "Open chat",
      "landing.vpnTitle": "Connection unavailable",
      "landing.vpnMessage": "Tailscale or the PC/bot is unreachable.",
      "landing.openTailscale": "Open Tailscale",
      "landing.retry": "Retry",
      "landing.footnote1": "Available only inside your Tailscale tailnet. Notifications arrive on Telegram.",
      "landing.pwaReady": "PWA ready",
      "landing.pwaPreparing": "PWA preparing",
      "landing.pwaUnavailable": "PWA unavailable",
      "landing.pwaUnsupported": "PWA not supported",
      "landing.pwaCheck": "PWA check",
      "landing.installHint": "Install it from the Chrome menu, not from the Telegram browser.",

      "offline.title": "Connection unavailable",
      "offline.lead": "Tailscale is off, or the PC/bot is powered off.",
      "offline.hint": "Turn the VPN on, then come back: the app retries by itself.",
      "offline.openTailscale": "Open Tailscale",
      "offline.retry": "Retry",
      "offline.checking": "Checking connection…",
      "offline.connected": "Connected. Returning to the app…",
      "offline.failed": "Still unreachable. Turn on Tailscale and try again.",
      "offline.footnote1": "If Tailscale is not installed,",
      "offline.footnoteLink": "get it from the Play Store",
      "offline.footnote2": ". On iPhone, open the Tailscale app manually.",

      "pwa.title": "PWA check",
      "pwa.lead": "Browser diagnostics. Open this page from the phone and, if installation fails, send a screenshot of the result.",
      "pwa.running": "checks in progress…",
      "pwa.back": "Back to the landing page",
      "pwa.absent": "missing",
      "pwa.yes": "yes",
      "pwa.none": "none",
      "pwa.decoded": "decoded {width}x{height}",
      "pwa.decodeFailed": "DECODE FAILED",
      "pwa.error": "error {message}",
      "pwa.notReceived": "not received",
    },
    it: {
      "common.untitled": "(senza titolo)",
      "common.remove": "Rimuovi",
      "common.removeNamed": "Rimuovi {name}",

      "status.connecting": "connessione…",
      "status.connected": "connesso",
      "status.busy": "in esecuzione",
      "status.offline": "offline",

      "header.sessionAria": "Sessione attiva",
      "header.settingsAria": "Impostazioni",

      "vpn.title": "Connessione persa",
      "vpn.message": "Tailscale o PC/bot non raggiungibile.",
      "vpn.open": "Apri Tailscale",
      "vpn.retry": "Riprova",

      "composer.placeholder": "Scrivi a OpenCode…",
      "composer.busy": "OpenCode sta lavorando…",
      "composer.noSession": "Nessuna sessione attiva",
      "composer.send": "Invia",
      "composer.attach": "Allega file",
      "composer.attachTitle": "Allega file",

      "quote.selection": "❝ Cita selezione",
      "quote.jumpTitle": "Vai al messaggio originale",
      "quote.notFound": "Messaggio originale non trovato nella cronologia caricata.",

      "permission.title": "🔐 Permesso richiesto",
      "permission.session": "Sessione",
      "permission.action": "Azione",
      "permission.resource": "Risorsa",
      "permission.reason": "Motivo",
      "permission.once": "✅ Una volta",
      "permission.always": "♾️ Sempre",
      "permission.reject": "❌ Nega",
      "permission.resolved": "Risolto",

      "form.title": "📝 {title}",
      "form.choose": "Scegli…",
      "form.none": "(nessuno)",
      "form.yes": "Sì",
      "form.no": "No",
      "form.other": "Altro…",
      "form.writeValue": "Scrivi il valore",
      "form.submit": "✅ Invia",
      "form.required": "Campo obbligatorio: {field}",
      "form.minOptions": "Scegli almeno {min} opzioni per {field}",
      "form.maxOptions": "Massimo {max} opzioni per {field}",
      "form.invalidNumber": "Numero non valido per {field}",
      "form.invalidInteger": "Numero intero non valido per {field}",
      "form.cancelled": "❌ Form annullato",
      "form.sent": "✅ Form inviato",
      "form.resolved": "Risolto",

      "error.sessionUnavailable": "Sessione non disponibile: {error}",
      "error.readFile": "Lettura di {name} fallita",
      "error.tooLarge": "Allegati troppo grandi: massimo {size} totali.",
      "error.busyWait": "OpenCode sta lavorando: attendi la fine del turno.",
      "error.updateCheck": "Impossibile controllare gli aggiornamenti.",
      "notice.newVersion": "Nuova versione pronta: ricarica quando hai finito.",

      "server.too_large": "Richiesta troppo grande",
      "server.invalid_json": "JSON non valido",
      "server.internal": "Errore interno",
      "server.missing_session": "Sessione mancante",
      "server.content_type_required": "Content-Type application/json richiesto",
      "server.busy": "OpenCode sta lavorando: attendi la fine del turno.",
      "server.empty_message": "Messaggio vuoto",
      "server.message_too_long": "Messaggio troppo lungo",
      "server.invalid_attachment": "Allegato non valido",
      "server.attachment_too_large": "Allegato troppo grande",
      "server.attachment_name_too_long": "Nome allegato troppo lungo",
      "server.permission_invalid": "Richiesta non più valida",
      "server.decision_invalid": "Decisione non valida",
      "server.form_invalid": "Form non più valido",
      "server.answer_invalid": "Risposta non valida",
      "server.not_found": "Non trovato",
      "server.update_check_failed": "Impossibile controllare gli aggiornamenti.",
      "server.history_failed": "Impossibile caricare la cronologia.",
      "server.prompt_failed": "Impossibile inviare il prompt.",
      "server.permission_failed": "Impossibile inviare la decisione.",
      "server.form_failed": "Impossibile inviare il form.",
      "server.session_unavailable": "Sessione non disponibile.",
      "server.http": "HTTP {status}",

      "settings.title": "Impostazioni",
      "settings.language": "Lingua",
      "settings.languageSystem": "Lingua di sistema",
      "settings.languageItalian": "Italiano",
      "settings.languageEnglish": "English",
      "settings.version": "Versione",
      "settings.checkUpdates": "Controlla aggiornamenti",
      "settings.checking": "Controllo…",
      "settings.upToDate": "Sei aggiornato (versione {version}).",
      "settings.updateAvailable": "Versione {version} disponibile.",
      "settings.updateError": "Impossibile controllare gli aggiornamenti. Riprova più tardi.",
      "settings.github": "Repository GitHub",
      "settings.openGitHub": "Apri il repository GitHub",
      "settings.close": "Chiudi",
      "settings.languageNote": "Nel wrapper Android la lingua segue le impostazioni dell’app.",
      "settings.webUpdateHint": "Per aggiornare il bridge: git pull, npm install, riavvia.",
      "settings.openRelease": "Apri la pagina release",
      "settings.unknownVersion": "sconosciuta",

      "landing.eyebrow": "Accesso privato",
      "landing.lead": "La chat con OpenCode e le approvazioni, dal tuo telefono. Nessun messaggio viene mostrato qui: apri la chat quando vuoi.",
      "landing.session": "Sessione: {title}",
      "landing.none": "nessuna",
      "landing.openChat": "Apri la chat",
      "landing.vpnTitle": "Connessione non disponibile",
      "landing.vpnMessage": "Tailscale o PC/bot non raggiungibile.",
      "landing.openTailscale": "Apri Tailscale",
      "landing.retry": "Riprova",
      "landing.footnote1": "Disponibile solo dentro il tuo tailnet Tailscale. Le notifiche arrivano su Telegram.",
      "landing.pwaReady": "PWA pronta",
      "landing.pwaPreparing": "PWA in preparazione",
      "landing.pwaUnavailable": "PWA non disponibile",
      "landing.pwaUnsupported": "PWA non supportata",
      "landing.pwaCheck": "Diagnostica PWA",
      "landing.installHint": "Per installarla usa il menu di Chrome, non il browser di Telegram.",

      "offline.title": "Connessione non disponibile",
      "offline.lead": "Tailscale non è attivo, oppure il PC o il bot sono spenti.",
      "offline.hint": "Attiva la VPN, poi torna qui: l’app riprova da sola.",
      "offline.openTailscale": "Apri Tailscale",
      "offline.retry": "Riprova",
      "offline.checking": "Controllo connessione…",
      "offline.connected": "Connesso. Torno all’app…",
      "offline.failed": "Ancora non raggiungibile. Attiva Tailscale e riprova.",
      "offline.footnote1": "Se Tailscale non è installato,",
      "offline.footnoteLink": "scaricalo dal Play Store",
      "offline.footnote2": ". Su iPhone apri l’app Tailscale manualmente.",

      "pwa.title": "PWA check",
      "pwa.lead": "Diagnostica del browser. Apri questa pagina dal telefono e, se l’installazione non funziona, invia uno screenshot del risultato.",
      "pwa.running": "controlli in corso…",
      "pwa.back": "Torna alla landing",
      "pwa.absent": "assente",
      "pwa.yes": "sì",
      "pwa.none": "nessuna",
      "pwa.decoded": "decodificata {width}x{height}",
      "pwa.decodeFailed": "DECODIFICA FALLITA",
      "pwa.error": "errore {message}",
      "pwa.notReceived": "non ricevuto",
    },
  }

  function normalizeLanguage(value) {
    const text = String(value || "").toLowerCase()
    if (text.startsWith("it")) return "it"
    if (text.startsWith("en")) return "en"
    return ""
  }

  function systemLanguage() {
    const list =
      navigator.languages && navigator.languages.length
        ? navigator.languages
        : [navigator.language || "en"]
    for (const item of list) {
      const value = normalizeLanguage(item)
      if (value) return value
    }
    return "en"
  }

  function savedPreference() {
    try {
      const value = localStorage.getItem(STORAGE_KEY)
      if (value === "system") return "system"
      return normalizeLanguage(value) || "system"
    } catch {
      return "system"
    }
  }

  let preference = savedPreference()

  try {
    const params = new URLSearchParams(location.search)
    const fromQuery = normalizeLanguage(params.get("lang"))
    if (fromQuery) {
      preference = fromQuery
      localStorage.setItem(STORAGE_KEY, fromQuery)
      params.delete("lang")
      const query = params.toString()
      history.replaceState({}, "", location.pathname + (query ? `?${query}` : ""))
    }
  } catch {
    // localStorage may be disabled; the system language is still used.
  }

  const language = preference === "system" ? systemLanguage() : preference

  function t(key, vars = {}) {
    const table = messages[language] || messages.en
    let text = table[key]
    if (text == null) text = messages.en[key]
    if (text == null) return key
    return text.replace(/\{(\w+)\}/g, (match, name) =>
      vars[name] == null ? match : String(vars[name]),
    )
  }

  function apply(root = document) {
    if (document.documentElement) document.documentElement.lang = language
    for (const element of root.querySelectorAll("[data-i18n]")) {
      element.textContent = t(element.dataset.i18n)
    }
    for (const element of root.querySelectorAll("[data-i18n-placeholder]")) {
      element.placeholder = t(element.dataset.i18nPlaceholder)
    }
    for (const element of root.querySelectorAll("[data-i18n-title]")) {
      element.title = t(element.dataset.i18nTitle)
    }
    for (const element of root.querySelectorAll("[data-i18n-aria-label]")) {
      element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel))
    }
  }

  function setLanguage(value) {
    let next = "system"
    if (value === "it" || value === "en") next = value
    try {
      if (next === "system") localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // The reload below still applies the system language.
    }
    location.reload()
  }

  window.RoamI18n = {
    language,
    preference,
    t,
    apply,
    setLanguage,
    systemLanguage,
    storageKey: STORAGE_KEY,
  }
})()
