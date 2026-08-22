import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Safety — Rizzuno",
}

/**
 * Placeholder content, same status as the other legal pages — replace with
 * reviewed copy before launch. Written to be honest about what protection
 * actually exists today rather than implying broader coverage (e.g. does
 * NOT claim calls are monitored, recorded, or pre-screened — they aren't).
 */
export default function SafetyPage() {
  return (
    <main className="mx-auto min-h-full w-full max-w-2xl bg-background px-6 py-16 text-foreground">
      <p className="mb-8 rounded-xl border border-border bg-surface px-4 py-3 text-[13px] text-muted">
        Placeholder — replace this page with reviewed safety information before launch.
      </p>
      <h1 className="text-[28px] font-bold tracking-tight">Safety</h1>
      <p className="mt-2 text-[13px] text-muted">Last updated: —</p>

      <div className="mt-8 space-y-6 text-[14px] leading-relaxed text-foreground">
        <section>
          <h2 className="text-[16px] font-semibold">Rizzuno connects you with strangers</h2>
          <p className="mt-2 text-muted">
            Every match is someone you&apos;ve never talked to before. Use the same judgment you would with any
            stranger — don&apos;t share personal information you wouldn&apos;t want a stranger to have, and end a
            call the moment something feels wrong.
          </p>
        </section>
        <section>
          <h2 className="text-[16px] font-semibold">During a call</h2>
          <p className="mt-2 text-muted">
            The safety menu (the ••• icon on your match&apos;s video) lets you view their profile, report them, or
            block them at any time, without ending the call first if you don&apos;t want to.
          </p>
        </section>
        <section>
          <h2 className="text-[16px] font-semibold">Report</h2>
          <p className="mt-2 text-muted">
            Reporting sends the category you choose, any details you add, and which call it happened in to
            moderation for review. It does not notify the other person.
          </p>
        </section>
        <section>
          <h2 className="text-[16px] font-semibold">Block</h2>
          <p className="mt-2 text-muted">
            Blocking is enforced by our server against both accounts and persists across devices, sign-outs, and
            new sessions — it isn&apos;t something that can be undone by reconnecting or starting a new account
            with the same real person behind it.
          </p>
        </section>
        <section>
          <h2 className="text-[16px] font-semibold">What Rizzuno does not currently do</h2>
          <p className="mt-2 text-muted">
            Video and audio are not recorded, monitored, or reviewed by Rizzuno while a call is happening — calls
            are not automatically screened for inappropriate content. Safety depends on reporting and blocking. If
            you believe someone is a minor, use the &ldquo;Underage concern&rdquo; report category immediately and
            end the call.
          </p>
        </section>
        <section>
          <h2 className="text-[16px] font-semibold">If you&apos;re in immediate danger</h2>
          <p className="mt-2 text-muted">Contact your local emergency services. Rizzuno is not a substitute for that.</p>
        </section>
        <section>
          <h2 className="text-[16px] font-semibold">More</h2>
          <p className="mt-2 text-muted">
            See our{" "}
            <Link href="/community-guidelines" className="underline underline-offset-2 hover:text-accent">
              Community Guidelines
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline underline-offset-2 hover:text-accent">
              Privacy Policy
            </Link>
            .
          </p>
        </section>
      </div>
    </main>
  )
}
