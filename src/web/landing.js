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
    status.textContent = state.busy ? "in esecuzione" : "connesso"
    session.textContent = `Sessione: ${state.active?.title || "nessuna"}`
    vpnCard.hidden = true

    const button = document.querySelector(".button")
    if (button && state.active?.id) {
      button.href = `/chat?session=${encodeURIComponent(state.active.id)}`
    }
  } catch (error) {
    dot.className = "dot offline"
    status.textContent = "offline"
    session.textContent = "Sessione: —"
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
      pwaStatus.textContent = registration.active ? "PWA pronta" : "PWA in preparazione"
    })
    .catch(() => {
      pwaStatus.textContent = "PWA non disponibile"
    })
} else {
  pwaStatus.textContent = "PWA non supportata"
}
