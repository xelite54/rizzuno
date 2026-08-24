import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Safety — Rizzuno",
  description: "Practical safety guidance for meeting strangers on live video through Rizzuno.",
}

const LAST_UPDATED = "August 24, 2026"

export default function SafetyPage() {
  return (
    <main className="h-dvh w-full overflow-y-auto overscroll-y-contain bg-background text-foreground">
      <div className="mx-auto w-full max-w-2xl px-6 py-16">
      <h1 className="text-[28px] font-bold tracking-tight">Safety</h1>
      <p className="mt-2 text-[13px] text-muted">Last updated {LAST_UPDATED}</p>
      <p className="mt-4 text-[14px] leading-relaxed text-muted">
        This page is practical guidance, not a legal document. Read it before your first call.
      </p>

      <div className="mt-8 space-y-6 text-[14px] leading-relaxed text-foreground">
        <section>
          <h2 className="text-[16px] font-semibold">You&apos;re talking to a stranger</h2>
          <p className="mt-2 text-muted">
            Every match on Rizzuno is someone you&apos;ve never spoken to before, matched at random. Every Rizzuno
            user is required to affirm that they meet Rizzuno&apos;s age requirement before matching, and is
            signed in with a Google account — that&apos;s it. Rizzuno does not independently verify each
            user&apos;s actual age, identity, intentions, or honesty beyond that affirmation, so you should not
            assume another user&apos;s age or identity has been verified, and Rizzuno can&apos;t guarantee any of
            those things about the person you&apos;re matched with. Use the same judgment you&apos;d use with any
            stranger.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-semibold">Protect your personal information</h2>
          <p className="mt-2 text-muted">
            Don&apos;t share your last name, address, workplace, school, financial details, or other information you
            wouldn&apos;t want a stranger to have — especially early in a conversation. You can&apos;t take it back
            once you&apos;ve said it on a call.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-semibold">Never send money</h2>
          <p className="mt-2 text-muted">
            Never send money, gift cards, cryptocurrency, or financial/account information to someone you met on
            Rizzuno, no matter what story they give you. This is one of the most common ways strangers online try to
            take advantage of people. Report anyone who asks.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-semibold">Be cautious about moving to another platform</h2>
          <p className="mt-2 text-muted">
            If someone you&apos;ve just met pushes hard to immediately move the conversation to another app,
            especially before you&apos;re comfortable, treat that as a reason for caution rather than urgency —
            it&apos;s a common pattern used to get you somewhere Rizzuno&apos;s reporting and blocking tools
            don&apos;t reach.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-semibold">End the call if something feels wrong</h2>
          <p className="mt-2 text-muted">
            You don&apos;t need a reason or an apology to leave a call. If anything feels off, swipe to the next
            person, or use the ••• menu on your match&apos;s video to report or block them — you can do either
            without ending the call first if you don&apos;t want to.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-semibold">Report and block</h2>
          <p className="mt-2 text-muted">
            <strong className="text-foreground">Report</strong> sends the category you choose, any details you add, and which call it happened in to a
            human moderator for review — it does not notify the other person, and there can be a delay before any
            action is taken. <strong className="text-foreground">Block</strong> is enforced by our server and keeps that account from being matched
            with yours again, across devices and sessions. As currently built, there is no way to undo a block once
            made. Neither report nor block can retroactively undo anything that already happened on a call.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-semibold">Meeting someone in person</h2>
          <p className="mt-2 text-muted">
            Rizzuno is built for video conversations with strangers, not for arranging in-person meetings, and we
            don&apos;t recommend meeting someone in person solely because of a Rizzuno match. If you choose to
            anyway, meet in a public place, tell a friend where you&apos;ll be and who you&apos;re meeting, arrange
            your own transportation, and don&apos;t feel obligated to stay if anything feels wrong.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-semibold">What Rizzuno does not currently do</h2>
          <p className="mt-2 text-muted">
            Live video and audio are not recorded, monitored, or reviewed by Rizzuno while a call is happening, and
            calls are not automatically screened for inappropriate content. Rizzuno relies on you reporting and
            blocking to catch what an automated system can&apos;t. The 18+ affirmation you check before matching is
            not identity verification — Rizzuno does not confirm anyone&apos;s real age. If you believe someone is a
            minor, use the &ldquo;Underage concern&rdquo; report category immediately and end the call.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-semibold">If you&apos;re in immediate danger</h2>
          <p className="mt-2 text-muted">
            Contact your local emergency services. Rizzuno is not a substitute for that, and nothing on this page
            should be read as a promise that Rizzuno can keep you safe from another person&apos;s actions.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-semibold">More</h2>
          <p className="mt-2 text-muted">
            See our{" "}
            <Link href="/community-guidelines" className="underline underline-offset-2 hover:text-accent">
              Community Guidelines
            </Link>
            ,{" "}
            <Link href="/terms" className="underline underline-offset-2 hover:text-accent">
              Terms of Service
            </Link>
            , and{" "}
            <Link href="/privacy" className="underline underline-offset-2 hover:text-accent">
              Privacy Policy
            </Link>
            .
          </p>
        </section>
      </div>
      </div>
    </main>
  )
}
