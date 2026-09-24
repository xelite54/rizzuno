import { countryAllowed } from "./lib/launchReadiness"
import { requestCountry } from "./lib/country"
import { NextResponse, type NextRequest } from "next/server"
import { contentSecurityPolicy } from "./lib/securityHeaders"
import { csrfGuard } from "./lib/requestSecurity"

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname
  // Public legal/contact pages remain reachable; product and sign-in fail closed.
  const publicLegal = ["/terms", "/privacy", "/community-guidelines", "/safety", "/copyright", "/appeals", "/reports/recent"]
  if (!publicLegal.includes(path) && path !== "/api/billing/webhook" && !path.startsWith("/_next/") && !countryAllowed(requestCountry(request))) {
    return new NextResponse("Rizzuno is not available in your region.", { status: 451, headers: { "Cache-Control": "no-store" } })
  }
  // Auth.js owns OAuth/CSRF; Stripe authenticates the raw body signature.
  if (path.startsWith("/api/auth/") || path === "/api/billing/webhook") return NextResponse.next()
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    const rejected = csrfGuard(request)
    if (rejected) return rejected
  }
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64")
  const csp = contentSecurityPolicy(nonce)
  const headers = new Headers(request.headers)
  headers.set("Content-Security-Policy", csp)
  headers.set("x-nonce", nonce)
  const response = NextResponse.next({ request: { headers } })
  response.headers.set("Content-Security-Policy", csp)
  return response
}
export const config = { matcher: "/((?!_next/static|_next/image|favicon.ico).*)" }
