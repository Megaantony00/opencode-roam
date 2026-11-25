import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { mkdir, readFile, writeFile } from "node:fs/promises"

export const CONFIG_DIR = join(homedir(), ".config", "opencode")
export const CONFIG_PATH =
  process.env.OPENCODE_ROAM_CONFIG || join(CONFIG_DIR, "opencode-roam.json")

export const DEFAULTS = Object.freeze({
  version: 1,
  telegramEnabled: false,
  telegramMode: "full",
  notifyAllSessions: true,
  token: "",
  botUsername: "",
  allowedUsers: [],
  sessionID: "",
  location: "",
  redact: true,
  maxChars: 3500,
  notifyToolFailures: true,
  mirrorActive: true,
  suppressAtPc: true,
  atPcIdleMs: 120000,
  rejectWhenBusy: true,
  pairCode: "",
  pairCodeExpires: 0,
  telegramOffset: 0,
  notificationMessages: {},
  web: {
    enabled: false,
    host: "127.0.0.1",
    port: 8787,
    token: "",
    publicUrl: "",
  },
})

export function mergeConfig(base, loaded) {
  return {
    ...base,
    ...loaded,
    allowedUsers: Array.isArray(loaded.allowedUsers) ? [...loaded.allowedUsers] : [...base.allowedUsers],
    web: { ...base.web, ...(loaded.web ?? {}) },
  }
}

export async function loadConfig() {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8")
    return mergeConfig(DEFAULTS, JSON.parse(raw))
  } catch (error) {
    if (error.code === "ENOENT") return mergeConfig(DEFAULTS, {})
    throw error
  }
}

export async function saveConfig(config) {
  await mkdir(dirname(CONFIG_PATH), { recursive: true })
  await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
}

export function activeUser(config) {
  return config.allowedUsers[0] ?? null
}
