import test from "node:test"
import assert from "node:assert/strict"

import {
  fetchLatestRelease,
  isNewer,
  repoFromPackage,
} from "../src/update.mjs"

test("isNewer confronta le versioni numeriche", () => {
  assert.equal(isNewer("0.1.2", "0.1.1"), true)
  assert.equal(isNewer("v0.2.0", "0.1.9"), true)
  assert.equal(isNewer("0.1.2", "0.1.2"), false)
  assert.equal(isNewer("0.1.1", "0.1.2"), false)
  assert.equal(isNewer("1.0", "0.9.9"), true)
  assert.equal(isNewer("0.1.2-beta", "0.1.2"), false)
})

test("repoFromPackage legge repository GitHub", () => {
  assert.equal(
    repoFromPackage({
      repository: { url: "git+https://github.com/Megaantony00/opencode-roam.git" },
    }),
    "Megaantony00/opencode-roam",
  )
  assert.equal(
    repoFromPackage({ repository: "https://github.com/example/project" }),
    "example/project",
  )
  assert.equal(repoFromPackage({}), "")
})

test("fetchLatestRelease legge tag e URL dalla API GitHub", async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    return new Response(
      JSON.stringify({
        tag_name: "v0.1.2",
        html_url: "https://github.com/Megaantony00/opencode-roam/releases/tag/v0.1.2",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  }

  const release = await fetchLatestRelease("Megaantony00/opencode-roam", { fetchImpl })
  assert.deepEqual(release, {
    tag: "0.1.2",
    url: "https://github.com/Megaantony00/opencode-roam/releases/tag/v0.1.2",
  })
  assert.equal(calls.length, 1)
  assert.match(calls[0].url, /releases\/latest$/)
})

test("fetchLatestRelease segnala gli errori HTTP", async () => {
  const fetchImpl = async () => new Response("rate limited", { status: 403 })
  await assert.rejects(
    fetchLatestRelease("Megaantony00/opencode-roam", { fetchImpl }),
    /GitHub HTTP 403/,
  )
})
