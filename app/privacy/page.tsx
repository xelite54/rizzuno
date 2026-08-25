import type { Metadata } from "next"
import Link from "next/link"
import { REQUIRED_DOCUMENTS } from "@/lib/legalVersions"
import { LEGAL_CONFIG } from "@/lib/legalConfig"

export const metadata: Metadata = {
  title: "Privacy Policy — Rizzuno",
  description:
    "How Rizzuno collects, stores, and uses information — for authentication, matchmaking, safety, and moderation.",
}

const version = REQUIRED_DOCUMENTS.find((d) => d.document === "privacy")!.version
const LAST_UPDATED = "August 25, 2026"

const SECTIONS = [
  { id: "operator", label: "1. Who operates Rizzuno" },
  { id: "google-info", label: "2. Information from Google Sign-In" },
  { id: "database-info", label: "3. What Rizzuno's database stores" },
  { id: "profile-info", label: "4. Profile information: local storage & realtime processing" },
  { id: "communications", label: "5. Video, audio, chat & signaling" },
  { id: "technical-info", label: "6. Technical & infrastructure information" },
  { id: "purposes", label: "7. Purpose of processing" },
  { id: "third-parties", label: "8. Third parties & processors" },
  { id: "cookies", label: "9. Cookies & browser storage" },
  { id: "tracking", label: "10. Online tracking, Do Not Track & GPC" },
  { id: "sale", label: "11. Data sale & targeted advertising" },
  { id: "retention", label: "12. Data retention" },
  { id: "deletion", label: "13. Privacy and deletion requests" },
  { id: "export", label: "14. Data export" },
  { id: "children", label: "15. 18+ users & age affirmation" },
  { id: "security", label: "16. Security" },
  { id: "international", label: "17. International processing" },
  { id: "rights", label: "18. Your rights & controls" },
  { id: "state-rights", label: "19. U.S. state privacy rights" },
  { id: "caloppa", label: "20. California privacy disclosures (CalOPPA)" },
  { id: "changes", label: "21. Changes to this policy" },
  { id: "contact", label: "22. Contact" },
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
          where something is genuinely undecided, we say so rather than guess. Rizzuno does not claim this policy
          satisfies every privacy law that could ever apply to every visitor — applicability depends on factors like
          where you live, and is addressed as specifically as we can in Sections 17–20.
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
            {LEGAL_CONFIG.operatorName ? (
              <p className="mt-2 text-muted">
                Rizzuno is operated by {LEGAL_CONFIG.operatorName}
                {LEGAL_CONFIG.operatorAddress ? `, ${LEGAL_CONFIG.operatorAddress}` : ""}, referred to as
                &ldquo;Rizzuno,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo; in this policy.
              </p>
            ) : (
              <p className="mt-2 text-muted">
                This policy refers to the Rizzuno service itself as &ldquo;Rizzuno,&rdquo; &ldquo;we,&rdquo;
                &ldquo;us,&rdquo; or &ldquo;our.&rdquo;
              </p>
            )}
          </section>

          <section id="google-info">
            <h2 className="text-[16px] font-semibold">2. Information from Google Sign-In</h2>
            <p className="mt-2 text-muted">
              Rizzuno uses Google Sign-In (via the Auth.js library, running as part of Rizzuno&apos;s own server —
              not a separate company Rizzuno sends your data to) for authentication. The OAuth scopes requested are{" "}
              <code className="rounded bg-surface-2 px-1 py-0.5 text-[12px]">openid</code>,{" "}
              <code className="rounded bg-surface-2 px-1 py-0.5 text-[12px]">email</code>, and{" "}
              <code className="rounded bg-surface-2 px-1 py-0.5 text-[12px]">profile</code> — nothing beyond
              identifying who you are. Rizzuno never requests, and does not have, access to your Gmail, Drive,
              Calendar, Contacts, or any other Google data or service.
            </p>
            <p className="mt-2 text-muted">
              When you sign in, Google shares your Google account&apos;s stable account ID, name, email address, and
              profile photo with Rizzuno&apos;s authentication flow. Of these, only the stable account ID is
              persisted in Rizzuno&apos;s database, as your Rizzuno account identifier. Your name, email address,
              and Google profile photo are processed in-session — they exist in your signed authentication token and
              are available to Rizzuno&apos;s client code for the duration of your session (e.g. to show your name
              on your own device) — but Rizzuno&apos;s server does not write them into its database. We are not
              claiming Google, Auth.js, or your browser never handle these fields; we are describing specifically
              what Rizzuno&apos;s own database stores.
            </p>
          </section>

          <section id="database-info">
            <h2 className="text-[16px] font-semibold">3. What Rizzuno&apos;s database stores</h2>
            <p className="mt-2 text-muted">Rizzuno&apos;s database (hosted Postgres) stores, keyed to your account ID:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
              <li>Your account identifier (Google&apos;s stable account ID) and when the account row was first created.</li>
              <li>
                Your <strong className="text-foreground">username</strong>, once you&apos;ve chosen one — see Section 4 for why this one
                field is different from the rest of your profile.
              </li>
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
              <li>
                Friend requests this account has sent or received, and their status (pending, accepted, or
                declined), and any resulting friendships — the accounts on each side and when the friendship
                formed. Sending or accepting a friend request is a deliberate action you take, not something that
                happens automatically.
              </li>
            </ul>
            <p className="mt-2 text-muted">
              None of the rest of your profile content (gender, bio, photo, posts) is written to this database —
              see Section 4.
            </p>
          </section>

          <section id="profile-info">
            <h2 className="text-[16px] font-semibold">4. Profile information: what&apos;s stored, and where</h2>
            <p className="mt-2 text-muted">
              Your <strong className="text-foreground">username</strong> is the one piece of profile information
              Rizzuno&apos;s database (Section 3) does persist, and it&apos;s deliberately minimal: just the
              username string itself, tied to your account ID, with nothing else about you attached to it there.
              It&apos;s stored specifically so it can be permanently unique — no two accounts can hold the same
              username — which requires the server to actually keep a record of who has claimed what.
              Choosing a username for the first time, or changing it later from My Profile, sends it to Rizzuno&apos;s
              server to be checked and claimed; it isn&apos;t just written straight to your browser the way the
              rest of your profile is.
            </p>
            <p className="mt-2 text-muted">
              Your gender, bio, profile photo, and any posts you add are all set and stored{" "}
              <strong className="text-foreground">persistently</strong> only in your own browser&apos;s local
              storage, keyed to your account ID — Rizzuno&apos;s database never persists these four fields. This
              means this data does not sync across devices or browsers, and clearing your browser&apos;s site data
              for Rizzuno removes it entirely.
            </p>
            <p className="mt-2 text-muted">
              Two of those fields are also handled differently while you&apos;re actively using Rizzuno: your{" "}
              <strong className="text-foreground">gender</strong> and <strong className="text-foreground">profile photo</strong> are
              transmitted to and processed <strong className="text-foreground">temporarily</strong> by
              Rizzuno&apos;s realtime service — your gender is used there to pair you with an opposite-selected-
              gender match, and both are passed along live so the person you&apos;re currently matched with can see
              them. Your username is passed along live to a current match the same way, in addition to being
              stored in the database as described above. This realtime processing happens in-memory on the
              realtime server for the duration of your connection; it is discarded once you disconnect, separately
              from whatever is or isn&apos;t written to the database.
            </p>
            <p className="mt-2 text-muted">
              Your <strong className="text-foreground">bio</strong> and any <strong className="text-foreground">posts</strong>{" "}
              you&apos;ve added are never transmitted to Rizzuno&apos;s servers at all, in any form — they exist
              only in your browser.
            </p>
          </section>

          <section id="communications">
            <h2 className="text-[16px] font-semibold">5. Video, audio, chat &amp; signaling</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted">
              <li>
                <strong className="text-foreground">Video/audio</strong> — streams directly between your device and your match&apos;s device (WebRTC,
                peer-to-peer). Rizzuno&apos;s server does not receive, transmit, monitor, or store this media.
                Rizzuno does not intentionally record or persist live video or audio on its own servers. Rizzuno has
                no visibility into, and no control over, whether the person you&apos;re matched with (or their
                device, browser, or operating system) independently records, screenshots, or otherwise captures the
                call on their end — our{" "}
                <Link href="/terms" className="underline underline-offset-2 hover:text-accent">
                  Terms
                </Link>{" "}
                prohibit doing that without consent, but Rizzuno cannot technically detect or prevent it.
              </li>
              <li>
                <strong className="text-foreground">Signaling</strong> — the short technical handshake (connection offers/answers, network routing
                candidates) that sets up the direct video/audio connection is relayed live through Rizzuno&apos;s
                server. Transient — not stored after it&apos;s relayed. This handshake necessarily carries network
                routing information (including public IP addresses) between you and your match, and to connectivity
                infrastructure such as Google&apos;s STUN servers — see Section 6.
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
              infrastructure providers never see or process it, and we do not claim Rizzuno never processes an IP
              address anywhere in its stack — that would be inaccurate for any hosted web service handling live
              network connections.
            </p>
            <p className="mt-2 text-muted">
              Establishing a peer-to-peer video call also uses Google&apos;s public STUN servers as part of
              standard WebRTC connectivity, which as a technical necessity see each participant&apos;s public
              network address in order to help the two devices find a direct path to each other. That same
              connection process can also expose your public IP address directly to the person you&apos;re matched
              with, as an ordinary characteristic of how WebRTC negotiates a peer-to-peer link — this is not
              something Rizzuno&apos;s servers add, control, or permanently store.
            </p>
          </section>

          <section id="purposes">
            <h2 className="text-[16px] font-semibold">7. Purpose of processing</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted">
              <li><strong className="text-foreground">Authentication</strong> — knowing which Google account is signed in, via Auth.js.</li>
              <li><strong className="text-foreground">Matchmaking</strong> — pairing you with another available, opposite-selected-gender account, and honoring blocks.</li>
              <li><strong className="text-foreground">Friends</strong> — recording who&apos;s sent or accepted a friend request with whom, and delivering a pending request live to the other account if they&apos;re online.</li>
              <li><strong className="text-foreground">Safety &amp; abuse prevention</strong> — reviewing reports and applying warnings/suspensions/bans.</li>
              <li><strong className="text-foreground">Moderation</strong> — giving admins the information needed to review reports and act consistently.</li>
              <li><strong className="text-foreground">Legal acceptance</strong> — keeping a factual record of what each account agreed to, and when.</li>
              <li><strong className="text-foreground">Service operation</strong> — running matchmaking and relaying live signaling/chat.</li>
              <li><strong className="text-foreground">Security</strong> — rate-limiting account-mutating requests and verifying WebSocket connections belong to the session they claim to.</li>
            </ul>
            <p className="mt-2 text-muted">
              Rizzuno does not use your information for advertising, does not sell it, and does not use it to build
              profiles for third parties — see Sections 10–11.
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
              separate company or service that receives your data independently of Rizzuno. This is the complete
              list of third parties Rizzuno currently integrates: Rizzuno does not currently use a payment processor,
              an advertising network, or an analytics/tracking provider. If that changes, this policy will be
              updated first.
            </p>
          </section>

          <section id="cookies">
            <h2 className="text-[16px] font-semibold">9. Cookies &amp; browser storage</h2>
            <p className="mt-2 text-muted">
              Auth.js sets a small number of cookies to keep you signed in and to protect the sign-in process — this
              generally includes a signed, httpOnly session cookie, a CSRF-protection cookie, and, during the Google
              sign-in handshake itself, one or more short-lived security cookies (such as an OAuth state or PKCE
              verifier) that are cleared once sign-in completes. Exact cookie names can change between Auth.js
              versions; what stays true is their purpose — all of them exist strictly for authentication and
              security, and none of them are used for advertising, cross-site tracking, or analytics.
            </p>
            <p className="mt-2 text-muted">
              Your browser&apos;s local storage is also used, entirely on your own device: to save a local copy of
              your profile (username, gender, bio, photo, posts) keyed to your account ID as described in Section
              4, and to cache a cosmetic fallback display name shown before you&apos;ve chosen a username. Rizzuno
              does not currently use browser session storage. Most of this local-storage data (gender, bio, photo,
              posts) is never sent to Rizzuno&apos;s server automatically — it stays in your browser unless a match
              receives your live profile fields (Section 4), or unless you delete it yourself (e.g. by clearing
              site data). Your username is the exception: it&apos;s deliberately sent to the server whenever you
              set or change it, specifically so it can be claimed and kept unique (Section 4) — that&apos;s a
              direct result of your own action, not automatic background syncing.
            </p>
          </section>

          <section id="tracking">
            <h2 className="text-[16px] font-semibold">10. Online tracking, Do Not Track &amp; GPC</h2>
            <p className="mt-2 text-muted">
              Rizzuno does not currently use analytics or advertising technology to track your activity across
              unrelated third-party websites or services for behavioral advertising or other cross-context tracking
              purposes. Rizzuno is not aware of any of the third parties listed in Section 8 collecting information
              about your activity over time and across other sites through Rizzuno&apos;s use of them.
            </p>
            <p className="mt-2 text-muted">
              Because Rizzuno does not perform this kind of cross-site tracking, Rizzuno&apos;s website does not
              currently change its behavior in response to a browser&apos;s &ldquo;Do Not Track&rdquo; signal, and
              Rizzuno does not currently implement Global Privacy Control (GPC) signal handling. If Rizzuno&apos;s
              practices change such that responding to these signals becomes applicable, this Privacy Policy will be
              updated to reflect that.
            </p>
          </section>

          <section id="sale">
            <h2 className="text-[16px] font-semibold">11. Data sale &amp; targeted advertising</h2>
            <p className="mt-2 text-muted">
              Rizzuno does not sell personal information. Rizzuno does not use personal information for targeted or
              cross-context behavioral advertising. Rizzuno currently has no advertising network integrated with the
              service. If any of this changes, this Privacy Policy will be updated first, and any choices or
              disclosures required by applicable law will be made available at that time.
            </p>
          </section>

          <section id="retention">
            <h2 className="text-[16px] font-semibold">12. Data retention</h2>
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
                <strong className="text-foreground">Blocks</strong> — kept indefinitely; no feature currently removes a block once made (see Section 18).
              </li>
              <li>
                <strong className="text-foreground">Usernames</strong> — kept indefinitely once claimed (see Section 4), including if the account that
                claimed it later stops using Rizzuno; no feature currently releases a username automatically.
              </li>
              <li>
                <strong className="text-foreground">Friend requests</strong> — kept indefinitely regardless of outcome (pending, accepted, or declined); no
                feature currently deletes the record of a request once made.
              </li>
              <li>
                <strong className="text-foreground">Friendships</strong> — kept until either side unfriends the other (see Section 18) — this is the one
                relationship in this list a user can actually end themselves, rather than it being retained
                indefinitely by default.
              </li>
            </ul>
            <p className="mt-2 text-muted">
              Rizzuno has not yet adopted formal maximum retention periods for the categories above. Until it does,
              the accurate statement is that this data is retained indefinitely, as described.
            </p>
          </section>

          <section id="deletion">
            <h2 className="text-[16px] font-semibold">13. Privacy and deletion requests</h2>
            <p className="mt-2 text-muted">
              Rizzuno does not currently provide an automated, self-service account-deletion feature. To request
              deletion of personal information associated with your Rizzuno account, or to make another privacy
              request, contact{" "}
              <a
                href={`mailto:${LEGAL_CONFIG.contactEmail}`}
                className="underline underline-offset-2 hover:text-accent"
              >
                {LEGAL_CONFIG.contactEmail}
              </a>
              . Requests will be evaluated and handled as required by applicable law.
            </p>
            <p className="mt-2 text-muted">
              Some information may need to be retained even after a request is honored, where permitted or required
              for legitimate purposes such as security, abuse/fraud prevention, enforcement, dispute handling, or
              maintaining legal-acceptance records — consistent with Section 12. Rizzuno does not promise that every
              record will always be deleted, and does not commit to a specific response or deletion deadline unless
              applicable law actually requires one.
            </p>
            <p className="mt-2 text-muted">
              Your gender, bio, profile photo, and posts are stored only in your own browser (see Section 4) — you
              can remove them yourself at any time by editing or clearing your profile in the app, or by clearing
              Rizzuno&apos;s site data in that browser. Because this data was never sent to Rizzuno&apos;s server,
              Rizzuno has no way to remotely clear it from a browser or device other than the one you&apos;re
              using. Your username is different, because it&apos;s stored server-side (Section 4): a deletion
              request that includes releasing your claimed username is something Rizzuno can act on directly,
              through the contact process above.
            </p>
          </section>

          <section id="export">
            <h2 className="text-[16px] font-semibold">14. Data export</h2>
            <p className="mt-2 text-muted">
              My Profile → Privacy &amp; data → Download my data provides a copy of the server-side account
              information currently available through Rizzuno&apos;s self-service export: your account status,
              your claimed username, legal-acceptance history, accounts you have blocked, and reports you have
              filed.
            </p>
            <p className="mt-2 text-muted">
              This self-service export is not a complete copy of every record involving your account. It does not
              currently include, for example, reports in which your account was the one reported, or the contents
              of moderation actions taken against it — those exist in Rizzuno&apos;s database (see Section 3) but
              aren&apos;t part of this particular export today. It also does not include the rest of your profile
              content (gender, bio, photo, posts), because that isn&apos;t stored on the server at all — it&apos;s
              already visible in the browser that holds it.
            </p>
          </section>

          <section id="children">
            <h2 className="text-[16px] font-semibold">15. 18+ users &amp; age affirmation</h2>
            <p className="mt-2 text-muted">
              Rizzuno is intended only for adults — at least 18 years of age, or the age of majority where they live
              if that&apos;s older, whichever is higher — and is not directed at children.
            </p>
            <p className="mt-2 text-muted">
              Rizzuno records an account&apos;s affirmation that the user meets this age requirement, together with
              the applicable Terms/Privacy version and the time of acceptance, through the legal-acceptance system
              described in Section 3. This age declaration comes from the user, not from Google: Google Sign-In
              authenticates your Google account and supplies the account fields described in Section 2 (your Google
              account&apos;s stable ID, name, email, and profile photo) — it does not supply, confirm, or verify
              your age. Rizzuno&apos;s own affirmation is a self-attestation, not identity-level or government-ID
              age verification. Rizzuno does not currently verify a user&apos;s real age by any other means or
              represent that it does, and does not guarantee the real age of any other user.
            </p>
            <p className="mt-2 text-muted">
              Rizzuno does not knowingly collect information from children. If Rizzuno becomes aware that an account
              does not meet this age requirement, Rizzuno may restrict or terminate that account and handle any
              associated information as required by applicable law.
            </p>
          </section>

          <section id="security">
            <h2 className="text-[16px] font-semibold">16. Security</h2>
            <p className="mt-2 text-muted">
              Rizzuno takes reasonable measures to protect information, including: signed, httpOnly authentication
              cookies; a short-lived, cryptographically signed ticket (separate from your session cookie) used to
              prove your identity to the realtime server without exposing the session cookie itself; server-side
              verification of every account ID used for matching, blocking, and reporting (never trusting a
              client-supplied claim at face value); encrypted connections to the database; and rate limiting on
              account-sensitive actions. No method of transmission or storage is completely secure, and Rizzuno does
              not claim its security is unhackable, industry-leading, or guaranteed — only that these specific,
              real measures are in place.
            </p>
          </section>

          <section id="international">
            <h2 className="text-[16px] font-semibold">17. International processing</h2>
            <p className="mt-2 text-muted">
              Rizzuno&apos;s infrastructure providers (Vercel, Railway, and its database provider) may process and
              store data in locations outside your own country. Rizzuno does not currently represent that it is
              compliant with any specific regional data-protection framework (for example the EU&apos;s GDPR) —
              whether such a framework applies, and what additional obligations it creates, depends on decisions
              Rizzuno&apos;s operator has not yet finalized (including its legal entity, its jurisdiction of
              operation, and which regions it intends to serve).
            </p>
          </section>

          <section id="rights">
            <h2 className="text-[16px] font-semibold">18. Your rights &amp; controls</h2>
            <p className="mt-2 text-muted">These are the controls Rizzuno actually provides today, and exactly what each one does:</p>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted">
              <li><strong className="text-foreground">Download your data</strong> — see Section 14.</li>
              <li>
                <strong className="text-foreground">Block</strong> — enforced server-side; as currently built, Rizzuno does not provide a way to
                reverse a block once made — we do not promise an &ldquo;unblock&rdquo; capability that doesn&apos;t
                exist.
              </li>
              <li><strong className="text-foreground">Report</strong> — sent to human moderation for review; never shown to the reported user.</li>
              <li><strong className="text-foreground">Edit or clear your local profile</strong> — directly, any time, from My Profile.</li>
              <li>
                <strong className="text-foreground">Change your username</strong> — from My Profile → Edit profile, any time, subject to it not
                already being claimed by another account (see Section 4).
              </li>
              <li>
                <strong className="text-foreground">Send, accept, or decline a friend request</strong> — directly, from the match or friends
                screens; declining does not notify the sender.
              </li>
              <li>
                <strong className="text-foreground">Unfriend</strong> — ends the friendship immediately for both accounts; either side can do
                this at any time, and Rizzuno does not notify the other account when it happens.
              </li>
            </ul>
            <p className="mt-2 text-muted">
              Rizzuno does not currently offer a self-service account-deletion control. Eligible privacy or
              deletion requests can be submitted through the contact information in Section 13.
            </p>
          </section>

          <section id="state-rights">
            <h2 className="text-[16px] font-semibold">19. U.S. state privacy rights</h2>
            <p className="mt-2 text-muted">
              Depending on where you live, and subject to the specific thresholds, exemptions, and definitions of
              the law that applies to you, you may have additional rights concerning your personal information
              under a U.S. state privacy law. These can include rights to know or access, correct, delete, or obtain
              a copy of certain personal information; to opt out of the sale of personal information or of targeted
              advertising; to opt out of certain kinds of profiling; to appeal a denied request; and to be free from
              unlawful discrimination for exercising these rights. Not every right applies to every user or every
              service, and whether any of them apply to Rizzuno depends on factors this policy does not attempt to
              resolve on your behalf.
            </p>
            <p className="mt-2 text-muted">
              As described in Section 11, Rizzuno does not sell personal information and does not use personal
              information for targeted advertising, so opt-out rights tied to sale or targeted advertising describe
              a choice Rizzuno&apos;s current practices don&apos;t require you to make. Where applicable law gives
              you a deletion or other privacy right, you may submit a request through{" "}
              <a
                href={`mailto:${LEGAL_CONFIG.contactEmail}`}
                className="underline underline-offset-2 hover:text-accent"
              >
                {LEGAL_CONFIG.contactEmail}
              </a>{" "}
              (see Section 13) — Rizzuno will handle eligible requests consistent with applicable law. Rizzuno does
              not currently offer a dedicated self-service rights-request tool beyond the account controls in
              Section 18.
            </p>
          </section>

          <section id="caloppa">
            <h2 className="text-[16px] font-semibold">20. California privacy disclosures (CalOPPA)</h2>
            <p className="mt-2 text-muted">
              This section maps the disclosures commonly associated with California&apos;s Online Privacy Protection
              Act (CalOPPA) to where they actually appear in this policy:
            </p>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted">
              <li>Categories of personal information processed — Sections 2–6.</li>
              <li>Categories of third parties that may receive information — Section 8.</li>
              <li>How you can review or change your information — Section 18 (and Sections 13–14 for deletion/export).</li>
              <li>How Rizzuno communicates material changes to this policy — Section 21.</li>
              <li>Effective/last-updated date — at the top of this page.</li>
              <li>Online tracking and Do Not Track — Section 10.</li>
              <li>
                Whether third parties collect information about your activity across other websites/services over
                time — addressed in Section 10: Rizzuno is not aware of this occurring through its use of the
                providers in Section 8, and does not integrate any service for that purpose.
              </li>
            </ul>
          </section>

          <section id="changes">
            <h2 className="text-[16px] font-semibold">21. Changes to this policy</h2>
            <p className="mt-2 text-muted">
              When we make a material change to this policy, we update the version and date at the top of this
              page, and accounts that previously accepted an older version are asked to review and accept the
              current one again before continuing to use Rizzuno. Your prior acceptance record is never rewritten —
              only added to.
            </p>
          </section>

          <section id="contact">
            <h2 className="text-[16px] font-semibold">22. Contact</h2>
            {LEGAL_CONFIG.contactEmail ? (
              <p className="mt-2 text-muted">
                Questions about this Privacy Policy, or requests relating to your data, can be sent to{" "}
                <a
                  href={`mailto:${LEGAL_CONFIG.contactEmail}`}
                  className="underline underline-offset-2 hover:text-accent"
                >
                  {LEGAL_CONFIG.contactEmail}
                </a>
                .
              </p>
            ) : (
              <p className="mt-2 text-muted">
                A dedicated contact address for privacy questions or data requests is not yet published here.
              </p>
            )}
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
