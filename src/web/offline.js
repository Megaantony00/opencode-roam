const status = document.getElementById("status")
const retry = document.getElementById("retry")
const openTailscale = document.getElementById("open-tailscale")

let checking = false

if (!/Android/i.test(navigator.userAgent)) {
  openTailscale.hidden = true
}

function returnTarget() {
  const path = location.pathname
  if (path === "/offline.html" || path === "/offline.css" || path === "/offline.js") {
    return "/"
  }
  return path + location.search
}

async function checkConnection() {
  if (checking) return false
  checking = true
  status.textContent = "Controllo connessione…"

  try {
    const response = await fetch("/healthz", {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    status.textContent = "Connesso. Torno all’app…"
    location.replace(returnTarget())
    return true
  } catch {
    status.textContent = "Ancora non raggiungibile. Attiva Tailscale e riprova."
    return false
  } finally {
    checking = false
  }
}

retry.addEventListener("click", () => {
  void checkConnection()
})

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void checkConnection()
})

window.addEventListener("online", () => {
  void checkConnection()
})

setInterval(() => {
  if (document.visibilityState === "visible") void checkConnection()
}, 15000)

void checkConnection()
