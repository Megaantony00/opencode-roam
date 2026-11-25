const i18n = window.RoamI18n
const t = (key, vars) => i18n.t(key, vars)
i18n.apply()

const chat = document.getElementById("chat")
const composer = document.getElementById("composer")
const input = document.getElementById("input")
const sendButton = document.getElementById("send")
const attachButton = document.getElementById("attach")
const filesInput = document.getElementById("files")
const attachmentsBox = document.getElementById("attachments")
const sessionsSelect = document.getElementById("sessions")
const statusBadge = document.getElementById("status")
const dot = document.getElementById("dot")
const header = document.querySelector("header")
const quoteSelectionButton = document.getElementById("quote-selection")
const vpnBanner = document.getElementById("vpn-banner")
const vpnOpen = document.getElementById("vpn-open")
const vpnRetry = document.getElementById("vpn-retry")
const versionBadge = document.getElementById("version")
const settingsOpen = document.getElementById("settings-open")
const settingsDialog = document.getElementById("settings-dialog")
const languageSelect = document.getElementById("language-select")
const settingsVersion = document.getElementById("settings-version")
const checkUpdatesButton = document.getElementById("check-updates")
const updateStatus = document.getElementById("update-status")
const githubLink = document.getElementById("github-link")

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
const DRAFT_KEY = "ocb-draft"

let entries = []
const nodes = new Map()
const historyBySession = new Map()
const loadingHistory = new Set()
const previewUrls = new Map()
let selectedFiles = []
let state = null
let lastActiveID = null
let sending = false
let deepLinkDone = false
let pendingQuote = ""
let floatingQuoteText = ""
let lastViewSent = 0
let lastScrollY = window.scrollY
let headerHidden = false
let eventSource = null
let reconnectTimer = null

function h(tag, props = {}, ...children) {
  const element = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") element.className = value
    else if (key === "text") element.textContent = value
    else if (key.startsWith("on") && typeof value === "function") {
      element.addEventListener(key.slice(2).toLowerCase(), value)
    } else if (value === true) element.setAttribute(key, "")
    else if (value !== false && value != null) element.setAttribute(key, String(value))
  }
  for (const child of children.flat(4)) {
    if (child == null || child === false) continue
    element.append(child.nodeType ? child : document.createTextNode(String(child)))
  }
  return element
}

function nearBottom() {
  return window.innerHeight + window.scrollY >= document.body.scrollHeight - 180
}

function currentScroll() {
  return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0
}

function setHeaderHidden(hidden) {
  if (hidden === headerHidden) return
  headerHidden = hidden
  header.classList.toggle("header-hidden", hidden)
}

function scrollToBottom() {
  const target = Math.max(0, document.body.scrollHeight - window.innerHeight)
  window.scrollTo({ top: target, behavior: "instant" })
  lastScrollY = target
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function errorText(data, status) {
  const code = String(data?.code ?? "")
  if (code) {
    const key = `server.${code}`
    const translated = t(key)
    if (translated !== key) return translated
  }
  if (data?.error) return String(data.error)
  return t("server.http", { status })
}

async function post(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  let data = {}
  try {
    data = await response.json()
  } catch {
    data = {}
  }
  if (!response.ok) throw new Error(errorText(data, response.status))
  return data
}

function localEntry(kind, text) {
  const entry = {
    id: `local-${Date.now()}-${Math.random()}`,
    kind,
    text,
    time: Date.now(),
  }
  upsert(entry)
}

function permissionDetails(entry) {
  const hasDetails =
    entry.sessionTitle || entry.action || entry.reason || (entry.resources && entry.resources.length)
  if (!hasDetails) return entry.text

  const lines = []
  if (entry.sessionTitle) lines.push(`${t("permission.session")}: ${entry.sessionTitle}`)
  if (entry.action) lines.push(`${t("permission.action")}: ${entry.action}`)
  if (entry.resources?.length) {
    lines.push(`${t("permission.resource")}: ${entry.resources.join(", ")}`)
  }
  if (entry.reason) lines.push(`${t("permission.reason")}: ${entry.reason}`)
  return lines.join("\n") || entry.text
}

function permissionResult(entry) {
  if (entry.resultCode === "once") return t("permission.once")
  if (entry.resultCode === "always") return t("permission.always")
  if (entry.resultCode === "reject") return t("permission.reject")
  return entry.result || t("permission.resolved")
}

function permissionCard(entry) {
  const card = h(
    "section",
    { class: `card${entry.resolved ? " resolved" : ""}` },
    h("h3", {}, t("permission.title")),
    h("div", { class: "meta", text: permissionDetails(entry) }),
  )

  if (entry.resolved) {
    card.append(h("div", { class: "meta", text: `\n${permissionResult(entry)}` }))
    return card
  }

  const actions = h("div", { class: "actions" })
  const buttons = []

  const add = (label, decision, className) => {
    const button = h(
      "button",
      {
        class: className,
        type: "button",
        onclick: async () => {
          for (const item of buttons) item.disabled = true
          try {
            await post("/api/permission", { key: entry.key, decision })
          } catch (error) {
            localEntry("error", error.message)
            for (const item of buttons) item.disabled = false
          }
        },
      },
      label,
    )
    buttons.push(button)
    actions.append(button)
  }

  add(t("permission.once"), "once", "ok")
  add(t("permission.always"), "always", "")
  add(t("permission.reject"), "reject", "danger")

  card.append(actions)
  return card
}

function fieldControl(field) {
  const title = field.title || field.key
  const help = field.description ? h("span", { class: "meta", text: field.description }) : null

  if (field.type === "boolean") {
    const select = h(
      "select",
      { name: field.key },
      h("option", { value: "" }, field.required ? t("form.choose") : t("form.none")),
      h("option", { value: "true" }, t("form.yes")),
      h("option", { value: "false" }, t("form.no")),
    )
    if (field.default === true) select.value = "true"
    if (field.default === false) select.value = "false"
    return h("label", {}, title, help, select)
  }

  if (field.type === "multiselect") {
    const select = h("select", { name: field.key, multiple: true })
    for (const option of field.options || []) {
      const element = h("option", { value: option.value }, option.label)
      if ((field.default || []).includes(option.value)) element.selected = true
      select.append(element)
    }
    return h("label", {}, title, help, select)
  }

  if (field.options?.length) {
    const select = h("select", { name: field.key })
    select.append(h("option", { value: "" }, field.required ? t("form.choose") : t("form.none")))
    for (const option of field.options) {
      const element = h("option", { value: option.value }, option.label)
      if (field.default === option.value) element.selected = true
      select.append(element)
    }

    if (field.custom) {
      select.append(h("option", { value: "__custom__" }, t("form.other")))
      const custom = h("input", {
        name: `${field.key}__custom`,
        type: "text",
        placeholder: t("form.writeValue"),
      })
      return h("label", {}, title, help, select, custom)
    }

    return h("label", {}, title, help, select)
  }

  const type = field.type === "number" || field.type === "integer" ? "number" : "text"
  const element = h("input", {
    name: field.key,
    type,
    placeholder: field.placeholder || "",
    value: field.default ?? "",
  })
  if (field.required) element.required = true
  if (field.type === "integer") element.step = "1"
  return h("label", {}, title, help, element)
}

function formCard(entry) {
  const card = h(
    "section",
    { class: `card${entry.resolved ? " resolved" : ""}` },
    h("h3", {}, t("form.title", { title: entry.form.title || "Form" })),
  )

  if (entry.resolved) {
    const result =
      entry.resultCode === "cancelled"
        ? t("form.cancelled")
        : entry.resultCode === "sent"
          ? t("form.sent")
          : entry.result || t("form.resolved")
    card.append(h("div", { class: "meta", text: result }))
    return card
  }

  const form = h("form")
  const fields = (entry.form.fields || []).filter((field) => !field.hidden)
  for (const field of fields) form.append(fieldControl(field))

  const errorLine = h("div", { class: "meta" })
  const actions = h(
    "div",
    { class: "actions" },
    h("button", { class: "ok", type: "submit" }, t("form.submit")),
  )

  form.append(errorLine, actions)
  form.addEventListener("submit", async (event) => {
    event.preventDefault()
    errorLine.textContent = ""

    const answer = {}
    for (const field of fields) {
      if (field.type === "boolean") {
        const control = form.elements.namedItem(field.key)
        if (!control || control.value === "") {
          if (field.required) return (errorLine.textContent = t("form.required", { field: field.title || field.key }))
          continue
        }
        answer[field.key] = control.value === "true"
        continue
      }

      if (field.type === "multiselect") {
        const control = form.elements.namedItem(field.key)
        const values = control ? [...control.selectedOptions].map((option) => option.value) : []
        const min = field.minItems ?? (field.required ? 1 : 0)
        if (values.length < min) {
          return (errorLine.textContent = t("form.minOptions", {
            min,
            field: field.title || field.key,
          }))
        }
        if (field.maxItems && values.length > field.maxItems) {
          return (errorLine.textContent = t("form.maxOptions", {
            max: field.maxItems,
            field: field.title || field.key,
          }))
        }
        if (values.length) answer[field.key] = values
        continue
      }

      const control = form.elements.namedItem(field.key)
      let value = control ? control.value : ""
      if (value === "__custom__") {
        const custom = form.elements.namedItem(`${field.key}__custom`)
        value = custom ? custom.value : ""
      }

      if (value === "") {
        if (field.required) return (errorLine.textContent = t("form.required", { field: field.title || field.key }))
        continue
      }

      if (field.type === "number" || field.type === "integer") {
        const number = Number(value)
        if (!Number.isFinite(number)) {
          return (errorLine.textContent = t("form.invalidNumber", { field: field.title || field.key }))
        }
        if (field.type === "integer" && !Number.isInteger(number)) {
          return (errorLine.textContent = t("form.invalidInteger", { field: field.title || field.key }))
        }
        answer[field.key] = number
      } else {
        answer[field.key] = value
      }
    }

    const submit = form.querySelector("button[type=submit]")
    submit.disabled = true
    try {
      await post("/api/form", { key: entry.key, answer })
    } catch (error) {
      errorLine.textContent = error.message
      submit.disabled = false
    }
  })

  card.append(form)
  return card
}

function selectedTextInChat() {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed) return ""
  const text = selection.toString().trim()
  if (!text) return ""

  const node = selection.anchorNode
  const element = node?.nodeType === 3 ? node.parentElement : node
  if (element && chat.contains(element)) return text
  return ""
}

function updateFloatingQuote() {
  const text = selectedTextInChat()
  if (text) {
    floatingQuoteText = text
    quoteSelectionButton.hidden = false
  } else {
    floatingQuoteText = ""
    quoteSelectionButton.hidden = true
  }
}

document.addEventListener("selectionchange", updateFloatingQuote)
window.addEventListener(
  "touchend",
  () => {
    setTimeout(updateFloatingQuote, 80)
  },
  { passive: true },
)

quoteSelectionButton.addEventListener("pointerdown", () => {
  floatingQuoteText = selectedTextInChat() || floatingQuoteText
})

quoteSelectionButton.addEventListener("click", () => {
  const text = floatingQuoteText
  if (!text) return
  quoteEntry({ text, kind: "assistant" }, text)
  floatingQuoteText = ""
  quoteSelectionButton.hidden = true
  window.getSelection()?.removeAllRanges()
})

function renderInline(text) {
  const fragment = document.createDocumentFragment()
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g
  let lastIndex = 0

  for (const match of text.matchAll(pattern)) {
    if (match.index > lastIndex) {
      fragment.append(document.createTextNode(text.slice(lastIndex, match.index)))
    }

    const token = match[0]
    if (token.startsWith("`")) {
      fragment.append(h("code", {}, token.slice(1, -1)))
    } else if (token.startsWith("**")) {
      fragment.append(h("strong", {}, token.slice(2, -2)))
    } else if (token.startsWith("*") || token.startsWith("_")) {
      fragment.append(h("em", {}, token.slice(1, -1)))
    } else {
      const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(token)
      if (link) {
        fragment.append(
          h("a", { href: link[2], target: "_blank", rel: "noopener noreferrer" }, link[1]),
        )
      } else {
        fragment.append(document.createTextNode(token))
      }
    }

    lastIndex = match.index + token.length
  }

  if (lastIndex < text.length) fragment.append(document.createTextNode(text.slice(lastIndex)))
  return fragment
}

function parseTableRow(row) {
  let value = String(row ?? "").trim()
  if (value.startsWith("|")) value = value.slice(1)
  if (value.endsWith("|")) value = value.slice(0, -1)
  return value.split("|").map((cell) => cell.trim())
}

function cleanUserText(text) {
  return String(text ?? "")
    .replace(/^The user quoted the following from earlier in the conversation:\s*/i, "")
    .replace(/The user made the following comment regarding this quote:\s*/i, "")
    .trim()
}

function isTableSeparator(row, columns) {
  if (typeof row !== "string") return false
  const cells = parseTableRow(row)
  return cells.length === columns && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function renderMarkdown(text) {
  const fragment = document.createDocumentFragment()
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n")
  let index = 0

  const isBlockStart = (line) =>
    /^\s*(```|#{1,6}\s|>\s?|[-*+]\s|\d+\.\s|---+\s*$)/.test(line)

  const isTableStart = (lineIndex) => {
    const candidate = lines[lineIndex]
    if (!candidate || !candidate.includes("|")) return false
    return isTableSeparator(lines[lineIndex + 1], parseTableRow(candidate).length)
  }

  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index++
      continue
    }

    if (/^```/.test(line)) {
      const language = line.slice(3).trim().replace(/[^\w-]/g, "")
      const code = []
      index++
      while (index < lines.length && !/^```/.test(lines[index])) {
        code.push(lines[index])
        index++
      }
      if (index < lines.length) index++
      const codeElement = h("code", {}, code.join("\n"))
      if (language) codeElement.className = `language-${language}`
      fragment.append(h("pre", {}, codeElement))
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      const level = Math.min(6, heading[1].length)
      fragment.append(h(`h${level}`, {}, renderInline(heading[2])))
      index++
      continue
    }

    if (/^>\s?/.test(line)) {
      const quote = []
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ""))
        index++
      }
      fragment.append(h("blockquote", {}, renderInline(quote.join("\n"))))
      continue
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const list = h("ul")
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        list.append(h("li", {}, renderInline(lines[index].replace(/^\s*[-*+]\s+/, ""))))
        index++
      }
      fragment.append(list)
      continue
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const list = h("ol")
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        list.append(h("li", {}, renderInline(lines[index].replace(/^\s*\d+\.\s+/, ""))))
        index++
      }
      fragment.append(list)
      continue
    }

    if (/^\s*---+\s*$/.test(line)) {
      fragment.append(h("hr"))
      index++
      continue
    }

    if (isTableStart(index)) {
      const headerCells = parseTableRow(line)
      const table = h("table")
      const thead = h("thead")
      const headerRow = h("tr")
      for (const cell of headerCells) headerRow.append(h("th", {}, renderInline(cell)))
      thead.append(headerRow)
      table.append(thead)
      index += 2

      const tbody = h("tbody")
      while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
        const cells = parseTableRow(lines[index])
        const row = h("tr")
        for (let column = 0; column < headerCells.length; column++) {
          row.append(h("td", {}, renderInline(cells[column] ?? "")))
        }
        tbody.append(row)
        index++
      }
      if (tbody.children.length) table.append(tbody)
      fragment.append(table)
      continue
    }

    const paragraph = []
    while (
      index < lines.length &&
      lines[index].trim() &&
      !isBlockStart(lines[index]) &&
      !isTableStart(index)
    ) {
      paragraph.push(lines[index])
      index++
    }

    if (paragraph.length) {
      fragment.append(h("p", {}, renderInline(paragraph.join("\n"))))
    } else {
      index++
    }
  }

  return fragment
}

function quoteEntry(entry, selection = "") {
  const fallback = entry.kind === "user" ? cleanUserText(entry.text) : entry.text
  const source = String(selection || fallback || (entry.files ?? []).join(", ")).trim()
  if (!source) return

  const excerpt = source.length > 600 ? `${source.slice(0, 600)}…` : source
  const quote = excerpt
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")

  input.value = input.value.trim() ? `${input.value.trim()}\n\n${quote}\n\n` : `${quote}\n\n`
  input.focus()
  resizeInput()
}

// Called by the optional Android WebView wrapper from its native selection menu.
window.ocbQuote = (text) => {
  const value = String(text ?? "").trim()
  if (!value) return
  quoteEntry({ text: value, kind: "assistant" }, value)
}

window.ocbQuoteSelection = () => {
  const text = selectedTextInChat() || String(window.getSelection()?.toString() ?? "").trim()
  if (text) window.ocbQuote(text)
}

function messageNode(entry, kind) {
  const text = kind === "user" ? cleanUserText(entry.text) : entry.text
  const body = h("div", { class: `msg ${kind} markdown` }, renderMarkdown(text))

  if (kind === "user") {
    for (const file of entry.files ?? []) {
      const name = typeof file === "string" ? file : file?.name || "file"
      const preview = typeof file === "object" && file ? file.preview : null
      if (preview) {
        body.append(
          h("img", {
            class: "attachment-preview",
            src: preview,
            alt: name,
            loading: "lazy",
          }),
        )
      }
      body.append(h("div", { class: "file-name", text: `📎 ${name}` }))
    }
  }

  const quote = h(
    "button",
    {
      class: "quote",
      type: "button",
      title: t("quote.messageTitle"),
      "aria-label": t("quote.messageTitle"),
      onpointerdown: () => {
        pendingQuote = selectedTextInChat()
      },
      onclick: () => {
        quoteEntry(entry, pendingQuote)
        pendingQuote = ""
      },
    },
    "↩︎",
  )

  return h("div", { class: `msg-wrap ${kind}` }, body, quote)
}

function renderEntry(entry) {
  if (entry.kind === "permission") return permissionCard(entry)
  if (entry.kind === "form") return formCard(entry)
  if (entry.kind === "assistant") return messageNode(entry, "assistant")
  if (entry.kind === "user") return messageNode(entry, "user")
  if (entry.kind === "error") return h("div", { class: "msg error", text: entry.text })
  return h("div", { class: "msg notice", text: entry.text || "" })
}

function entryKey(entry) {
  return `${entry.kind}|${entry.sessionID}|${String(entry.text ?? "").replace(/\s+/g, " ").trim()}`
}

function visibleEntries() {
  const activeID = state?.active?.id || ""
  const history = historyBySession.get(activeID) ?? []
  const historyKeys = new Set(history.map(entryKey))
  const live = entries.filter((entry) => {
    if (entry.kind === "user" || entry.kind === "assistant") {
      return !historyKeys.has(entryKey(entry))
    }
    return true
  })
  const combined = [...history, ...live]
  const seen = new Set()

  return combined
    .filter((entry) => {
      if (entry.kind === "permission" || entry.kind === "form") return true
      if (!entry.sessionID) return true
      return entry.sessionID === activeID
    })
    .filter((entry) => {
      if (seen.has(entry.id)) return false
      seen.add(entry.id)
      return true
    })
    .sort((left, right) => (left.time ?? 0) - (right.time ?? 0))
}

function upsert(entry) {
  const index = entries.findIndex((item) => item.id === entry.id)
  if (index >= 0) entries[index] = entry
  else entries.push(entry)

  const activeID = state?.active?.id || ""
  const visible =
    entry.kind === "permission" ||
    entry.kind === "form" ||
    !entry.sessionID ||
    entry.sessionID === activeID
  if (!visible) return

  if (
    (entry.kind === "user" || entry.kind === "assistant") &&
    entry.sessionID === activeID
  ) {
    const history = historyBySession.get(activeID) ?? []
    if (history.some((item) => entryKey(item) === entryKey(entry))) {
      const existing = nodes.get(entry.id)
      if (existing) {
        existing.remove()
        nodes.delete(entry.id)
      }
      return
    }
  }

  if (entry.kind === "assistant" && entry.sessionID === activeID) {
    void markViewedInUi()
  }

  const shouldScroll = nearBottom()
  const node = renderEntry(entry)
  const existing = nodes.get(entry.id)
  if (existing) existing.replaceWith(node)
  else chat.append(node)
  nodes.set(entry.id, node)

  while (chat.children.length > 200) {
    const first = chat.firstElementChild
    if (!first) break
    const id = [...nodes.entries()].find(([, value]) => value === first)?.[0]
    if (id) nodes.delete(id)
    first.remove()
  }

  if (shouldScroll) scrollToBottom()
}

function renderAll({ scroll = true } = {}) {
  chat.replaceChildren()
  nodes.clear()
  for (const entry of visibleEntries()) {
    const node = renderEntry(entry)
    nodes.set(entry.id, node)
    chat.append(node)
  }
  if (scroll) scrollToBottom()
}

async function loadHistory(sessionID, { force = false } = {}) {
  if (!sessionID || loadingHistory.has(sessionID)) return false
  if (historyBySession.has(sessionID) && !force) return false

  loadingHistory.add(sessionID)
  try {
    const response = await fetch(`/api/history?session=${encodeURIComponent(sessionID)}`)
    if (response.ok) {
      const data = await response.json()
      const next = Array.isArray(data.messages) ? data.messages : []
      const previous = historyBySession.get(sessionID)
      historyBySession.set(sessionID, next)
      return JSON.stringify(previous) !== JSON.stringify(next)
    }
  } catch {
    // la cronologia è un extra: se fallisce, la chat live continua
  } finally {
    loadingHistory.delete(sessionID)
  }
  return false
}

async function refreshHistory(sessionID) {
  const follow = nearBottom()
  const changed = await loadHistory(sessionID, { force: true })
  if (changed && (state?.active?.id || "") === sessionID) renderAll({ scroll: follow })
}

function sameSessions(left, right) {
  if (!left || !right || left.length !== right.length) return false
  return left.every((item, index) => item.id === right[index].id && item.title === right[index].title)
}

function applyState(next) {
  const wasBusy = Boolean(state?.busy)
  state = next
  dot.className = "dot online"
  statusBadge.textContent = next.busy ? t("status.busy") : t("status.connected")

  versionBadge.textContent = next.version ? `v${next.version}` : "—"
  if (settingsVersion) {
    settingsVersion.textContent = next.version || t("settings.unknownVersion")
  }
  if (next.repoUrl) githubLink.href = next.repoUrl

  const activeID = next.active?.id || ""
  const changed = activeID !== lastActiveID
  lastActiveID = activeID
  const list = next.sessions || []

  if (
    !sameSessions(
      Array.from(sessionsSelect.options).map((option) => ({
        id: option.value,
        title: option.textContent,
      })),
      list,
    ) ||
    sessionsSelect.value !== activeID
  ) {
    sessionsSelect.replaceChildren()
    for (const session of list) {
      sessionsSelect.append(
        h("option", { value: session.id }, session.title || t("common.untitled")),
      )
    }
    sessionsSelect.value = activeID
  }

  sendButton.disabled = sending || !activeID || Boolean(next.busy)
  attachButton.disabled = !activeID
  input.disabled = !activeID
  input.placeholder = next.busy
    ? t("composer.busy")
    : activeID
      ? t("composer.placeholder")
      : t("composer.noSession")

  if (changed) {
    renderAll()
    if (activeID) void refreshHistory(activeID)
  } else if (wasBusy && !next.busy && activeID) {
    void refreshHistory(activeID)
    setTimeout(() => {
      void refreshHistory(activeID)
    }, 1500)
  }
}

async function handleDeepLink(next) {
  if (deepLinkDone) return
  const params = new URLSearchParams(location.search)
  const id = params.get("session")
  if (!id) {
    deepLinkDone = true
    return
  }

  deepLinkDone = true
  params.delete("session")
  const query = params.toString()
  history.replaceState({}, "", location.pathname + (query ? `?${query}` : ""))

  if (next.active?.id === id) return

  try {
    await post("/api/session", { id })
  } catch (error) {
    localEntry("error", t("error.sessionUnavailable", { error: error.message }))
  }
}

async function markViewedInUi() {
  if (document.visibilityState !== "visible") return
  const id = state?.active?.id
  if (!id) return

  const now = Date.now()
  if (now - lastViewSent < 3000) return
  lastViewSent = now

  try {
    await post("/api/view", { session: id })
  } catch {
    // la notifica verrà gestita al prossimo evento
  }
}

let checkingVpn = false
let vpnTimer = null
let vpnProbeTimer = null

function scheduleVpnProbe() {
  if (vpnProbeTimer) clearTimeout(vpnProbeTimer)
  vpnProbeTimer = setTimeout(() => {
    vpnProbeTimer = null
    if (eventSource?.readyState === EventSource.OPEN) return
    void checkVpnConnection()
  }, 1500)
}

function scheduleVpnCheck() {
  if (vpnTimer) return
  vpnTimer = setInterval(() => {
    if (vpnBanner.hidden) {
      clearInterval(vpnTimer)
      vpnTimer = null
      return
    }
    if (document.visibilityState === "visible") void checkVpnConnection()
  }, 10000)
}

function showVpnNotice() {
  vpnBanner.hidden = false
  scheduleVpnCheck()
}

function hideVpnNotice() {
  vpnBanner.hidden = true
  if (vpnTimer) {
    clearInterval(vpnTimer)
    vpnTimer = null
  }
  if (vpnProbeTimer) {
    clearTimeout(vpnProbeTimer)
    vpnProbeTimer = null
  }
}

async function checkVpnConnection() {
  if (checkingVpn) return false
  checkingVpn = true

  try {
    const response = await fetch("/healthz", {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    hideVpnNotice()
    if (!eventSource || eventSource.readyState === EventSource.CLOSED) connect()
    return true
  } catch {
    showVpnNotice()
    return false
  } finally {
    checkingVpn = false
  }
}

function setOnline(online) {
  dot.className = `dot ${online ? "online" : "offline"}`
  if (!online) {
    statusBadge.textContent = t("status.offline")
    scheduleVpnProbe()
  } else {
    hideVpnNotice()
    if (state) statusBadge.textContent = state.busy ? t("status.busy") : t("status.connected")
  }
}

function connect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (eventSource) eventSource.close()

  const source = new EventSource("/events")
  eventSource = source

  source.onopen = () => setOnline(true)
  source.onerror = () => {
    setOnline(false)
    if (source.readyState === EventSource.CLOSED && !reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        connect()
      }, 3000)
    }
  }
  source.onmessage = (event) => {
    let data
    try {
      data = JSON.parse(event.data)
    } catch {
      return
    }

    if (data.type === "init") {
      setOnline(true)
      entries = Array.isArray(data.entries) ? data.entries : []
      applyState(data.state || {})
      renderAll()
      void handleDeepLink(data.state || {})
      void refreshHistory(data.state?.active?.id || state?.active?.id || "")
      return
    }

    if (data.type === "entry") {
      upsert(data.entry)
      return
    }

    if (data.type === "state") {
      applyState(data.state || {})
    }
  }
}

function resizeInput() {
  input.style.height = "auto"
  input.style.height = `${Math.min(input.scrollHeight, window.innerHeight * 0.4)}px`
}

function syncKeyboardOffset() {
  const viewport = window.visualViewport
  if (!viewport) return

  const focused = document.activeElement === input || document.activeElement === sendButton
  const offset = focused
    ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
    : 0
  document.documentElement.style.setProperty("--keyboard-height", `${offset}px`)
}

function renderAttachments() {
  attachmentsBox.replaceChildren()
  if (selectedFiles.length === 0) {
    attachmentsBox.hidden = true
    return
  }

  attachmentsBox.hidden = false
  for (const file of selectedFiles) {
    const preview = previewUrlFor(file)
    const chip = h(
      "span",
      { class: "file-chip" },
      preview ? h("img", { class: "file-thumb", src: preview, alt: file.name }) : null,
      `${file.name} · ${formatBytes(file.size)}`,
      h(
        "button",
        {
          type: "button",
          title: t("common.remove"),
          "aria-label": t("common.removeNamed", { name: file.name }),
          onclick: () => {
            revokePreview(file)
            selectedFiles = selectedFiles.filter((candidate) => candidate !== file)
            renderAttachments()
          },
        },
        "✕",
      ),
    )
    attachmentsBox.append(chip)
  }
}

function previewUrlFor(file) {
  if (!file.type?.startsWith("image/")) return null
  if (!previewUrls.has(file)) previewUrls.set(file, URL.createObjectURL(file))
  return previewUrls.get(file)
}

function revokePreview(file) {
  const url = previewUrls.get(file)
  if (url) URL.revokeObjectURL(url)
  previewUrls.delete(file)
}

async function makePreview(file) {
  if (!file.type?.startsWith("image/")) return null
  const url = previewUrlFor(file)
  if (!url) return null

  const image = new Image()
  image.src = url
  try {
    await image.decode()
  } catch {
    return null
  }

  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  if (!width || !height) return null

  const max = 320
  const scale = Math.min(1, max / Math.max(width, height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext("2d")
  if (!context) return null

  context.fillStyle = "#0f1115"
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL("image/jpeg", 0.82)
}

async function fileToAttachment(file) {
  const uri = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error(t("error.readFile", { name: file.name })))
    reader.readAsDataURL(file)
  })

  const preview = await makePreview(file).catch(() => null)
  return { name: file.name, uri, ...(preview ? { preview } : {}) }
}

function addFiles(files) {
  const incoming = [...files]
  if (!incoming.length) return

  const total = [...selectedFiles, ...incoming].reduce((sum, file) => sum + file.size, 0)
  if (total > MAX_ATTACHMENT_BYTES) {
    localEntry(
      "error",
      t("error.tooLarge", { size: formatBytes(MAX_ATTACHMENT_BYTES) }),
    )
    return
  }

  selectedFiles.push(...incoming)
  renderAttachments()
}

try {
  input.value = sessionStorage.getItem(DRAFT_KEY) || ""
  resizeInput()
} catch {
  // sessionStorage può essere disabilitato
}

input.addEventListener("input", () => {
  resizeInput()
  try {
    sessionStorage.setItem(DRAFT_KEY, input.value)
  } catch {
    // ignorato
  }
})

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    composer.requestSubmit()
  }
})

attachButton.addEventListener("click", () => filesInput.click())

filesInput.addEventListener("change", () => {
  addFiles(filesInput.files)
  filesInput.value = ""
})

composer.addEventListener("paste", (event) => {
  let files = Array.from(event.clipboardData?.files ?? [])
  if (files.length === 0) {
    files = Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter(Boolean)
  }

  const images = files.filter((file) => file.type.startsWith("image/"))
  if (images.length === 0) return

  event.preventDefault()
  addFiles(images)
})

composer.addEventListener("submit", async (event) => {
  event.preventDefault()
  const text = input.value.trim()
  if ((!text && selectedFiles.length === 0) || sending || !state?.active?.id) return
  if (state?.busy) {
    localEntry("notice", t("error.busyWait"))
    return
  }

  sending = true
  sendButton.disabled = true
  const previous = input.value
  const filesToSend = [...selectedFiles]
  input.value = ""
  resizeInput()

  try {
    const files = await Promise.all(filesToSend.map(fileToAttachment))
    await post("/api/prompt", {
      text,
      files,
      ...(state?.active?.id ? { session: state.active.id } : {}),
    })
    try {
      sessionStorage.removeItem(DRAFT_KEY)
    } catch {
      // ignorato
    }
    for (const file of selectedFiles) revokePreview(file)
    selectedFiles = []
    renderAttachments()
  } catch (error) {
    input.value = previous
    localEntry("error", error.message)
  } finally {
    sending = false
    sendButton.disabled = !state?.active?.id || Boolean(state?.busy)
    resizeInput()
  }
})

sessionsSelect.addEventListener("change", async () => {
  try {
    await post("/api/session", { id: sessionsSelect.value })
  } catch (error) {
    localEntry("error", error.message)
  }
})

function updateHeaderOnScroll() {
  const y = currentScroll()
  const delta = y - lastScrollY
  lastScrollY = y

  if (Math.abs(delta) < 8) return
  if (y <= 24) {
    setHeaderHidden(false)
    return
  }

  setHeaderHidden(delta > 0)
}

window.addEventListener("scroll", updateHeaderOnScroll, { passive: true })
document.addEventListener("scroll", updateHeaderOnScroll, { passive: true, capture: true })

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return
  void markViewedInUi()
  if (!vpnBanner.hidden) void checkVpnConnection()
  if (!eventSource || eventSource.readyState === EventSource.CLOSED) connect()
  void refreshHistory(state?.active?.id || "")
})

if (!/Android/i.test(navigator.userAgent)) vpnOpen.hidden = true

vpnRetry.addEventListener("click", () => {
  void checkVpnConnection()
})

settingsOpen.addEventListener("click", () => {
  languageSelect.value = i18n.preference
  settingsVersion.textContent = state?.version || t("settings.unknownVersion")
  if (state?.repoUrl) githubLink.href = state.repoUrl
  updateStatus.replaceChildren()
  settingsDialog.showModal()
})

settingsDialog.addEventListener("click", (event) => {
  if (event.target === settingsDialog) settingsDialog.close()
})

languageSelect.addEventListener("change", () => {
  i18n.setLanguage(languageSelect.value)
})

checkUpdatesButton.addEventListener("click", async () => {
  if (checkUpdatesButton.disabled) return
  checkUpdatesButton.disabled = true
  updateStatus.textContent = t("settings.checking")

  try {
    const response = await fetch("/api/update", { cache: "no-store" })
    let data = {}
    try {
      data = await response.json()
    } catch {
      data = {}
    }
    if (!response.ok) throw new Error(errorText(data, response.status))

    if (data.newer) {
      updateStatus.textContent = `${t("settings.updateAvailable", {
        version: data.latest,
      })} ${t("settings.webUpdateHint")} `
      if (data.url) {
        updateStatus.append(
          h(
            "a",
            { href: data.url, target: "_blank", rel: "noopener noreferrer" },
            t("settings.openRelease"),
          ),
        )
      }
    } else {
      updateStatus.textContent = t("settings.upToDate", { version: data.current })
    }
  } catch {
    updateStatus.textContent = t("settings.updateError")
  } finally {
    checkUpdatesButton.disabled = false
  }
})

window.addEventListener("online", () => {
  void checkVpnConnection()
  if (!eventSource || eventSource.readyState === EventSource.CLOSED) connect()
  void refreshHistory(state?.active?.id || "")
})

window.addEventListener(
  "wheel",
  (event) => {
    if (Math.abs(event.deltaY) < 8 || Math.abs(event.deltaY) < Math.abs(event.deltaX)) return
    if (currentScroll() <= 24) setHeaderHidden(false)
    else setHeaderHidden(event.deltaY > 0)
  },
  { passive: true },
)

let touchStartY = null
window.addEventListener(
  "touchstart",
  (event) => {
    touchStartY = event.touches[0]?.clientY ?? null
  },
  { passive: true },
)

window.addEventListener(
  "touchmove",
  (event) => {
    const y = event.touches[0]?.clientY
    if (y == null || touchStartY == null) return

    const delta = touchStartY - y
    if (Math.abs(delta) < 10) return
    touchStartY = y

    if (currentScroll() <= 24) setHeaderHidden(false)
    else setHeaderHidden(delta > 0)
  },
  { passive: true },
)

if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", syncKeyboardOffset)
  window.visualViewport.addEventListener("scroll", syncKeyboardOffset)
}
window.addEventListener("resize", syncKeyboardOffset)
input.addEventListener("focus", () => setTimeout(syncKeyboardOffset, 150))
input.addEventListener("blur", () => setTimeout(syncKeyboardOffset, 150))
syncKeyboardOffset()

if (window.matchMedia("(pointer: fine)").matches) input.focus()

if ("serviceWorker" in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller)
  let refreshing = false

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || refreshing) return
    refreshing = true

    if (input.value.trim() || state?.busy) {
      localEntry("notice", t("notice.newVersion"))
      return
    }

    location.reload()
  })

  navigator.serviceWorker
    .register("/sw.js")
    .then((registration) => {
      void registration.update().catch(() => {})
    })
    .catch(() => {})
}

connect()
