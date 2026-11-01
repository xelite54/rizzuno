import { NextResponse } from "next/server"
import { REGION_UNAVAILABLE_MESSAGE } from "./geographicAccess"

export function regionUnavailableResponse(request: Request) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Accept", "X-Content-Type-Options": "nosniff" }
  if (new URL(request.url).pathname.startsWith("/api/") && !request.headers.get("accept")?.includes("text/html")) {
    return NextResponse.json({ error: "region_unavailable", message: REGION_UNAVAILABLE_MESSAGE }, { status: 451, headers })
  }
  return new NextResponse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rizzuno — Unavailable</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#100b16;color:#f5f1f8;font-family:system-ui,sans-serif}main{max-width:32rem;padding:2rem}h1{font-size:clamp(1.5rem,5vw,2rem);line-height:1.3}a{color:inherit}nav{display:flex;gap:1rem;flex-wrap:wrap;margin-top:1.5rem}</style></head><body><main><h1>${REGION_UNAVAILABLE_MESSAGE}</h1><nav aria-label="Legal and safety"><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/safety">Safety</a></nav></main></body></html>`, { status: 451, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } })
}
