import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export const DEFAULT_TAILSCALE = "C:\\Program Files\\Tailscale\\tailscale.exe"

function cleanError(error) {
  const text = String(error?.stderr || error?.message || "errore sconosciuto")
  return text.split("\n")[0].trim().slice(0, 200)
}

function parseStatus(stdout) {
  const data = JSON.parse(stdout)
  return {
    installed: true,
    running: data.BackendState === "Running",
    online: Boolean(data.Self?.Online),
    backend: String(data.BackendState ?? "unknown"),
    ips: data.Self?.TailscaleIPs ?? [],
  }
}

export class VpnManager {
  constructor(options = {}) {
    this.exec = options.exec ?? execFileAsync
    this.tailscalePath = options.tailscalePath ?? DEFAULT_TAILSCALE
    this.platform = options.platform ?? process.platform
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  async status() {
    try {
      const { stdout } = await this.exec(this.tailscalePath, ["status", "--json"], {
        timeout: 10_000,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      })
      return parseStatus(stdout)
    } catch (error) {
      if (error?.code === "ENOENT") {
        return {
          installed: false,
          running: false,
          online: false,
          backend: "not-installed",
          error: "Tailscale non installato",
        }
      }
      if (error?.stdout) {
        try {
          return parseStatus(error.stdout)
        } catch {
          // sotto riporta l'errore
        }
      }
      return {
        installed: true,
        running: false,
        online: false,
        backend: "unknown",
        error: cleanError(error),
      }
    }
  }

  async ensure() {
    const before = await this.status()
    if (!before.installed) return { ...before, changed: false, message: "Tailscale non installato" }
    if (before.running && before.online) {
      return { ...before, changed: false, message: "Tailscale era già attivo", steps: [] }
    }

    const steps = []

    if (this.platform === "win32") {
      let serviceStatus = ""
      try {
        const result = await this.exec(
          "powershell.exe",
          ["-NoProfile", "-Command", "(Get-Service Tailscale).Status"],
          { timeout: 10_000, windowsHide: true },
        )
        serviceStatus = String(result.stdout ?? "").trim()
      } catch (error) {
        steps.push(`servizio: ${cleanError(error)}`)
      }

      if (serviceStatus && serviceStatus !== "Running") {
        try {
          await this.exec(
            "powershell.exe",
            ["-NoProfile", "-Command", "Start-Service Tailscale -ErrorAction Stop"],
            { timeout: 20_000, windowsHide: true },
          )
          steps.push("servizio avviato")
          await this.sleep(2000)
        } catch (error) {
          steps.push(`servizio: ${cleanError(error)}`)
        }
      }
    }

    const middle = await this.status()
    if (!middle.online) {
      try {
        await this.exec(this.tailscalePath, ["up"], { timeout: 20_000, windowsHide: true })
        steps.push("tailscale up")
      } catch (error) {
        steps.push(`up: ${cleanError(error)}`)
      }
      await this.sleep(2000)
    }

    const after = await this.status()
    const ok = after.running && after.online
    return {
      ...after,
      changed: true,
      steps,
      message: ok
        ? "Tailscale attivato"
        : after.backend === "NeedsLogin"
          ? "Serve il login sul PC"
          : "Tailscale non connesso",
    }
  }
}
