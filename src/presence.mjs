import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const IDLE_SCRIPT = `
$ErrorActionPreference = "SilentlyContinue"
if (Get-Process LogonUI -ErrorAction SilentlyContinue) {
  Write-Output "-1"
  exit 0
}
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class IdleProbe {
  [StructLayout(LayoutKind.Sequential)]
  struct LASTINPUTINFO {
    public uint cbSize;
    public uint dwTime;
  }
  [DllImport("user32.dll")]
  static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  public static uint GetIdleMs() {
    LASTINPUTINFO info = new LASTINPUTINFO();
    info.cbSize = (uint)Marshal.SizeOf(info);
    if (!GetLastInputInfo(ref info)) return 0;
    return (uint)Environment.TickCount - info.dwTime;
  }
}
'@
[IdleProbe]::GetIdleMs()
`

export class Presence {
  constructor(options = {}) {
    this.exec = options.exec ?? execFileAsync
    this.thresholdMs = options.thresholdMs ?? 120_000
    this.platform = options.platform ?? process.platform
  }

  async idleMs() {
    if (this.platform !== "win32") return Number.POSITIVE_INFINITY

    try {
      const { stdout } = await this.exec(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", IDLE_SCRIPT],
        { timeout: 8000, windowsHide: true, maxBuffer: 1024 * 1024 },
      )
      const raw = String(stdout ?? "").trim()
      if (!raw) return Number.POSITIVE_INFINITY

      const value = Number(raw)
      if (!Number.isFinite(value) || value < 0) return Number.POSITIVE_INFINITY
      return value
    } catch {
      return Number.POSITIVE_INFINITY
    }
  }

  async isAtPc() {
    return (await this.idleMs()) < this.thresholdMs
  }
}
