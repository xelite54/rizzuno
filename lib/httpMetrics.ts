import { log } from "./observability"
/** Route template is supplied by code, never a URL/body/header or user input. */
export function withHttpMetrics<Args extends unknown[]>(route: string, handler: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    const start = performance.now()
    let status = 500
    try { const response = await handler(...args); status = response.status; return response }
    finally { log.info("http.request", { type: route, status, durationMs: performance.now()-start }) }
  }
}
