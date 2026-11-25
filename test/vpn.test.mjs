import test from "node:test"
import assert from "node:assert/strict"

import { VpnManager } from "../src/vpn.mjs"

function fakeExec(responses) {
  const calls = []
  const exec = async (file, args) => {
    calls.push([file, ...args].join(" "))
    const next = responses.shift()
    if (next instanceof Error) throw next
    return { stdout: next ?? "", stderr: "" }
  }
  return { exec, calls }
}

const online = JSON.stringify({ BackendState: "Running", Self: { Online: true } })
const stopped = JSON.stringify({ BackendState: "Stopped", Self: { Online: false } })
const needsLogin = JSON.stringify({ BackendState: "NeedsLogin", Self: { Online: false } })

test("status riconosce Tailscale già connesso", async () => {
  const { exec } = fakeExec([online])
  const vpn = new VpnManager({ exec, sleep: async () => {}, platform: "win32" })
  const status = await vpn.status()
  assert.equal(status.installed, true)
  assert.equal(status.running, true)
  assert.equal(status.online, true)
})

test("ensure non fa nulla se Tailscale è già attivo", async () => {
  const { exec, calls } = fakeExec([online])
  const vpn = new VpnManager({ exec, sleep: async () => {}, platform: "win32" })
  const result = await vpn.ensure()
  assert.equal(result.changed, false)
  assert.equal(result.message, "Tailscale era già attivo")
  assert.equal(calls.length, 1)
})

test("ensure avvia il servizio e tailscale up se è fermo", async () => {
  const { exec, calls } = fakeExec([
    stopped,
    "Stopped",
    "",
    stopped,
    "",
    online,
  ])
  const vpn = new VpnManager({ exec, sleep: async () => {}, platform: "win32" })
  const result = await vpn.ensure()
  assert.equal(result.changed, true)
  assert.equal(result.online, true)
  assert.ok(calls.some((call) => call.includes("Start-Service Tailscale")))
  assert.ok(calls.some((call) => call.endsWith("tailscale.exe up")))
})

test("ensure segnala il login necessario", async () => {
  const { exec } = fakeExec([stopped, "Running", stopped, "", needsLogin])
  const vpn = new VpnManager({ exec, sleep: async () => {}, platform: "win32" })
  const result = await vpn.ensure()
  assert.equal(result.online, false)
  assert.equal(result.backend, "NeedsLogin")
  assert.equal(result.message, "Serve il login sul PC")
})

test("status segnala Tailscale non installato", async () => {
  const error = new Error("not found")
  error.code = "ENOENT"
  const { exec } = fakeExec([error])
  const vpn = new VpnManager({ exec })
  const status = await vpn.status()
  assert.equal(status.installed, false)
})
