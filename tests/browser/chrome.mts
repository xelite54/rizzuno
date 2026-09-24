import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"

/** Isolated test browser. Read Chrome's readiness file, not platform-dependent logging. */
export async function launchChrome(executable: string, profile: string) {
  const args = ["--headless=new", "--autoplay-policy=no-user-gesture-required", "--no-first-run", "--no-default-browser-check", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", `--user-data-dir=${profile}`]
  // GitHub's disposable Linux runner restricts user namespaces. Never use this
  // exception for browsing untrusted sites or in application deployment.
  if (process.env.GITHUB_ACTIONS === "true" && process.platform === "linux") args.push("--no-sandbox", "--disable-dev-shm-usage")
  const browser = spawn(executable, [...args, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] })
  let diagnostics = "", failure: Error | undefined
  browser.stderr.on("data", data => { diagnostics = (diagnostics + data.toString()).slice(-8000) })
  browser.once("error", error => { failure = error })
  browser.once("exit", (code, signal) => { failure = new Error(`Chrome exited: ${code ?? signal}`) })
  const deadline = Date.now() + 15_000
  try {
    while (Date.now() < deadline) {
      if (failure) throw failure
      let active: string | undefined
      try { active = await readFile(path.join(profile, "DevToolsActivePort"), "utf8") }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
      if (active) {
        const [port, endpoint] = active.trim().split("\n")
        if (/^\d+$/.test(port) && endpoint?.startsWith("/devtools/browser/")) {
          const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) })
          if (!response.ok) throw new Error(`Chrome readiness HTTP ${response.status}`)
          return { process: browser, endpoint: `ws://127.0.0.1:${port}${endpoint}` }
        }
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error("Chrome launch timeout")
  } catch (error) {
    browser.kill("SIGKILL")
    throw new Error(`${error instanceof Error ? error.message : error}\nChrome: ${executable}\n${diagnostics}`)
  }
}
