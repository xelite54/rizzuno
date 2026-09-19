type Level = "debug" | "info" | "warn" | "error"
type Event = { time: string; level: Level; event: string; fields: Record<string, string | number | boolean> }
// Explicit allowlist: never forward arbitrary errors, request bodies or tokens.
const allowed = new Set(["generation", "pendingOutputs", "coordinator", "memoryBytes", "displayId", "roomId", "requestId", "code", "type", "surface", "decision", "context", "count", "queueSize", "durationMs", "status", "reasonCode", "source", "friendCount", "missingUsernames", "ok", "updated", "duplicate"])
let sink: ((event: Event) => void) | undefined
export function configureObservability(next: (event: Event) => void) { sink = next }
function emit(level: Level, event: string, args: unknown[]) {
  const fields: Event["fields"] = {}
  for (const arg of args) {
    if (!arg || typeof arg !== "object") continue
    for (const [key, value] of Object.entries(arg)) {
      if (allowed.has(key) && ["string", "number", "boolean"].includes(typeof value)) fields[key] = typeof value === "string" ? value.slice(0, 200) : value as number | boolean
    }
  }
  const record: Event = { time: new Date().toISOString(), level, event, fields }
  if (sink) { try { sink(record) } catch { /* Telemetry must not affect requests. */ } }
  if (level !== "debug" || process.env.NODE_ENV !== "production") console.log(JSON.stringify(record))
}
export const log = {
  debug: (event: string, ...args: unknown[]) => emit("debug", event, args),
  log: (event: string, ...args: unknown[]) => emit("info", event, args),
  info: (event: string, ...args: unknown[]) => emit("info", event, args),
  warn: (event: string, ...args: unknown[]) => emit("warn", event, args),
  error: (event: string, ...args: unknown[]) => emit("error", event, args),
}
export function metric(name: string, value: number, fields: Record<string, string | number> = {}) {
  log.info(`metric.${name}`, { count: value, ...fields })
}
