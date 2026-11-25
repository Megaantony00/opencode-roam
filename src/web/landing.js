const i18n = window.RoamI18n
const t = (key, vars) => i18n.t(key, vars)
i18n.apply()

const dot = document.getElementById("dot")
const status = document.getElementById("status")
const session = document.getElementById("session")
const vpnCard = document.getElementById("vpn-card")
const vpnOpen = document.getElementById("vpn-open")
const vpnRetry = document.getElementById("vpn-retry")

let checkingVpn = false

if (!/Android/i.test(navigator.userAgent)) vpnOpen.hidden = true

async function loadState() {
  try {
    const response = await fetch("/api/state", {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const state = await response.json()
    dot.className = "dot online"
    status.textContent = state.busy ? t("status.busy") : t("status.connected")
    session.textContent = t("landing.session", {
      title: state.active?.title || t("landing.none"),
    })
    vpnCard.hidden = true

    const button = document.querySelector(".button")
    if (button && state.active?.id) {
      button.href = `/chat?session=${encodeURIComponent(state.active.id)}`
    }
  } catch (error) {
    dot.className = "dot offline"
    status.textContent = t("status.offline")
    session.textContent = t("landing.session", { title: "—" })
    const network =
      error?.name === "TimeoutError" ||
      error instanceof TypeError ||
      /HTTP 5\d\d/.test(error?.message || "")
    vpnCard.hidden = !network
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
    vpnCard.hidden = true
    void loadState()
    return true
  } catch {
    vpnCard.hidden = false
    return false
  } finally {
    checkingVpn = false
  }
}

vpnRetry.addEventListener("click", () => {
  void checkVpnConnection()
})

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !vpnCard.hidden) {
    void checkVpnConnection()
  }
})

window.addEventListener("online", () => {
  void checkVpnConnection()
})

loadState()

const pwaStatus = document.getElementById("pwa-status")

if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("/sw.js")
    .then(async () => {
      const registration = await navigator.serviceWorker.ready
      pwaStatus.textContent = registration.active
        ? t("landing.pwaReady")
        : t("landing.pwaPreparing")
    })
    .catch(() => {
      pwaStatus.textContent = t("landing.pwaUnavailable")
    })
} else {
  pwaStatus.textContent = t("landing.pwaUnsupported")
}
