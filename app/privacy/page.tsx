import type { Metadata } from "next"
import Link from "next/link"
import { REQUIRED_DOCUMENTS } from "@/lib/legalVersions"

export const metadata: Metadata = {
  title: "Privacy Policy — Rizzuno",
}

const version = REQUIRED_DOCUMENTS.find((d) => d.document === "privacy")!.version

/**
 * Placeholder content — this page exists so https://rizzuno.com/privacy is
 * a real, reachable URL (Google's OAuth consent screen requires one, and
 * AgeGate links here), not because the text below is final legal copy.
 * Replace it with an actual privacy policy — reviewed by a lawyer, not
 * written by an AI — before launch. What's here is accurate to the current
 * product; see lib/db.ts for the actual schema this describes.
 */
export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto min-h-full w-full max-w-2xl bg-background px-6 py-16 text-foreground">
      <p className="mb-8 rounded-xl border border-border bg-surface px-4 py-3 text-[13px] text-muted">
        Placeholder — this is not a real, reviewed privacy policy yet. Replace this page with actual legal copy
        before launch.
      </p>
      <h1 className="text-[28px] font-bold tracking-tight">Privacy Policy</h1>
      <p className="mt-2 text-[13px] text-muted">Version {version}</p>

      <div className="mt-8 space-y-6 text-[14px] leading-relaxed text-foreground">
        <section>
          <h2 className="text-[16px] font-semibold">Information we collect</h2>
          <p className="mt-2 text-muted">
            When you sign in with Google, we receive your name, email address, and profile photo — used only to
            authenticate you; Google&apos;s own stable account id is your Rizzuno identity. Your profile
            (username, bio, photo, posts) is stored only in your own browser, not on our servers. During a match,
            your camera and microphone connect directly to the person you&apos;re matched with. In-call chat
            messages and images are relayed live and are not stored after the call ends.
          </p>
        </section>
        <section>
          <h2 className="text-[16px] font-semibold">What we store on our server</h2>
          <p className="mt-2 text-muted">
            Your account id, whether you&apos;ve accepted these Terms/Privacy and when, whether you&apos;ve blocked
            or been blocked by another account, and any reports involving your account (used for moderation). We do
            not store your name, email, profile photos, or chat content on our server.
          </p>
        </section>
        <section>
          <h2 className="text-[16px] font-semibold">How reports and blocks are used</h2>
          <p className="mt-2 text-muted">
            Reports are reviewed by authorized moderators only and can lead to a warning, suspension, or permanent
            ban. Blocks are enforced server-side and prevent two accounts from being matched again. Neither is
            shown to other users.
          </p>
        </section>
        <section>
          <h2 className="text-[16px] font-semibold">Your controls</h2>
          <p className="mt-2 text-muted">
            From My Profile you can edit or clear your profile data, download a copy of what our server stores
            about your account, and delete your account. Deleting your account removes what personal data we hold,
            except records we&apos;re required or entitled to keep for security, fraud prevention, legal
            obligations, or enforcement of an existing ban. See our{" "}
            <Link href="/terms" className="underline underline-offset-2 hover:text-accent">
              Terms of Service
            </Link>
            .
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
