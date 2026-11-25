const CACHE = "ocb-shell-v1"
const SHELL = ["/offline.html", "/offline.css", "/offline.js", "/icon-192.png"]

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("ocb-shell-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

function fetchWithTimeout(request, ms = 6000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timer))
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url)

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetchWithTimeout(event.request)
        .then((response) => {
          if (response.status >= 500) throw new Error(`HTTP ${response.status}`)
          return response
        })
        .catch(async () => {
          const cache = await caches.open(CACHE)
          return (await cache.match("/offline.html")) || Response.error()
        }),
    )
    return
  }

  if (SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request)),
    )
  }
})
