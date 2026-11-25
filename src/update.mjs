/** Version comparison and GitHub release lookup shared by the web update check. */

export function isNewer(remote, current) {
  const left = String(remote ?? "").replace(/^v/i, "").split(".")
  const right = String(current ?? "").replace(/^v/i, "").split(".")
  const count = Math.max(left.length, right.length)

  for (let index = 0; index < count; index += 1) {
    const a = parsePart(left, index)
    const b = parsePart(right, index)
    if (a !== b) return a > b
  }
  return false
}

function parsePart(parts, index) {
  if (index >= parts.length) return 0
  const value = Number.parseInt(String(parts[index]).replace(/[^0-9].*$/, ""), 10)
  return Number.isFinite(value) ? value : 0
}

export function repoFromPackage(pkg) {
  const raw =
    typeof pkg?.repository === "string"
      ? pkg.repository
      : String(pkg?.repository?.url ?? "")
  const match = /github\.com[/:]([^/#]+)\/([^/#]+?)(?:\.git)?(?:#.*)?$/i.exec(raw)
  if (!match) return ""
  return `${match[1]}/${match[2]}`
}

export async function fetchLatestRelease(
  repo,
  { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {},
) {
  if (!repo) throw new Error("repository not configured")
  if (typeof fetchImpl !== "function") throw new Error("fetch unavailable")

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs))
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "OpenCode-Roam",
      },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`)

    const release = await response.json()
    const tag = String(release?.tag_name ?? "").replace(/^v/i, "")
    const url = String(release?.html_url ?? "")
    if (!tag || !url) throw new Error("invalid GitHub release")
    return { tag, url }
  } finally {
    clearTimeout(timer)
  }
}
