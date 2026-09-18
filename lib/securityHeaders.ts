export function contentSecurityPolicy(nonce: string): string {
  let ws = ""
  if (process.env.NEXT_PUBLIC_WS_URL) {
    const url = new URL(process.env.NEXT_PUBLIC_WS_URL)
    if (!["ws:", "wss:"].includes(url.protocol)) throw new Error("Invalid WebSocket URL")
    ws = url.origin
  }
  const dev = process.env.NODE_ENV !== "production"
  return ["default-src 'self'", `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'", // Motion and existing React inline styles.
    "img-src 'self' data: blob: https://lh3.googleusercontent.com",
    `connect-src 'self' ${ws}${dev ? " ws: http://localhost:* http://127.0.0.1:*" : ""}`,
    "media-src 'self' blob:", "font-src 'self'", "frame-src 'none'", "object-src 'none'",
    "base-uri 'self'", "form-action 'self' https://accounts.google.com", "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ")
}
