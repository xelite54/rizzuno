import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import type { DefaultSession } from "next-auth"

// Auth.js's default Session type doesn't carry a stable user id — augment it
// so `session.user.id` (set in the `session` callback below) type-checks
// everywhere it's read.
declare module "next-auth" {
  interface Session {
    user: {
      id: string
    } & DefaultSession["user"]
  }
}

/**
 * Rizzuno's authentication system. There was no existing auth framework to
 * reuse — no NextAuth/Supabase/Firebase/Clerk, no database, no email/password
 * login anywhere in this codebase (verified by inspection, not assumed) — so
 * this is the first and only one.
 *
 * Session strategy is JWT, not database, because there's no database yet to
 * attach a persistent user row to. That has one real consequence worth being
 * honest about: "the Rizzuno user" is fully described by the Google account's
 * own stable id (`sub`) inside a signed, httpOnly session cookie — there's no
 * separate account record that could ever become a *duplicate*. Signing in
 * with the same Google account always resolves to the same `sub`, whether
 * it's your first time or your hundredth. When a real database is added
 * later, this becomes `session: { strategy: "database" }` with an adapter,
 * and that's the point where a Google login actually creates or links a row
 * — right now there's nothing to create or link *to*.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      // Identity only — openid+email+profile is exactly enough to know who
      // someone is. No Calendar/Drive/Contacts, nothing beyond that.
      authorization: { params: { scope: "openid email profile" } },
    }),
  ],

  session: { strategy: "jwt" },

  // Without this, Auth.js only trusts the Host header on environments it can
  // auto-detect (Vercel). Local dev runs behind server.ts's own http server,
  // and production may or may not be Vercel — trust the host explicitly so
  // both work.
  trustHost: true,

  // No separate auth UI exists (or should exist — the existing login screen
  // isn't being replaced). Anything Auth.js would normally render itself —
  // a sign-in prompt, an error screen — redirects back to "/" instead, where
  // SignInLanding already renders whenever there's no session. A failed or
  // cancelled login arrives there as a `?error=` query param for the UI to
  // read and show inline.
  pages: {
    signIn: "/",
    error: "/",
  },

  callbacks: {
    // Google marks unverified addresses; refuse to treat one as an identity.
    // In practice this essentially never fires for a normal Google account.
    async signIn({ profile }) {
      if (profile?.email_verified === false) return false
      return true
    },

    // Open-redirect prevention: only ever send the browser somewhere on this
    // same site. `url` can arrive as a bare path or a full URL depending on
    // the caller — both are checked against `baseUrl`, never trusted as-is.
    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) return `${baseUrl}${url}`
      try {
        if (new URL(url).origin === baseUrl) return url
      } catch {
        // Malformed URL — fall through to the safe default.
      }
      return baseUrl
    },

    // Persist the Google account's stable id into the token on sign-in so it
    // survives every later refresh without re-deriving it.
    async jwt({ token, profile }) {
      if (profile?.sub) token.sub = profile.sub
      return token
    },

    // Expose that stable id on the client-visible session, alongside the
    // name/email/image Auth.js already includes by default.
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub
      }
      return session
    },
  },
})
