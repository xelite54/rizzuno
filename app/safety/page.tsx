import type { Metadata } from "next"
import Link from "next/link"
import { LegalNav } from "@/components/LegalNav"
import { RELATED_LEGAL_VERSIONS } from "@/lib/legalVersions"

export const metadata: Metadata = {
  title: "Safety — Rizzuno",
  description: "Practical safety guidance for meeting strangers on live video through Rizzuno.",
}

const LAST_UPDATED = "September 24, 2026"

export default function SafetyPage() {
  return (
    <main className="h-dvh w-full overflow-y-auto overscroll-y-contain bg-background text-foreground">
      <div className="mx-auto w-full max-w-2xl px-6 py-16">
      <h1 className="text-[28px] font-bold tracking-tight">Safety Center</h1>
      <p className="mt-2 text-[13px] text-muted">Version {RELATED_LEGAL_VERSIONS.safety} · Last updated {LAST_UPDATED}</p>
      <p className="mt-4 text-[14px] leading-relaxed text-muted">
        This page is practical guidance, not a legal document. Read it before your first call.
      </p>

      <p className="mt-4 text-sm text-muted">Underage concerns receive urgent priority for trained safety review. Generic nudity screening does not identify child sexual abuse material. Reports can preserve bounded recent text context; automatic screenshots and call recording are disabled. For copyright notices see our <Link href="/copyright" className="underline">Copyright Policy</Link>.</p>
      <div className="mt-8 space-y-6 text-[14px] leading-relaxed text-foreground">
        <section>
          <h2 className="text-[16px] font-semibold">You&apos;re talking to a stranger</h2>
          <p className="mt-2 text-muted">
            Random matches may be strangers or people you have met before. Mutually accepted friend invitations are separate from random matching. Every Rizzuno
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
            with yours again while either account blocks the other. You can remove your own block in My Profile →
            Settings → Blocked users. Unblocking does not restore friendships or pending requests.

          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-muted">
            <li><strong className="text-foreground">During a match:</strong> open the ••• safety menu on the other person&apos;s video, choose Report, select a category, and add details if useful.</li>
            <li><strong className="text-foreground">Immediately afterward:</strong> open <Link href="/reports/recent" className="underline">Report a recent match</Link>. The private list contains only your still-reportable sessions and does not reveal internal account IDs.</li>
            <li><strong className="text-foreground">Friends or profiles:</strong> use the Report control on the supported friend, request, or username-result view.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-[16px] font-semibold">What happens after a report</h2>
          <p className="mt-2 text-muted">The report is queued for authorized review. It can include the category, your optional details, exact time, server-authoritative account and session references, a bounded summary of relevant prior reports/actions, and up to 20 approved text messages from the preceding two minutes when the report is made during the live room. Post-match reports normally have no chat snapshot because that memory is cleared when the room ends. The reported person does not receive the report or evidence.</p>
          <p className="mt-2 text-muted">A reviewer can record no action, an internal warning, a temporary restriction pending review, a temporary suspension, or a permanent ban. Underage concerns enter the urgent safety queue. Rizzuno does not promise instant review or continuous staffing.</p>
        </section>

        <section>
          <h2 className="text-[16px] font-semibold">Underage concerns</h2>
          <p className="mt-2 text-muted">Rizzuno is only for people who are at least 18, or the higher age of majority where they live. The age gate is self-attestation; Google Sign-In does not verify age. Report a suspected underage user immediately and leave the interaction.</p>
          <p className="mt-2 text-muted">The documented operator flow is: urgent flag → temporary restriction when credible and appropriate → trained safety review with minimal evidence and a case reference → permanent removal if confirmed → an <Link href="/appeals" className="underline">appeal</Link> for an incorrectly flagged user. Legal holds and external-reporting decisions are recorded where applicable. Generic nudity scores are never treated as CSAM detection.</p>
        </section>

        <section>
          <h2 className="text-[16px] font-semibold">Sexual content, harassment and threats</h2>
          <p className="mt-2 text-muted">End the call and report nudity, sexual conduct, non-consensual sexual material, coercion, stalking, harassment, discriminatory abuse, threats, encouragement of self-harm, or violence. If content appears to involve a minor, choose Underage concern and do not download, resend, or investigate it yourself.</p>
        </section>

        <section>
          <h2 className="text-[16px] font-semibold">Scams, extortion and impersonation</h2>
          <p className="mt-2 text-muted">Do not send money, credentials, intimate material, identity documents, or verification codes. Treat threats to publish images, demands for payment, fake staff claims, investment pitches, and requests to move quickly off-platform as warning signs. Preserve only what you safely already have, stop responding, and report the account.</p>
        </section>

        <section>
          <h2 className="text-[16px] font-semibold">Dangerous or off-platform behavior</h2>
          <p className="mt-2 text-muted">Rizzuno&apos;s controls apply to its accounts and service. We cannot control a person&apos;s conduct on another app or in person. Block and report the Rizzuno account, use the other service&apos;s safety tools, and contact local authorities when appropriate. Do not meet someone solely because of a random match.</p>
        </section>

        <section>
          <h2 className="text-[16px] font-semibold">Appeals</h2>
          <p className="mt-2 text-muted">A person affected by an underage decision, temporary restriction or suspension, permanent ban, or another serious recorded enforcement can use the <Link href="/appeals" className="underline">appeals page</Link> while signed in with the affected Google account. Appeal records include the enforcement reference, the person&apos;s reason and optional reference, status, reviewer, resolution, and timestamps. Internal notes, reporter identities, and restricted evidence are not shown.</p>
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
          <LegalNav className="mt-3"/>
        </section>
      </div>
      </div>
    </main>
  )
}
