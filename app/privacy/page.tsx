import type { Metadata } from "next"
import Link from "next/link"
import { REQUIRED_DOCUMENTS } from "@/lib/legalVersions"
import { LEGAL_CONFIG, legalValue } from "@/lib/legalConfig"

export const metadata: Metadata = {
  title: "Privacy Policy — Rizzuno",
  description:
    "How Rizzuno collects, stores, and uses information — for authentication, matchmaking, safety, and moderation.",
}

const version = REQUIRED_DOCUMENTS.find((d) => d.document === "privacy")!.version
const LAST_UPDATED = "August 23, 2026"

const SECTIONS = [
  { id: "operator", label: "1. Who operates Rizzuno" },
  { id: "google-info", label: "2. Information from Google Sign-In" },
  { id: "database-info", label: "3. What Rizzuno's database stores" },
  { id: "profile-info", label: "4. Browser-local profile information" },
  { id: "communications", label: "5. Video, audio, chat & signaling" },
  { id: "technical-info", label: "6. Technical & infrastructure information" },
  { id: "purposes", label: "7. Purpose of processing" },
  { id: "third-parties", label: "8. Third parties & processors" },
  { id: "cookies", label: "9. Cookies & browser storage" },
  { id: "retention", label: "10. Data retention" },
  { id: "deletion", label: "11. Account deletion" },
  { id: "export", label: "12. Data export" },
  { id: "children", label: "13. 18+ users & age affirmation" },
  { id: "security", label: "14. Security" },
  { id: "international", label: "15. International processing" },
  { id: "rights", label: "16. Your rights & controls" },
  { id: "changes", label: "17. Changes to this policy" },
  { id: "contact", label: "18. Contact" },
]

export default function PrivacyPolicyPage() {
  return (
    <main className="h-dvh w-full overflow-y-auto overscroll-y-contain bg-background text-foreground">
      <div className="mx-auto w-full max-w-3xl px-6 py-16 sm:px-10">
        <h1 className="text-[28px] font-bold tracking-tight">Privacy Policy</h1>
        <p className="mt-2 text-[13px] text-muted">
          Version {version} · Last updated {LAST_UPDATED}
        </p>
        <p className="mt-4 text-[14px] leading-relaxed text-muted">
          This Privacy Policy explains what information Rizzuno collects or processes, where it&apos;s stored, why,
          and what controls you have over it. It&apos;s written to match what Rizzuno&apos;s code actually does —
          where something is genuinely undecided, we say so rather than guess.
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
          <section id="operator">
            <h2 className="text-[16px] font-semibold">1. Who operates Rizzuno</h2>
            <p className="mt-2 text-muted">
              {LEGAL_CONFIG.operatorName
                ? `Rizzuno is operated by ${LEGAL_CONFIG.operatorName}${LEGAL_CONFIG.operatorAddress ? `, ${LEGAL_CONFIG.operatorAddress}` : ""}, referred to as "Rizzuno," "we," "us," or "our" in this policy.`
                : legalValue(null, "the legal entity or individual that operates Rizzuno")}
            </p>
          </section>

          <section id="google-info">
            <h2 className="text-[16px] font-semibold">2. Information from Google Sign-In</h2>
            <p className="mt-2 text-muted">
              Rizzuno uses Google Sign-In (via the Auth.js library, running as part of Rizzuno&apos;s own server —
              not a separate company Rizzuno sends your data to) for authentication. The OAuth scopes requested are{" "}
              <code className="rounded bg-surface-2 px-1 py-0.5 text-[12px]">openid</code>,{" "}
              <code className="rounded bg-surface-2 px-1 py-0.5 text-[12px]">email</code>, and{" "}
              <code className="rounded bg-surface-2 px-1 py-0.5 text-[12px]">profile</code> — nothing beyond
              identifying who you are. Rizzuno never requests access to your Gmail, Drive, Calendar, Contacts, or
              other Google data.
            </p>
            <p className="mt-2 text-muted">
              When you sign in, Google shares your Google account&apos;s stable account ID, name, email address, and
              profile photo with Rizzuno&apos;s authentication flow. Of these, only the stable account ID is
              persisted in Rizzuno&apos;s database, as your Rizzuno account identifier. Your name, email address,
              and Google profile photo are processed in-session — they exist in your signed authentication token
              and are available to Rizzuno&apos;s client code for the duration of your session (e.g. to show your
              name on your own device) — but Rizzuno&apos;s server does not write them into its database. We are
              not claiming Google, Auth.js, or your browser never handle these fields; we are describing
              specifically what Rizzuno&apos;s own database stores.
            </p>
          </section>

          <section id="database-info">
            <h2 className="text-[16px] font-semibold">3. What Rizzuno&apos;s database stores</h2>
            <p className="mt-2 text-muted">Rizzuno&apos;s database (hosted Postgres) stores, keyed to your account ID:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
              <li>Your account identifier (Google&apos;s stable account ID) and when the account row was first created.</li>
              <li>Whether the account is banned or suspended, and any reason/expiry recorded for that.</li>
              <li>Whether the account has been marked deleted, and when.</li>
              <li>
                Legal acceptance records — which version of the age affirmation, Terms, and Privacy Policy the
                account accepted, and when — appended to, never overwritten.
              </li>
              <li>Which other account IDs this account has blocked.</li>
              <li>
                Reports involving this account (as reporter or as the account reported): category, any details
                typed in, which call it relates to, and status.
              </li>
              <li>Moderation actions taken against this account, who (which admin) took them, and why.</li>
            </ul>
          </section>

          <section id="profile-info">
            <h2 className="text-[16px] font-semibold">4. Browser-local profile information</h2>
            <p className="mt-2 text-muted">
              Your username, gender, bio, profile photo, and any posts you add are stored only in your own
              browser&apos;s local storage, keyed to your account ID. Rizzuno&apos;s server never receives or stores
              any of these five fields. This means profile data does not sync across devices or browsers, and
              clearing your browser&apos;s site data for Rizzuno removes it entirely. During a live match, this
              information is sent directly to the person you&apos;re matched with over the live connection so they
              can see who they&apos;re talking to — it is not written to Rizzuno&apos;s database as part of that.
            </p>
          </section>

          <section id="communications">
            <h2 className="text-[16px] font-semibold">5. Video, audio, chat &amp; signaling</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted">
              <li>
                <strong className="text-foreground">Video/audio</strong> — streams directly between your device and your match&apos;s device (WebRTC,
                peer-to-peer). Rizzuno&apos;s server does not receive, transmit, monitor, or store this media. Not
                stored, anywhere, ever.
              </li>
              <li>
                <strong className="text-foreground">Signaling</strong> — the short technical handshake (connection offers/answers, network routing
                candidates) that sets up the direct video/audio connection is relayed live through Rizzuno&apos;s
                server. Transient — not stored after it&apos;s relayed.
              </li>
              <li>
                <strong className="text-foreground">Chat text/images</strong> — relayed live through Rizzuno&apos;s server to your current match. Not
                stored once relayed.
              </li>
              <li>
                <strong className="text-foreground">Reports</strong> — if you file one, the category, any details you type, and which call it relates
                to are stored as part of that report. Filing a report does not itself capture or store the
                underlying chat, image, or video/audio content of the call — only what you write in the report.
              </li>
            </ul>
          </section>

          <section id="technical-info">
            <h2 className="text-[16px] font-semibold">6. Technical &amp; infrastructure information</h2>
            <p className="mt-2 text-muted">
              Rizzuno runs on hosted infrastructure (Vercel for the web app, Railway for the realtime/matching
              server, a hosted Postgres provider such as Supabase for the database). Like essentially any web
              service, these providers may automatically process technical information as a normal part of
              operating that infrastructure — for example, your IP address, request timestamps, and basic
              browser/device information may appear in server or platform logs. Rizzuno&apos;s own application code
              does not deliberately log or store your IP address in its database, but we do not claim our
              infrastructure providers never see or process it — that would be inaccurate for any hosted web
              service. Establishing a peer-to-peer video call also uses Google&apos;s public STUN servers as part of
              standard WebRTC connectivity, which as a technical necessity see each participant&apos;s public
              network address in order to help the two devices find a direct path to each other.
            </p>
          </section>

          <section id="purposes">
            <h2 className="text-[16px] font-semibold">7. Purpose of processing</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted">
              <li><strong className="text-foreground">Authentication</strong> — knowing which Google account is signed in, via Auth.js.</li>
              <li><strong className="text-foreground">Matchmaking</strong> — pairing you with another available, opposite-selected-gender account, and honoring blocks.</li>
              <li><strong className="text-foreground">Safety &amp; abuse prevention</strong> — reviewing reports and applying warnings/suspensions/bans.</li>
              <li><strong className="text-foreground">Moderation</strong> — giving admins the information needed to review reports and act consistently.</li>
              <li><strong className="text-foreground">Legal acceptance</strong> — keeping a factual record of what each account agreed to, and when.</li>
              <li><strong className="text-foreground">Service operation</strong> — running matchmaking and relaying live signaling/chat.</li>
              <li><strong className="text-foreground">Security</strong> — rate-limiting account-mutating requests and verifying WebSocket connections belong to the session they claim to.</li>
            </ul>
            <p className="mt-2 text-muted">
              Rizzuno does not use your information for advertising, does not sell it, and does not use it to build
              profiles for third parties.
            </p>
          </section>

          <section id="third-parties">
            <h2 className="text-[16px] font-semibold">8. Third parties &amp; processors</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted">
              <li><strong className="text-foreground">Google</strong> — sign-in/authentication, and public STUN servers used to help establish direct peer-to-peer video calls.</li>
              <li><strong className="text-foreground">Vercel</strong> — hosts Rizzuno&apos;s Next.js web application.</li>
              <li><strong className="text-foreground">Railway</strong> — hosts Rizzuno&apos;s realtime matchmaking/signaling server.</li>
              <li><strong className="text-foreground">Supabase / Postgres</strong> — hosts the database described in Section 3.</li>
            </ul>
            <p className="mt-2 text-muted">
              Auth.js is a software library that runs as part of Rizzuno&apos;s own server code — it is not a
              separate company or service that receives your data independently of Rizzuno. Rizzuno does not
              currently integrate any payment processor, advertising network, or analytics/tracking provider; if
              that changes, this policy will be updated first.
            </p>
          </section>

          <section id="cookies">
            <h2 className="text-[16px] font-semibold">9. Cookies &amp; browser storage</h2>
            <p className="mt-2 text-muted">
              Auth.js sets a small number of essential cookies to keep you signed in — a signed, httpOnly session
              cookie and a CSRF-protection cookie. During the Google sign-in handshake itself, Auth.js may also set
              one or more short-lived cookies (such as an OAuth state/PKCE verifier or callback-URL cookie) that are
              cleared once sign-in completes. All of these are strictly necessary for authentication and security;
              none are used for advertising, cross-site tracking, or analytics.
            </p>
            <p className="mt-2 text-muted">
              Your browser&apos;s local storage is also used, entirely on your own device: to save your profile
              (username, gender, bio, photo, posts) keyed to your account ID as described in Section 4, and to
              cache a cosmetic fallback display name shown before you&apos;ve chosen a username. Rizzuno does not
              currently use browser session storage. Neither local-storage item is sent to Rizzuno&apos;s server
              automatically — they stay in your browser unless a match receives your live profile fields, or unless
              you delete them yourself (e.g. by clearing site data).
            </p>
          </section>

          <section id="retention">
            <h2 className="text-[16px] font-semibold">10. Data retention</h2>
            <p className="mt-2 text-muted">
              This section describes Rizzuno&apos;s actual current behavior — as built today, the application does
              not run any automatic process that purges old records, so server-side data in the categories below is
              retained indefinitely.
            </p>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted">
              <li>
                <strong className="text-foreground">Legal acceptance records</strong> — kept indefinitely as a factual history of what was agreed to and
                when; never overwritten or deleted.
              </li>
              <li>
                <strong className="text-foreground">Reports</strong> — kept indefinitely; no automatic deletion of resolved or pending reports.
              </li>
              <li>
                <strong className="text-foreground">Moderation actions</strong> — kept indefinitely as the record of what enforcement was taken, by whom,
                and why.
              </li>
              <li>
                <strong className="text-foreground">Bans/suspensions</strong> — a suspension automatically stops being enforced once its end time passes,
                but the record of it having happened is retained indefinitely; a ban remains in effect, and its
                record retained, until Rizzuno&apos;s moderation reverses it.
              </li>
              <li>
                <strong className="text-foreground">Blocks</strong> — kept indefinitely; no feature currently removes a block once made (see Section 16).
              </li>
              <li>
                <strong className="text-foreground">Deleted accounts</strong> — see Section 11; deletion marks the account row deleted but does not erase
                the ban/suspension or legal-acceptance history tied to it.
              </li>
            </ul>
            <p className="mt-2 text-muted">
              Rizzuno has not yet adopted formal maximum retention periods for the categories above. Until it does,
              the accurate statement is that this data is retained indefinitely, as described.
            </p>
          </section>

          <section id="deletion">
            <h2 className="text-[16px] font-semibold">11. Account deletion</h2>
            <p className="mt-2 text-muted">
              You can request deletion at any time from My Profile → Privacy &amp; data → Delete account. This marks
              your account row deleted, which immediately prevents it from signing in to matchmake, chat, or call
              again. It does <strong className="text-foreground">not</strong> erase a genuine ban or suspension
              already recorded against that account, and does not erase its legal-acceptance history — both are
              retained for enforcement, fraud prevention, and legal-record purposes, consistent with Section 10.
              Because Rizzuno&apos;s server holds very little personal data to begin with (see Section 3), there is
              little else server-side left to delete beyond marking the account deleted.
            </p>
            <p className="mt-2 text-muted">
              Deleting your account on a given device also clears that device&apos;s locally stored profile data for
              the account. Any other browser or device that separately stored a local copy of your profile keeps
              that copy until you clear it there too — deletion isn&apos;t something Rizzuno&apos;s server can reach
              into another browser and do for you, since that data was never sent to the server.
            </p>
          </section>

          <section id="export">
            <h2 className="text-[16px] font-semibold">12. Data export</h2>
            <p className="mt-2 text-muted">
              My Profile → Privacy &amp; data → Download my data exports everything Rizzuno&apos;s server holds
              about your account: account status, legal-acceptance history, the account IDs you&apos;ve blocked,
              and reports you&apos;ve filed. It does not include your profile content (username, bio, photo,
              posts), because that isn&apos;t stored on the server — it&apos;s already visible in the browser that
              holds it.
            </p>
          </section>

          <section id="children">
            <h2 className="text-[16px] font-semibold">13. 18+ users &amp; age affirmation</h2>
            <p className="mt-2 text-muted">
              Rizzuno is intended for adults 18 years of age or older only, and is not directed at children. Before
              matching, an account must affirm it belongs to someone 18 or older. This affirmation is not
              identity-level or government-ID age verification — Rizzuno does not currently verify a user&apos;s
              real age by any other means, and does not represent that it does. Rizzuno does not knowingly collect
              information from children; if we become aware an account belongs to someone under 18, we will take
              action against that account, including suspension or ban.
            </p>
          </section>

          <section id="security">
            <h2 className="text-[16px] font-semibold">14. Security</h2>
            <p className="mt-2 text-muted">
              Rizzuno takes reasonable measures to protect information, including: signed, httpOnly authentication
              cookies; a short-lived, cryptographically signed ticket (separate from your session cookie) used to
              prove your identity to the realtime server without exposing the session cookie itself; server-side
              verification of every account ID used for matching, blocking, and reporting (never trusting a
              client-supplied claim at face value); encrypted connections to the database; and rate limiting on
              account-sensitive actions. No method of transmission or storage is completely secure, and Rizzuno
              cannot guarantee absolute security.
            </p>
          </section>

          <section id="international">
            <h2 className="text-[16px] font-semibold">15. International processing</h2>
            <p className="mt-2 text-muted">
              Rizzuno&apos;s infrastructure providers (Vercel, Railway, and its database provider) may process and
              store data in locations outside your own country. Rizzuno does not currently represent that it is
              compliant with any specific regional data-protection framework (for example GDPR or CCPA/CPRA) —
              whether such a framework applies, and what additional obligations it creates, depends on decisions
              Rizzuno&apos;s operator has not yet finalized (including its legal entity, its jurisdiction of
              operation, and which regions it intends to serve).
            </p>
          </section>

          <section id="rights">
            <h2 className="text-[16px] font-semibold">16. Your rights &amp; controls</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted">
              <li><strong className="text-foreground">Download your data</strong> — see Section 12.</li>
              <li><strong className="text-foreground">Delete your account</strong> — see Section 11.</li>
              <li>
                <strong className="text-foreground">Block</strong> — enforced server-side; as currently built, Rizzuno does not provide a way to
                reverse a block once made — we do not promise an &ldquo;unblock&rdquo; capability that doesn&apos;t
                exist.
              </li>
              <li><strong className="text-foreground">Report</strong> — sent to human moderation for review; never shown to the reported user.</li>
              <li><strong className="text-foreground">Edit or clear your local profile</strong> — directly, any time, from My Profile.</li>
            </ul>
            <p className="mt-2 text-muted">
              Beyond what&apos;s listed above, Rizzuno does not represent that you have specific statutory data
              rights (such as a formal right to correction or portability under a particular law) until its
              operator determines which jurisdiction(s) and legal frameworks actually apply to its operation.
            </p>
          </section>

          <section id="changes">
            <h2 className="text-[16px] font-semibold">17. Changes to this policy</h2>
            <p className="mt-2 text-muted">
              When we make a material change to this policy, we update the version and date at the top of this
              page, and accounts that previously accepted an older version are asked to review and accept the
              current one again before continuing to use Rizzuno. Your prior acceptance record is never rewritten —
              only added to.
            </p>
          </section>

          <section id="contact">
            <h2 className="text-[16px] font-semibold">18. Contact</h2>
            <p className="mt-2 text-muted">
              {LEGAL_CONFIG.contactEmail
                ? `Questions about this Privacy Policy, or requests relating to your data, can be sent to ${LEGAL_CONFIG.contactEmail}.`
                : legalValue(null, "a contact address for privacy questions or data requests")}
            </p>
            <p className="mt-2 text-muted">
              See also our{" "}
              <Link href="/terms" className="underline underline-offset-2 hover:text-accent">
                Terms of Service
              </Link>
              .
            </p>
          </section>
        </div>
      </div>
    </main>
  )
}
