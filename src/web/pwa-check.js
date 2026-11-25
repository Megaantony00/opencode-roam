const i18n = window.RoamI18n
const t = (key, vars) => i18n.t(key, vars)
i18n.apply()

const out = document.getElementById("out")
const lines = []

function log(key, value) {
  lines.push(`${key}: ${value}`)
  out.textContent = lines.join("\n")
}

function decodeIcon(src) {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () =>
      resolve({ ok: true, width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => resolve({ ok: false })
    image.src = src
  })
}

log("secureContext", window.isSecureContext)
log("url", location.href)
log("manifestLink", document.querySelector('link[rel="manifest"]')?.href || t("pwa.absent"))
log("serviceWorkerSupport", "serviceWorker" in navigator)
log("standalone", window.matchMedia("(display-mode: standalone)").matches)

let installable = false
window.addEventListener("beforeinstallprompt", () => {
  installable = true
  log("beforeinstallprompt", t("pwa.yes"))
})

if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("/sw.js")
    .then(async () => {
      const registration = await navigator.serviceWorker.ready
      log("swActive", Boolean(registration.active))
      log("swScope", registration.scope)
      log("swController", Boolean(navigator.serviceWorker.controller))

      if ("caches" in window) {
        const keys = await caches.keys()
        log("caches", keys.join(", ") || t("pwa.none"))
        const key = keys.find((name) => name.startsWith("ocb-shell-"))
        if (key) {
          const cache = await caches.open(key)
          log("offlineHtml", Boolean(await cache.match("/offline.html")))
        }
      }
    })
    .catch((error) => log("swError", error.message))
}

fetch("/manifest.webmanifest?v=2", { cache: "no-store" })
  .then(async (response) => {
    log("manifestFetch", `${response.status} ${response.headers.get("content-type") || ""}`)
    if (!response.ok) return

    const manifest = await response.json()
    log("manifestName", manifest.name)
    log("manifestId", manifest.id)
    log("manifestStart", manifest.start_url)
    log("manifestDisplay", manifest.display)

    for (const icon of manifest.icons || []) {
      try {
        const result = await fetch(icon.src, { cache: "no-store" })
        const decoded = await decodeIcon(icon.src)
        const image = decoded.ok
          ? t("pwa.decoded", { width: decoded.width, height: decoded.height })
          : t("pwa.decodeFailed")
        log(
          `icon ${icon.sizes}`,
          `${result.status} ${result.headers.get("content-type") || ""} · ${image}`,
        )
      } catch (error) {
        log(`icon ${icon.sizes}`, t("pwa.error", { message: error.message }))
      }
    }
  })
  .catch((error) => log("manifestError", error.message))

setTimeout(() => {
  if (!installable) log("beforeinstallprompt", t("pwa.notReceived"))
}, 3000)
