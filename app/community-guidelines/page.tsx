import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Community Guidelines — Rizzuno",
  description: "Rizzuno's rules for how to treat the people you're matched with, and how reporting and blocking work.",
}

const LAST_UPDATED = "August 24, 2026"

export default function CommunityGuidelinesPage() {
  return (
    <main className="h-dvh w-full overflow-y-auto overscroll-y-contain bg-background text-foreground">
      <div className="mx-auto w-full max-w-2xl px-6 py-16">
      <h1 className="text-[28px] font-bold tracking-tight">Community Guidelines</h1>
      <p className="mt-2 text-[13px] text-muted">Last updated {LAST_UPDATED}</p>

      <div className="mt-8 space-y-6 text-[14px] leading-relaxed text-foreground">
        <section>
          <h2 className="text-[16px] font-semibold">Be an adult about it</h2>
          <p className="mt-2 text-muted">
            Rizzuno is for users who are at least 18, or the higher age of majority where they live. If you do not
            meet that requirement, you may not use Rizzuno. Every match is a stranger — someone you don&apos;t know
            anything about beyond what they choose to show you. Treat them the way you&apos;d want to be treated by
            a stranger.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-semibold">Not allowed, ever</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted">
            <li>Not meeting Rizzuno&apos;s eligibility age (18, or the age of majority where you live if higher), or knowingly helping someone who doesn&apos;t use Rizzuno.</li>
            <li>Misrepresenting your own eligibility to use Rizzuno.</li>
            <li>Nudity or sexual activity involving anyone who hasn&apos;t consented.</li>
            <li>
              Any sexual content involving, or appearing to involve, a minor — this is treated as an absolute,
              zero-tolerance violation, and may be reported to appropriate authorities where required or permitted
              by law.
            </li>
            <li>Grooming, exploitation, sexualizing, or soliciting anyone who may be a minor.</li>
            <li>Harassment, bullying, or stalking.</li>
            <li>Threats of any kind.</li>
            <li>Hate speech, or content that demeans people based on who they are.</li>
            <li>Violence, or graphic content meant to shock or intimidate.</li>
            <li>Scams — asking for money, gift cards, crypto, or financial/account information.</li>
            <li>Spam or unsolicited advertising.</li>
            <li>Impersonating another person, Rizzuno, or Rizzuno staff.</li>
            <li>Illegal activity of any kind.</li>
            <li>Sharing someone else&apos;s private information (address, phone number, financial details, etc.) without their consent.</li>
            <li>Recording, screenshotting, or distributing another user&apos;s video, audio, or images without their consent.</li>
            <li>Creating a new account, or using a different Google account, to get around a suspension or ban.</li>
          </ul>
          <p className="mt-2 text-muted">
            These map directly onto our{" "}
            <Link href="/terms" className="underline underline-offset-2 hover:text-accent">
              Terms of Service
            </Link>
            , which cover them in fuller legal language.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-semibold">Reporting</h2>
          <p className="mt-2 text-muted">
            The ••• menu on a call lets you report someone in one of a few categories (sexual content, harassment,
            hate, scam, spam, underage concern, violence, or other), with optional details. Your report — its
            category, any details you add, and which call it happened in — is queued for a human moderator to
            review. It is never shown to the person you reported, or to anyone else.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-semibold">Blocking</h2>
          <p className="mt-2 text-muted">
            Blocking someone from the ••• menu is immediate and enforced by our server: the two accounts won&apos;t
            be matched with each other again, regardless of device, tab, sign-out, or new session. As currently
            built, Rizzuno does not have a feature that lets you undo a block once you&apos;ve made it — we&apos;d
            rather tell you that plainly than promise a control you don&apos;t actually have.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-semibold">What happens when you report someone</h2>
          <p className="mt-2 text-muted">
            A human moderator reviews the report against an account&apos;s history and decides on one of: no action,
            an internal warning noted on the account, a temporary suspension, or a permanent ban. Enforcement is
            applied to the Rizzuno/Google account itself — not just the one call — and is designed to persist across
            sign-outs, devices, and new sessions on that same account. Rizzuno enforces against the Google account it
            can identify; it cannot identify or stop the same physical person if they sign in with a completely
            different Google account, and we don&apos;t claim otherwise.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-semibold">Automated filtering — what it does and doesn&apos;t do</h2>
          <p className="mt-2 text-muted">
            In-call chat text and the username you choose pass through a basic keyword filter for the most severe
            content before being shown. This catches obvious, blatant cases — it does not understand context,
            doesn&apos;t catch everything, and is not a substitute for reporting. Images sent in chat are checked
            only for file type and size, not for their content — nothing scans what&apos;s actually in an image.
            Live video and audio are not automatically monitored, recorded, screened, or reviewed by Rizzuno;
            moderation of what happens on a call depends on someone reporting it.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-semibold">Enforcement limitations</h2>
          <p className="mt-2 text-muted">
            Reports are reviewed by people, not resolved instantly — there can be a delay between a report and any
            action taken. Rizzuno can act on the account it verifies you&apos;re signed in as; it cannot prevent
            someone determined to abuse the service from returning under an entirely different Google account. If
            someone&apos;s behavior concerns you, report and block them, and if you believe you&apos;re in danger,
            see our{" "}
            <Link href="/safety" className="underline underline-offset-2 hover:text-accent">
              Safety
            </Link>{" "}
            page.
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
      </div>
    </main>
  )
}
