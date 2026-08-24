import type { Metadata } from "next"
import Link from "next/link"
import { REQUIRED_DOCUMENTS } from "@/lib/legalVersions"
import { LEGAL_CONFIG } from "@/lib/legalConfig"

export const metadata: Metadata = {
  title: "Terms of Service — Rizzuno",
  description:
    "The Terms of Service governing use of Rizzuno, a live video-chat service intended for adults that connects users with strangers.",
}

const version = REQUIRED_DOCUMENTS.find((d) => d.document === "terms")!.version
const LAST_UPDATED = "August 24, 2026"

const SECTIONS = [
  { id: "acceptance", label: "1. Acceptance of Terms" },
  { id: "eligibility", label: "2. 18+ eligibility" },
  { id: "google-account", label: "3. Google-authenticated accounts" },
  { id: "account-responsibility", label: "4. Account responsibility" },
  { id: "what-rizzuno-does", label: "5. What Rizzuno does" },
  { id: "stranger-interaction", label: "6. Random stranger interaction" },
  { id: "webrtc", label: "7. Live WebRTC video & audio" },
  { id: "text-image", label: "8. Text & image communication" },
  { id: "profiles-ugc", label: "9. Profiles & user-generated content" },
  { id: "acceptable-use", label: "10. Acceptable use" },
  { id: "prohibited-conduct", label: "11. Prohibited conduct" },
  { id: "minors", label: "12. Minors & sexual exploitation" },
  { id: "nonconsensual-sexual", label: "13. Non-consensual sexual content" },
  { id: "harassment", label: "14. Harassment & stalking" },
  { id: "hate-violence", label: "15. Hate, threats & violence" },
  { id: "scams", label: "16. Scams, fraud & spam" },
  { id: "illegal", label: "17. Illegal activity" },
  { id: "recording", label: "18. Recording & screenshots without consent" },
  { id: "private-info", label: "19. Personal & private information" },
  { id: "impersonation", label: "20. Impersonation" },
  { id: "evasion", label: "21. Bypassing bans, security & rate limits" },
  { id: "reports", label: "22. Reports" },
  { id: "blocks", label: "23. Blocks" },
  { id: "moderation", label: "24. Moderation" },
  { id: "enforcement", label: "25. Warnings, suspensions & bans" },
  { id: "enforcement-limits", label: "26. Enforcement limitations" },
  { id: "deletion", label: "27. Account deletion" },
  { id: "availability", label: "28. Service availability" },
  { id: "network-limits", label: "29. WebRTC & network limitations" },
  { id: "third-party", label: "30. Third-party infrastructure" },
  { id: "ip", label: "31. Intellectual property" },
  { id: "content-ownership", label: "32. User content, ownership & limited license" },
  { id: "feedback", label: "33. Feedback" },
  { id: "disclaimers", label: "34. Disclaimers" },
  { id: "liability", label: "35. Limitation of liability" },
  { id: "indemnification", label: "36. Indemnification" },
  { id: "no-relationship", label: "37. No business relationship" },
  { id: "changes-service", label: "38. Changes to Rizzuno" },
  { id: "changes-terms", label: "39. Changes to these Terms" },
  { id: "acceptance-history", label: "40. Legal-version acceptance history" },
  { id: "related", label: "41. Related policies" },
  { id: "survival", label: "42. Survival" },
  { id: "severability", label: "43. Severability" },
  { id: "contact", label: "44. Governing law & contact" },
]

export default function TermsOfServicePage() {
  return (
    <main className="h-dvh w-full overflow-y-auto overscroll-y-contain bg-background text-foreground">
      <div className="mx-auto w-full max-w-3xl px-6 py-16 sm:px-10">
        <h1 className="text-[28px] font-bold tracking-tight">Terms of Service</h1>
        <p className="mt-2 text-[13px] text-muted">
          Version {version} · Last updated {LAST_UPDATED}
        </p>
        <p className="mt-4 text-[14px] leading-relaxed text-muted">
          These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of Rizzuno, a live video-chat
          service that connects you with other users at random. They describe what you&apos;re agreeing to when you
          use Rizzuno, and what Rizzuno can and can&apos;t promise you in return.
        </p>

        <nav className="mt-8 rounded-xl border border-border bg-surface px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted">On this page</p>
          <ul className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-2">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className="text-muted underline-offset-2 hover:text-accent hover:underline">
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-8 space-y-7 text-[14px] leading-relaxed text-foreground">
          <section id="acceptance">
            <h2 className="text-[16px] font-semibold">1. Acceptance of Terms</h2>
            <p className="mt-2 text-muted">
              By creating a Rizzuno account, checking the affirmation box shown after you sign in, or otherwise
              using Rizzuno, you agree to these Terms and to our{" "}
              <Link href="/privacy" className="underline underline-offset-2 hover:text-accent">
                Privacy Policy
              </Link>
              . If you don&apos;t agree, don&apos;t use Rizzuno.
            </p>
          </section>

          <section id="eligibility">
            <h2 className="text-[16px] font-semibold">2. 18+ eligibility</h2>
            <p className="mt-2 text-muted">
              Rizzuno is intended exclusively for adults. You may use Rizzuno only if you are at least 18 years old,
              or the age of majority in the jurisdiction where you live if that age is higher than 18.
            </p>
            <p className="mt-2 text-muted">
              By continuing to access or use Rizzuno — including by continuing through Google Sign-In after being
              presented with Rizzuno&apos;s age notice, and by checking the affirmation box shown after you sign in
              — you represent and warrant that you satisfy this age requirement.
            </p>
            <p className="mt-2 text-muted">If you do not satisfy this age requirement, you must not access or use Rizzuno.</p>
            <p className="mt-2 text-muted">
              Rizzuno currently relies on this representation as an age-eligibility self-attestation, recorded
              against your account together with the version of these Terms and the date you accepted them (see
              Section 40). Google Sign-In authenticates the Google account used to access Rizzuno; it does not
              constitute age verification by Google or by Rizzuno. Rizzuno does not currently perform government-ID,
              biometric, facial-age-estimation, or other independent identity-level age verification, and does not
              guarantee that another user&apos;s stated age is accurate.
            </p>
          </section>

          <section id="google-account">
            <h2 className="text-[16px] font-semibold">3. Google-authenticated accounts</h2>
            <p className="mt-2 text-muted">
              You sign in to Rizzuno using Google Sign-In. There is no separate Rizzuno username/password login —
              your Rizzuno account is tied to your Google account&apos;s own stable account ID. Signing in with the
              same Google account always resolves to the same Rizzuno account, whether it&apos;s your first time or
              your hundredth.
            </p>
          </section>

          <section id="account-responsibility">
            <h2 className="text-[16px] font-semibold">4. Account responsibility</h2>
            <p className="mt-2 text-muted">
              You&apos;re responsible for maintaining the security of the Google account you use to sign in, and for
              all activity that happens under it. If you believe your Google account has been compromised, secure it
              directly with Google and, if needed, stop using Rizzuno with it. Because your Rizzuno identity is your
              Google account&apos;s own stable ID, Rizzuno can recognize and act on that specific account across
              sign-outs, devices, and sessions — but Rizzuno cannot identify you as a real-world individual across a{" "}
              <em>different</em> Google account, and does not claim to.
            </p>
          </section>

          <section id="what-rizzuno-does">
            <h2 className="text-[16px] font-semibold">5. What Rizzuno does</h2>
            <p className="mt-2 text-muted">
              Rizzuno connects you at random with another signed-in user who has affirmed that they meet
              Rizzuno&apos;s age requirement, for a live, one-on-one video and audio call with in-call text and
              image chat. Rizzuno&apos;s servers handle matching you with someone, relaying the technical handshake
              that sets up a direct connection, relaying in-call chat live, and enforcing reports, blocks, and bans.
              Rizzuno does not itself verify that affirmation and does not otherwise verify a user&apos;s identity —
              see Section 2 and Section 26.
            </p>
          </section>

          <section id="stranger-interaction">
            <h2 className="text-[16px] font-semibold">6. Random stranger interaction</h2>
            <p className="mt-2 text-muted">
              Every person you&apos;re matched with is someone you have not chosen and have no prior relationship
              with through Rizzuno. Matching pairs opposite-selected genders at random among whoever is available;
              you don&apos;t pick, preview, or vet who you&apos;re about to talk to before the call starts.
            </p>
          </section>

          <section id="webrtc">
            <h2 className="text-[16px] font-semibold">7. Live WebRTC video &amp; audio</h2>
            <p className="mt-2 text-muted">
              Calls happen over WebRTC, a peer-to-peer technology. Once connected, your camera and microphone stream
              directly to the other person&apos;s device rather than through Rizzuno&apos;s servers, and Rizzuno
              does not monitor, record, or review that stream. Establishing this direct connection can expose
              limited network information — such as your public IP address — to the person you&apos;re matched with
              and to the connectivity infrastructure involved in setting it up (see Section 30 and our{" "}
              <Link href="/privacy" className="underline underline-offset-2 hover:text-accent">
                Privacy Policy
              </Link>
              ); that&apos;s an inherent characteristic of how peer-to-peer WebRTC calls connect, not something
              Rizzuno adds. See also our{" "}
              <Link href="/safety" className="underline underline-offset-2 hover:text-accent">
                Safety
              </Link>{" "}
              page.
            </p>
          </section>

          <section id="text-image">
            <h2 className="text-[16px] font-semibold">8. Text &amp; image communication</h2>
            <p className="mt-2 text-muted">
              In-call text and image chat messages are relayed live through Rizzuno&apos;s server to whoever
              you&apos;re currently matched with, and are not stored once relayed. Chat text, and the username you
              choose, pass through a basic keyword filter for the most severe content before being shown — this
              catches obvious cases only and is not comprehensive moderation. Images sent in chat are checked only
              for file type and size before being relayed, not for their content — nothing scans, filters, or
              reviews what an image actually shows.
            </p>
          </section>

          <section id="profiles-ugc">
            <h2 className="text-[16px] font-semibold">9. Profiles &amp; user-generated content</h2>
            <p className="mt-2 text-muted">
              Your profile (username, gender, bio, photo, and any posts) is stored persistently only in your own
              browser. Some fields — your username, gender, and profile photo — are also sent to Rizzuno&apos;s
              realtime service while you&apos;re using it, so a current match can see them; your bio and posts are
              never sent to Rizzuno&apos;s servers at all. You&apos;re solely responsible for what you put in your
              profile. See our{" "}
              <Link href="/privacy" className="underline underline-offset-2 hover:text-accent">
                Privacy Policy
              </Link>{" "}
              for the exact, field-by-field breakdown.
            </p>
          </section>

          <section id="acceptable-use">
            <h2 className="text-[16px] font-semibold">10. Acceptable use</h2>
            <p className="mt-2 text-muted">
              You agree to use Rizzuno only for lawful purposes and in a way that respects the people you&apos;re
              matched with. Sections 12–21 below describe specific conduct that is never allowed, but that list
              isn&apos;t exhaustive — Rizzuno may also act on other conduct that&apos;s clearly abusive, unlawful, or
              harmful even if it isn&apos;t individually named here.
            </p>
          </section>

          <section id="prohibited-conduct">
            <h2 className="text-[16px] font-semibold">11. Prohibited conduct</h2>
            <p className="mt-2 text-muted">On Rizzuno, you agree not to, and confirm you will not:</p>
          </section>

          <section id="minors">
            <h2 className="text-[16px] font-semibold">12. Minors &amp; sexual exploitation</h2>
            <p className="mt-2 text-muted">
              Use Rizzuno if you don&apos;t meet the eligibility age described in Section 2 — parental or guardian
              permission does not make use of Rizzuno by someone who doesn&apos;t meet that age allowed — or
              knowingly facilitate access to Rizzuno by anyone who doesn&apos;t meet it. Misrepresenting your own
              eligibility under Section 2 is itself a violation of these Terms. Create, share, request, or engage in
              any sexual content involving, or that appears to involve, a minor, or otherwise engage in the sexual
              exploitation, grooming, or solicitation of a minor. This is prohibited absolutely, and may be reported
              to appropriate authorities where required or permitted by law.
            </p>
            <p className="mt-2 text-muted">
              If Rizzuno reasonably believes an account does not meet the eligibility requirement in Section 2,
              Rizzuno may suspend or terminate that account. Rizzuno does not automatically detect this — if you
              suspect another user doesn&apos;t meet Rizzuno&apos;s age requirement, report it using the
              &ldquo;Underage concern&rdquo; category in the in-call safety menu (see Section 22).
            </p>
          </section>

          <section id="nonconsensual-sexual">
            <h2 className="text-[16px] font-semibold">13. Non-consensual sexual content</h2>
            <p className="mt-2 text-muted">
              Engage in or display nudity or sexual activity involving anyone who has not consented, or otherwise
              share sexual content without the consent of everyone involved.
            </p>
          </section>

          <section id="harassment">
            <h2 className="text-[16px] font-semibold">14. Harassment &amp; stalking</h2>
            <p className="mt-2 text-muted">
              Harass, bully, stalk, or threaten another user, or encourage self-harm or suicide.
            </p>
          </section>

          <section id="hate-violence">
            <h2 className="text-[16px] font-semibold">15. Hate, threats &amp; violence</h2>
            <p className="mt-2 text-muted">
              Express hatred or incite violence or discrimination based on race, ethnicity, national origin,
              religion, disability, gender, gender identity, sexual orientation, age, or similar protected
              characteristics. Threaten or engage in violence, or display graphic violence intended to shock or
              intimidate.
            </p>
          </section>

          <section id="scams">
            <h2 className="text-[16px] font-semibold">16. Scams, fraud &amp; spam</h2>
            <p className="mt-2 text-muted">
              Run scams, solicit money or financial information, engage in fraud, send spam or unsolicited
              advertising, or use Rizzuno for commercial solicitation.
            </p>
          </section>

          <section id="illegal">
            <h2 className="text-[16px] font-semibold">17. Illegal activity</h2>
            <p className="mt-2 text-muted">Engage in or promote any other illegal conduct.</p>
          </section>

          <section id="recording">
            <h2 className="text-[16px] font-semibold">18. Recording &amp; screenshots without consent</h2>
            <p className="mt-2 text-muted">
              Record, screenshot, photograph, or otherwise capture another user&apos;s video, audio, image, or chat
              without their consent, or distribute anything captured from a Rizzuno call without consent. This rule
              applies regardless of what your own device, browser, or operating system is technically capable of
              capturing — Rizzuno has no way to detect or prevent a recording made outside its own servers, which is
              exactly why this is a rule for users rather than something Rizzuno can enforce automatically.
            </p>
          </section>

          <section id="private-info">
            <h2 className="text-[16px] font-semibold">19. Personal &amp; private information</h2>
            <p className="mt-2 text-muted">
              Share another person&apos;s private information (their address, phone number, financial details,
              etc.) without their consent.
            </p>
          </section>

          <section id="impersonation">
            <h2 className="text-[16px] font-semibold">20. Impersonation</h2>
            <p className="mt-2 text-muted">
              Impersonate another person, Rizzuno, or Rizzuno staff, or misrepresent your affiliation with any
              person or entity.
            </p>
          </section>

          <section id="evasion">
            <h2 className="text-[16px] font-semibold">21. Bypassing bans, security &amp; rate limits</h2>
            <p className="mt-2 text-muted">
              Attempt to evade a suspension or ban — including by creating or using another account, or another
              Google account, to continue behavior that led to enforcement against you — or interfere with,
              disrupt, probe, or bypass Rizzuno&apos;s security or rate limits, or access it by any means other than
              the interface Rizzuno provides.
            </p>
            <p className="mt-2 text-muted">
              Our{" "}
              <Link href="/community-guidelines" className="underline underline-offset-2 hover:text-accent">
                Community Guidelines
              </Link>{" "}
              explain Sections 12–21 in plain language.
            </p>
          </section>

          <section id="reports">
            <h2 className="text-[16px] font-semibold">22. Reports</h2>
            <p className="mt-2 text-muted">
              You can report a user during or after a call from the in-call safety menu, in one of a few categories,
              with optional details. A report is recorded (its category, any details you add, and which call it
              relates to) and queued for a human moderator&apos;s review. It is never shown to the person you
              reported.
            </p>
          </section>

          <section id="blocks">
            <h2 className="text-[16px] font-semibold">23. Blocks</h2>
            <p className="mt-2 text-muted">
              You can block a user at any time from the in-call safety menu. A block is enforced by our server: once
              you block someone, the two Rizzuno/Google accounts involved will not be matched with each other
              again. As currently built, Rizzuno does not have a feature that lets you reverse a block once made —
              we don&apos;t promise an &ldquo;unblock&rdquo; capability that doesn&apos;t exist.
            </p>
          </section>

          <section id="moderation">
            <h2 className="text-[16px] font-semibold">24. Moderation</h2>
            <p className="mt-2 text-muted">
              Reports are reviewed by human moderators, not resolved automatically. Rizzuno does not monitor,
              record, or review live video or audio, and does not automatically screen calls for violations — the
              filtering described in Section 8 covers chat text and usernames only, not images and not video/audio.
              Moderation of what happens on a call substantially depends on it being reported.
            </p>
          </section>

          <section id="enforcement">
            <h2 className="text-[16px] font-semibold">25. Warnings, suspensions &amp; bans</h2>
            <p className="mt-2 text-muted">
              A reviewed report can result in no action, an internal warning on the account&apos;s moderation
              record, a temporary suspension, or a permanent ban, at Rizzuno&apos;s discretion. Rizzuno may also
              take any of these actions, or otherwise discontinue your access, for any other reason at its
              discretion, including suspected abuse, fraud, or risk to other users — with or without a prior report.
              A ban or suspension record tied to an account is retained even if the account is later deleted, so
              it isn&apos;t erased by deleting and re-registering.
            </p>
          </section>

          <section id="enforcement-limits">
            <h2 className="text-[16px] font-semibold">26. Enforcement limitations</h2>
            <p className="mt-2 text-muted">
              Enforcement applies to the Rizzuno/Google account involved and is designed to persist across sessions
              and devices signed in with that account. Rizzuno enforces against the Google account it can identify —
              it has no way to identify or stop the same physical person if they use a different Google account, and
              does not represent otherwise. Reports are reviewed by people, not resolved instantly, and Rizzuno
              cannot guarantee that every violation is caught, reported, or acted on.
            </p>
          </section>

          <section id="deletion">
            <h2 className="text-[16px] font-semibold">27. Account deletion</h2>
            <p className="mt-2 text-muted">
              You can delete your account at any time from My Profile → Privacy &amp; data → Delete account. This
              marks your account deleted and prevents it from signing back in to match, chat, or call — but a
              genuine ban or suspension tied to that account, and its legal-acceptance history, are retained even
              after deletion, for enforcement and legal-record purposes (see our{" "}
              <Link href="/privacy" className="underline underline-offset-2 hover:text-accent">
                Privacy Policy
              </Link>
              ). Deletion clears your locally stored profile on the device you delete from; any other browser or
              device that separately stored a copy keeps it until cleared there too.
            </p>
          </section>

          <section id="availability">
            <h2 className="text-[16px] font-semibold">28. Service availability</h2>
            <p className="mt-2 text-muted">
              Rizzuno is provided on an &ldquo;as available&rdquo; basis. Matching depends on how many other users
              are online at the time; there is no guarantee you&apos;ll be matched quickly, or at all. Rizzuno does
              not guarantee uninterrupted, error-free, or continuous availability of the service.
            </p>
          </section>

          <section id="network-limits">
            <h2 className="text-[16px] font-semibold">29. WebRTC &amp; network limitations</h2>
            <p className="mt-2 text-muted">
              Live video/audio calls use WebRTC, a real-time peer-to-peer technology that depends on both
              users&apos; network conditions, devices, and browsers. Connection quality, delays, drops, and
              occasional failures to connect are normal characteristics of this technology, not a defect specific to
              Rizzuno.
            </p>
          </section>

          <section id="third-party">
            <h2 className="text-[16px] font-semibold">30. Third-party infrastructure</h2>
            <p className="mt-2 text-muted">
              Rizzuno relies on third-party infrastructure to operate — sign-in through Google, hosting through
              Vercel and Railway, a database provider (e.g. Supabase), and Google&apos;s public STUN servers to help
              establish peer-to-peer calls. See our{" "}
              <Link href="/privacy" className="underline underline-offset-2 hover:text-accent">
                Privacy Policy
              </Link>{" "}
              for how these are used. Rizzuno is not responsible for the availability or conduct of third-party
              services outside its control.
            </p>
          </section>

          <section id="ip">
            <h2 className="text-[16px] font-semibold">31. Intellectual property</h2>
            <p className="mt-2 text-muted">
              Rizzuno and its branding, design, and software are owned by Rizzuno&apos;s operator or its licensors.
              You may not copy, modify, reverse-engineer, or create derivative works of Rizzuno&apos;s software or
              branding except as the law expressly allows despite this restriction.
            </p>
          </section>

          <section id="content-ownership">
            <h2 className="text-[16px] font-semibold">32. User content, ownership &amp; limited license</h2>
            <p className="mt-2 text-muted">
              Subject to these Terms, Rizzuno grants you a personal, limited, non-exclusive, non-transferable,
              revocable license to access and use Rizzuno for your own personal, non-commercial use.
            </p>
            <p className="mt-2 text-muted">
              You keep whatever ownership rights you already have in your own content, and you&apos;re solely
              responsible for anything you say, show, send, or post on Rizzuno. In the other direction, to operate
              the service you grant Rizzuno only the limited, non-exclusive permission reasonably necessary to
              transmit, display, process, secure, and moderate that content for the purpose of running Rizzuno — for
              example, relaying your chat messages and call signaling to whoever you&apos;re matched with, and
              storing what you write into a report. This license is limited to what running the service actually
              requires; it doesn&apos;t give Rizzuno any broader right to reuse, license, or commercially exploit
              your content, and it ends along with the underlying use (most of your content, per Section 9, is never
              even sent to Rizzuno&apos;s servers to begin with).
            </p>
          </section>

          <section id="feedback">
            <h2 className="text-[16px] font-semibold">33. Feedback</h2>
            <p className="mt-2 text-muted">
              If you send us feedback, suggestions, or ideas about Rizzuno, you agree we can use them without owing
              you anything for it, and without an obligation to keep them confidential.
            </p>
          </section>

          <section id="disclaimers">
            <h2 className="text-[16px] font-semibold">34. Disclaimers</h2>
            <p className="mt-2 text-muted">
              RIZZUNO IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE,&rdquo; WITHOUT WARRANTIES OF ANY
              KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS
              FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. Rizzuno does not verify the identity, age, intentions,
              or conduct of other users beyond the affirmation described in Section 2, and cannot guarantee your
              safety when interacting with a stranger. You use Rizzuno, and interact with people you meet on it, at
              your own risk. See our{" "}
              <Link href="/safety" className="underline underline-offset-2 hover:text-accent">
                Safety
              </Link>{" "}
              page for practical guidance.
            </p>
          </section>

          <section id="liability">
            <h2 className="text-[16px] font-semibold">35. Limitation of liability</h2>
            <p className="mt-2 text-muted">
              TO THE FULLEST EXTENT PERMITTED BY LAW, RIZZUNO AND ITS OPERATOR WILL NOT BE LIABLE FOR ANY INDIRECT,
              INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF DATA, PROFITS, OR GOODWILL,
              ARISING FROM YOUR USE OF RIZZUNO OR YOUR INTERACTIONS WITH OTHER USERS — INCLUDING CONDUCT BY OTHER
              USERS THAT RIZZUNO DID NOT KNOW ABOUT AND HAD NO REASONABLE WAY TO PREVENT — EVEN IF ADVISED OF THE
              POSSIBILITY OF SUCH DAMAGES. Some jurisdictions don&apos;t allow certain limitations on liability, so
              some of the above may not apply to you depending on where you live.
            </p>
          </section>

          <section id="indemnification">
            <h2 className="text-[16px] font-semibold">36. Indemnification</h2>
            <p className="mt-2 text-muted">
              You agree to defend, indemnify, and hold harmless Rizzuno and its operator from claims, damages, and
              expenses (including reasonable legal fees) arising from your violation of these Terms, your violation
              of any law or third-party right, or content you send or share through Rizzuno, to the extent permitted
              by applicable law.
            </p>
          </section>

          <section id="no-relationship">
            <h2 className="text-[16px] font-semibold">37. No business relationship</h2>
            <p className="mt-2 text-muted">
              Using Rizzuno does not create a partnership, joint venture, agency, employment, or franchise
              relationship between you and Rizzuno.
            </p>
          </section>

          <section id="changes-service">
            <h2 className="text-[16px] font-semibold">38. Changes to Rizzuno</h2>
            <p className="mt-2 text-muted">
              Rizzuno may add, change, or remove features, or discontinue the service, at any time.
            </p>
          </section>

          <section id="changes-terms">
            <h2 className="text-[16px] font-semibold">39. Changes to these Terms</h2>
            <p className="mt-2 text-muted">
              We may update these Terms. When we make a material change, we update the version and date at the top
              of this page, and accounts that previously accepted an older version are asked to review and accept
              the current one again before continuing to use Rizzuno. Continuing to use Rizzuno after a change takes
              effect means you accept the updated Terms.
            </p>
          </section>

          <section id="acceptance-history">
            <h2 className="text-[16px] font-semibold">40. Legal-version acceptance history</h2>
            <p className="mt-2 text-muted">
              Rizzuno keeps a record of which version of the age affirmation, these Terms, and the Privacy Policy
              your account accepted, and when. That record is appended to, never overwritten or deleted — a prior
              acceptance of an older version stays on file even after you accept a newer one.
            </p>
          </section>

          <section id="related">
            <h2 className="text-[16px] font-semibold">41. Related policies</h2>
            <p className="mt-2 text-muted">
              These Terms work together with our{" "}
              <Link href="/privacy" className="underline underline-offset-2 hover:text-accent">
                Privacy Policy
              </Link>
              ,{" "}
              <Link href="/community-guidelines" className="underline underline-offset-2 hover:text-accent">
                Community Guidelines
              </Link>
              , and{" "}
              <Link href="/safety" className="underline underline-offset-2 hover:text-accent">
                Safety
              </Link>{" "}
              page, each of which is part of your agreement with Rizzuno.
            </p>
          </section>

          <section id="survival">
            <h2 className="text-[16px] font-semibold">42. Survival</h2>
            <p className="mt-2 text-muted">
              Sections that by their nature should survive your stopping use of Rizzuno — including Intellectual
              Property (31), User Content, Ownership &amp; Limited License (32), Disclaimers (34), Limitation of
              Liability (35), Indemnification (36), and any obligation you accrued before you stopped using Rizzuno
              — remain in effect after your account is deleted or your access ends.
            </p>
          </section>

          <section id="severability">
            <h2 className="text-[16px] font-semibold">43. Severability</h2>
            <p className="mt-2 text-muted">
              If any part of these Terms is found unenforceable, the rest remains in full force, and the
              unenforceable part is interpreted to reflect the parties&apos; original intent as closely as the law
              allows.
            </p>
          </section>

          <section id="contact">
            <h2 className="text-[16px] font-semibold">44. Governing law &amp; contact</h2>
            {LEGAL_CONFIG.governingLaw && (
              <p className="mt-2 text-muted">These Terms are governed by {LEGAL_CONFIG.governingLaw}.</p>
            )}
            {LEGAL_CONFIG.disputeResolution && <p className="mt-2 text-muted">{LEGAL_CONFIG.disputeResolution}</p>}
            {LEGAL_CONFIG.operatorName && LEGAL_CONFIG.contactEmail ? (
              <p className="mt-2 text-muted">
                Rizzuno is operated by {LEGAL_CONFIG.operatorName}. Questions about these Terms can be sent to{" "}
                {LEGAL_CONFIG.contactEmail}.
              </p>
            ) : LEGAL_CONFIG.operatorName ? (
              <p className="mt-2 text-muted">Rizzuno is operated by {LEGAL_CONFIG.operatorName}.</p>
            ) : LEGAL_CONFIG.contactEmail ? (
              <p className="mt-2 text-muted">Questions about these Terms can be sent to {LEGAL_CONFIG.contactEmail}.</p>
            ) : (
              <p className="mt-2 text-muted">
                This policy does not yet name Rizzuno&apos;s operating entity or a dedicated contact address for
                these Terms.
              </p>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}
