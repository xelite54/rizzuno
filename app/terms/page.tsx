import type { Metadata } from "next"
import Link from "next/link"
import { REQUIRED_DOCUMENTS } from "@/lib/legalVersions"

export const metadata: Metadata = {
  title: "Terms of Service — Rizzuno",
}

const version = REQUIRED_DOCUMENTS.find((d) => d.document === "terms")!.version

/**
 * Placeholder content — this page exists so https://rizzuno.com/terms is a
 * real, reachable URL (Google's OAuth consent screen requires one, and
 * AgeGate links here), not because the text below is final legal copy.
 * Replace it with actual terms of service — reviewed by a lawyer, not
 * written by an AI — before launch. What's here is accurate to the current
 * product: Rizzuno is 18+, requires the affirmation recorded in
 * lib/db.ts's `legal_acceptance` table, connects strangers over live video,
 * and enforces reports/blocks/bans server-side (see app/admin).
 */
export default function TermsOfServicePage() {
  return (
    <main className="mx-auto min-h-full w-full max-w-2xl bg-background px-6 py-16 text-foreground">
      <p className="mb-8 rounded-xl border border-border bg-surface px-4 py-3 text-[13px] text-muted">
        Placeholder — these are not real, reviewed terms of service yet. Replace this page with actual legal copy
        before launch.
      </p>
      <h1 className="text-[28px] font-bold tracking-tight">Terms of Service</h1>
      <p className="mt-2 text-[13px] text-muted">Version {version}</p>

      <div className="mt-8 space-y-6 text-[14px] leading-relaxed text-foreground">
        <section>
          <h2 className="text-[16px] font-semibold">Eligibility</h2>
          <p className="mt-2 text-muted">
            Rizzuno is for adults 18 years of age or older only. You must affirm this before you can use
            matchmaking; this affirmation is a factual record of what you agreed to, not identity-level age
            verification.
          </p>
        </section>
        <section>
          <h2 className="text-[16px] font-semibold">Acceptable use</h2>
          <p className="mt-2 text-muted">
            Rizzuno connects you with strangers over live video. Harassment, sexual content involving anyone who
            hasn&apos;t consented, and other abusive behavior can be reported. Reports are reviewed and can result in
            a warning, temporary suspension, or permanent ban — see our{" "}
            <Link href="/community-guidelines" className="underline underline-offset-2 hover:text-accent">
              Community Guidelines
            </Link>
            .
          </p>
        </section>
        <section>
          <h2 className="text-[16px] font-semibold">Enforcement</h2>
          <p className="mt-2 text-muted">
            Blocks, suspensions, and bans are tied to your account and enforced by our server — they persist across
            sign-outs, refreshes, and new sessions, and can&apos;t be bypassed by reconnecting or by any paid
            feature.
          </p>
        </section>
        <section>
          <h2 className="text-[16px] font-semibold">Your account</h2>
          <p className="mt-2 text-muted">
            You can delete your account from My Profile at any time. See our{" "}
            <Link href="/privacy" className="underline underline-offset-2 hover:text-accent">
              Privacy Policy
            </Link>{" "}
            for what that does and doesn&apos;t remove.
          </p>
        </section>
        <section>
          <h2 className="text-[16px] font-semibold">Contact</h2>
          <p className="mt-2 text-muted">—</p>
        </section>
      </div>
    </main>
  )
}
