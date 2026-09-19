/** Next awaits register before accepting requests, including Vercel cold starts. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateProductionConfig } = await import("./lib/productionConfig")
    validateProductionConfig(process.env.RAILWAY_SERVICE_ID && !process.env.VERCEL ? "realtime" : "web")
  }
}
export async function onRequestError() {
  const { metric } = await import("./lib/observability")
  metric("http.unhandled_error", 1)
}
