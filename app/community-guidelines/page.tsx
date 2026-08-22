import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Community Guidelines — Rizzuno",
}

/**
 * Placeholder content, same status as /terms and /privacy — replace with
 * real, reviewed copy before launch. Describes actual enforcement
 * mechanisms that exist today (report categories, server-side blocks, an
 * admin moderation queue) rather than aspirational ones.
 */
export default function CommunityGuidelinesPage() {
  return (
    <main className="mx-auto min-h-full w-full max-w-2xl bg-background px-6 py-16 text-foreground">
      <p className="mb-8 rounded-xl border border-border bg-surface px-4 py-3 text-[13px] text-muted">
        Placeholder — replace this page with reviewed Community Guidelines before launch.
      </p>
      <h1 className="text-[28px] font-bold tracking-tight">Community Guidelines</h1>
      <p className="mt-2 text-[13px] text-muted">Last updated: —</p>

      <div className="mt-8 space-y-6 text-[14px] leading-relaxed text-foreground">
        <section>
          <h2 className="text-[16px] font-semibold">Be an adult about it</h2>
          <p className="mt-2 text-muted">
            Rizzuno is 18+. Treat the person on the other end of the call the way you&apos;d want to be treated by a
            stranger — you don&apos;t know anything about them beyond what they choose to show you.
          </p>
        </section>
        <section>
          <h2 className="text-[16px] font-semibold">Not allowed</h2>
          <p className="mt-2 text-muted">
            Sexual content involving anyone who hasn&apos;t consented, harassment, hate speech, threats or violence,
            scams, spam, and anything suggesting a participant may be underage. Reporting during a call flags one of
            these categories directly to moderation.
          </p>
        </section>
        <section>
          <h2 className="text-[16px] font-semibold">What happens when you report someone</h2>
          <p className="mt-2 text-muted">
            Your report is recorded with the category, any details you add, and which call it happened in, and
            queued for review by an authorized moderator. It is never shown to the person you reported, or to
            anyone else. A reviewed report can result in no action, a warning, a temporary suspension, or a
            permanent ban — enforced on the account itself, not just the one call.
          </p>
        </section>
        <section>
          <h2 className="text-[16px] font-semibold">Blocking</h2>
          <p className="mt-2 text-muted">
            Blocking someone is immediate and permanent until you undo it, and is enforced by our server — the two
            accounts won&apos;t be matched with each other again, regardless of device, tab, or new sign-in.
          </p>
        </section>
        <section>
          <h2 className="text-[16px] font-semibold">Automated filtering — what it does and doesn&apos;t do</h2>
          <p className="mt-2 text-muted">
            Chat text is checked against a basic keyword filter for severe content and profile fields go through
            the same check — this catches obvious cases, not everything, and is not a substitute for reporting.
            Live video and audio are not automatically monitored, recorded, or reviewed by Rizzuno; moderation of
            what happens on a call depends on it being reported.
          </p>
        </section>
        <section>
          <h2 className="text-[16px] font-semibold">More</h2>
          <p className="mt-2 text-muted">
            See our{" "}
            <Link href="/terms" className="underline underline-offset-2 hover:text-accent">
              Terms of Service
            </Link>
            ,{" "}
            <Link href="/privacy" className="underline underline-offset-2 hover:text-accent">
              Privacy Policy
            </Link>
            , and{" "}
            <Link href="/safety" className="underline underline-offset-2 hover:text-accent">
              Safety
            </Link>{" "}
            page.
          </p>
        </section>
      </div>
    </main>
  )
}
