import type { Metadata } from "next"
import Link from "next/link"
import { REQUIRED_DOCUMENTS } from "@/lib/legalVersions"
import { LEGAL_CONFIG } from "@/lib/legalConfig"
import { LegalNav } from "@/components/LegalNav"

export const metadata: Metadata = {
  title: "Privacy Policy — Rizzuno",
  description:
    "How Rizzuno collects, stores, and uses information — for authentication, matchmaking, safety, and moderation.",
}

const version = REQUIRED_DOCUMENTS.find((d) => d.document === "privacy")!.version
const LAST_UPDATED = "September 24, 2026"

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
                This development preview refers to Rizzuno as &ldquo;Rizzuno,&rdquo; &ldquo;we,&rdquo;
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
            <p className="mt-2 text-muted">Rizzuno requires Google to indicate that the email address is verified before sign-in succeeds. That verification result is evaluated during sign-in; it is not a Rizzuno age or identity-verification service. Rizzuno never receives your Google password. Your Google stable ID, email, name, and Google profile image are not disclosed to random matches; the separate Rizzuno profile fields described below are used there.</p>
          </section>

          <section id="database-info">
            <h2 className="text-[16px] font-semibold">3. What Rizzuno&apos;s database stores</h2>
            <h3 className="mt-3 font-semibold">Account</h3>
            <p className="mt-1 text-muted">Hosted Postgres stores your Google stable account identifier as the Rizzuno account key, account creation/deletion and enforcement state, legal-acceptance history, membership entitlement records, and abuse-prevention counters. Auth.js session tokens process the Google email, name, and image described in Section 2. Legal acceptances record the document, version and time and are appended without replacing prior versions.</p>
            <h3 className="mt-3 font-semibold">Profile</h3>
            <p className="mt-1 text-muted">Username, profile-image reference, bio, gender, and posts are stored against the account. Images themselves use the private storage described below.</p>
            <h3 className="mt-3 font-semibold">Matching</h3>
            <p className="mt-1 text-muted">Rizzuno processes gender for random-match compatibility, the IP-derived country code described in Section 6, current queue/room state, recent-partner cooldowns, and block relationships. A minimal recent-session ledger stores the opaque room ID, both internal account references, random/friend source, start/end times, and operator-configured report deadline. Whether you reported a session is derived from the report record instead of duplicated in the ledger.</p>
            <h3 className="mt-3 font-semibold">Social</h3>
            <p className="mt-1 text-muted">Friend requests, friendships, persisted friend messages and posts are stored. Friend messages include sender/recipient references, friendship and retry-deduplication IDs, creation time, optional read time, and an optional reply reference.</p>
            <h3 className="mt-3 font-semibold">Safety and moderation</h3>
            <p className="mt-1 text-muted">Reports, restricted report evidence, safety decision logs, legal holds and held snapshots, moderation actions, image-check metadata, and appeals are stored. An appeal contains its ID, affected account, enforcement reference, the user&apos;s reason and optional reference, submission time, status, reviewer, user-facing resolution and resolution time. Reporter identities, internal notes, and report evidence are not exposed through the user appeal view.</p>
            <h3 className="mt-3 font-semibold">Technical and security</h3>
            <p className="mt-1 text-muted">Rate-limit keys are hashed before storage. The application processes timestamps, signed realtime tickets, room/signaling state, security events, query/pool metrics, and the network/browser information described in Section 6. Hosting and network providers may process IP addresses and request/device data in their controlled logs.</p>
            <p className="mt-3 text-[14px] leading-relaxed text-muted">Friend messages include text, sender and recipient account references, friendship ID, client message ID for retry deduplication, creation time, optional read time, and an optional reference to an earlier message in that friendship. Moderator records include reasons, responsible moderator, relevant report and timestamps. Image checks retain a hash, category scores, provider/reference, policy/model versions and decision metadata, without an additional image copy.</p>
            <p className="mt-3 text-[14px] leading-relaxed text-muted">Privacy export/erasure operations record the responsible operator, account, action, time and request case reference. Free test Rizz+ grants store entitlement status and expiry; activation does not create a Stripe customer or charge a card.</p>

          </section>

          <section id="profile-info">
            <h2 className="text-[16px] font-semibold">4. Profile information: what&apos;s stored, and where</h2>
            <p className="mt-3 text-[14px] leading-relaxed text-muted">Username, gender, bio and profile/post image references are stored in Postgres against your account. Approved image files are stored in private Supabase Storage; older embedded images may remain in Postgres during migration. Browser copies are caches; clearing site storage does not delete the server records. The server reads gender during profile loading and realtime connection/profile updates to pair opposite-selected genders during random matching. Mutually accepted friend calls do not use that gender rule.</p>
            <p className="mt-3 text-[14px] leading-relaxed text-muted">Your current match receives your username, gender, photo and approximate country flag. Signed-in users can search usernames and open public profiles subject to account/block checks; public profile responses include username, photo, bio and posts. Friends can view the same profile information. Your Google email and name are not included in match profiles.</p>
            <p className="mt-3 text-[14px] leading-relaxed text-muted">You can edit your profile in My Profile. Gender changes after the initial choice, friend-request initiation and posting depend on Rizz+ entitlement under the current feature rules. Gender remains stored until changed or cleared through an approved account privacy request. Profile edits replace the current values; deleting a post removes it, and adding beyond the 20-post limit removes the oldest.</p>
            <p className="mt-3 text-[14px] leading-relaxed text-muted">Images must pass validation and automated screening before publication. New approved profile/post images are stored in private object storage and served to authenticated users while referenced by an available profile or post. Rejected uploads are not published. Removing a reference stops delivery; backup and unreferenced-object retention are handled separately. A transient realtime identity copy lasts for the connection.</p>

          </section>

          <section id="communications">
            <p className="mt-3 text-muted">At report time, we may store a restricted evidence snapshot linked to that report: the reporter and reported account references, room ID, category, details, exact report time, up to 20 text messages from the preceding two minutes, and bounded prior report/action summaries. Recent chat context is held in connection memory until the room ends; a later post-match report normally has no chat snapshot. This is not continuous call recording. The schema can associate an approved evidence object and hash with a report, but automatic screenshot capture and its browser adapter are disabled. Evidence is not disclosed to the reported user or included in the standard privacy export.</p>
            <h2 className="text-[16px] font-semibold">5. Video, audio, chat &amp; signaling</h2>
            <p className="mt-3 text-[14px] leading-relaxed text-muted">Video and audio use WebRTC directly between participants when possible, or through a configured TURN relay when necessary. Rizzuno does not intentionally record or persist calls or automatically review live video/audio. The other participant can capture what they receive despite our rules prohibiting recording without consent.</p>
            <p className="mt-3 text-[14px] leading-relaxed text-muted">Signaling offers, answers and network candidates pass through the realtime service to establish calls. P2P negotiation can expose public IP/network information to your match. STUN and TURN infrastructure process connection addresses; TURN relays encrypted WebRTC traffic. Media packets are not sent through the matchmaking database.</p>
            <p className="mt-3 text-[14px] leading-relaxed text-muted">In-call text and images are relayed live; there is no retrievable call-chat history, except restricted report evidence and preservation under legal holds as described here. Friend text messages are persisted for offline retrieval and later history, independently of an active call. The history endpoint returns the latest 50 messages, oldest first within that page. Delivery acknowledgment means the server stored a friend message; a separate read timestamp reflects the recipient marking messages read. Blocking or ending a friendship prevents further access/delivery through that relationship; it does not by itself erase stored messages.</p>
            <p className="mt-3 text-[14px] leading-relaxed text-muted">Username, bio, match chat and friend chat use server-side text screening, including common obfuscation checks; policy differs by field and no filter catches every evasion. Images are sent to Sightengine for general content screening when configured. Failed, unavailable or borderline image checks prevent publication. Generic nudity detection is not child sexual abuse material identification; no specialized illegal-content provider is currently enabled.</p>
            <p className="mt-3 text-[14px] leading-relaxed text-muted">Reports retain category, optional details, target and call context where available. Reporting does not record the call or attach images; bounded recent text may be included in the restricted snapshot described above. Underage concerns are prioritized for moderator review; the system does not automatically submit reports to authorities.</p>

          </section>

          <section id="technical-info">
            <h2 className="text-[16px] font-semibold">6. Technical &amp; infrastructure information</h2>
            <p className="mt-2 text-muted">
              Rizzuno&apos;s current architecture uses Vercel for the web app, Railway for the realtime/matching and Redis services,
              and Supabase for hosted Postgres and private object storage. The required deployment disclosure in Section 8 identifies the actual enabled providers and processing regions for a release. Like essentially any web
              service, these providers may automatically process technical information as a normal part of
              operating that infrastructure — for example, your IP address, request timestamps, and basic
              browser/device information may appear in server or platform logs. Rizzuno&apos;s own application code
              displays an approximate country/region flag to your match and enforces the supported-country allowlist using Vercel&apos;s IP-country lookup.
              Only the country code is included in the short-lived signed connection ticket and match identity;
              this feature does not save the IP address or country in your profile. There is no manual country-preference control and Rizzuno does not request GPS or precise location. VPNs may change the country shown.
              Rizzuno does not deliberately log or store your IP address in its database, but we do not claim our
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
              <li><strong className="text-foreground">Recent-match safety reporting</strong> — keeping a minimal session ledger long enough for the configured report window.</li>
              <li><strong className="text-foreground">Appeals</strong> — receiving, reviewing, resolving, and auditing challenges to serious enforcement.</li>
              <li><strong className="text-foreground">Moderation</strong> — giving admins the information needed to review reports and act consistently.</li>
              <li><strong className="text-foreground">Automated image-safety screening</strong> — checking a profile photo, post, or chat image against prohibited-content categories before it&apos;s shown to anyone else or saved, and recognizing repeated violations for enforcement purposes.</li>
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
            {LEGAL_CONFIG.deploymentDisclosure && <p className="mt-3 text-muted">{LEGAL_CONFIG.deploymentDisclosure}</p>}
            <h2 className="text-[16px] font-semibold">8. Third parties &amp; processors</h2>
            <p className="mt-3 text-[14px] leading-relaxed text-muted">Google supplies authentication and public STUN connectivity. Vercel serves the web application and supplies the trusted country-code header. Railway runs the realtime service and Redis coordination in the current architecture. Supabase provides Postgres and private Storage for approved profile/post images. Sightengine receives submitted images for general automated content screening when configured. These providers may process technical data needed to deliver their services. The release-specific disclosure above controls if the deployment differs and must identify actual regions.</p>
            <p className="mt-3 text-[14px] leading-relaxed text-muted">When TURN is enabled, the operator-configured TURN provider processes relay credentials, network addresses and encrypted media relay traffic. The deployment disclosure below identifies the actual providers and processing regions. No permanent TURN shared secret is sent to browsers.</p>
            <p className="mt-3 text-[14px] leading-relaxed text-muted">Rizz+ is currently free test access: no card is requested, activation does not charge, and paid Stripe checkout/webhook processing is disabled. Stripe integration code remains in the repository but is not active paid checkout in this release. Any transition to paid billing requires a new reviewed release and updated disclosures.</p>
            <p className="mt-3 text-[14px] leading-relaxed text-muted">Auth.js, Next.js and database client libraries execute as application software rather than independent data recipients. Rizzuno does not integrate advertising or cross-site tracking services. Deployment-specific monitoring, storage and coordination providers must be disclosed before enabling them.</p>

          </section>

          <section id="cookies">
            <h2 className="text-[16px] font-semibold">9. Cookies &amp; browser storage</h2>
            <p className="mt-3 text-[14px] leading-relaxed text-muted">Auth.js uses secure authentication/session and OAuth security cookies. The session is HTTP-only; production cookies use HTTPS. The configured session lifetime is seven days, subject to session refresh and sign-out. Cookies protect sign-in and do not serve advertising.</p>
            <p className="mt-3 text-[14px] leading-relaxed text-muted">Browser local storage caches profile fields, friends/requests, blocked accounts, recent match history (up to 50), and a cosmetic fallback handle. These caches can persist after a connection ends and are keyed by account where applicable; they are not the authority for server-side blocks or profile data. Clearing site storage removes browser copies, not Postgres records. The application also uses navigation state to return to profile panels.</p>

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
            <p className="mt-3 text-muted">Profile fields, including gender, remain until changed or erased. Posts remain until removed or displaced by the 20-post limit. Friendships end when removed or blocked. Blocks can be undone by their creator and are removed during approved account erasure.</p>
            <p className="mt-3 text-muted">Operator-approved retention policies separately cover friend messages, friend requests, recent-session history, reports, report evidence, moderation actions, appeals, image-check metadata, legal acceptances, privacy-operation logs, security/infrastructure logs and account tombstones. Automatic deletion runs in bounded batches where approved; records needing individual review remain restricted until that review. Dependencies, open appeals, report eligibility, and active investigations can delay deletion. Contact us for the policy applicable to a record.</p>
            <p className="mt-3 text-muted">Legal holds pause erasure and retention purges; product edits/removals preserve restricted pre-change records while a hold applies. Prior legal acceptances are preserved across version changes; automatic expiry of acceptance history applies only to erased accounts. A restricted deleted-identity record prevents reentry and requires separate periodic review rather than automatic deletion.</p>
            <p className="mt-3 text-muted">Approved erasure removes product data and queues associated private image objects for deletion with retries. Orphaned images are inventoried separately and expire under the approved Storage policy. Infrastructure logs and backup expiry follow separately approved provider settings; database deletion does not erase backups immediately. Restores must reapply erasures before serving traffic.</p>
          </section>

          <section id="deletion">
            <h2 className="text-[16px] font-semibold">13. Privacy and deletion requests</h2>
            <p className="mt-3 text-[14px] leading-relaxed text-muted">Account deletion remains contact-based. Send a privacy request to the contact address below; the operator must verify your identity and review retention/legal holds before using restricted export or erasure tools. Signing out, clearing browser storage or deleting a Google account does not itself delete Rizzuno’s database records.</p>
            <p className="mt-3 text-[14px] leading-relaxed text-muted">Approved erasure clears username (releasing it), gender, bio, photo, posts, friendships, requests, friend conversations and free membership. It marks the account deleted so the same identity cannot resume realtime access. Minimal recent-session safety records, reports and evidence, enforcement/appeal/image-check records, legal acceptances, privacy-operation logs and an account-identity tombstone may remain restricted under their approved retention rules; the erasure log records retained categories and reasons. Erasure is not a promise to delete every record. Accounts with a stored payment-customer mapping require separate billing review before erasure.</p>
            <p className="mt-3 text-[14px] leading-relaxed text-muted">Rizzuno cannot remotely delete copies another participant captured or browser copies on a disconnected device. Eligible requests and any applicable response deadlines are handled under the law that applies to the request.</p>

          </section>

          <section id="export">
            <h2 className="text-[16px] font-semibold">14. Data export</h2>
            <p className="mt-3 text-[14px] leading-relaxed text-muted">There is no self-service export button. Verified contact requests can be fulfilled by an authorized operator using a structured export of profile, posts, relationship/request information, messages you sent and received messages still accessible through an active friendship, blocks you created, legal acceptances, membership information, your recent-session records with counterpart usernames rather than stable IDs, and your own appeal submissions/resolutions. Another person’s stable account identifiers, confidential reports, report evidence and internal moderation information are excluded from this standard export. Additional access requests require individual review.</p>

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
            <p className="mt-2 text-muted">The providers and regions disclosed in Section 8 may involve cross-border processing. Availability is limited to operator-approved countries. Applicable rights and transfer safeguards depend on the deployment and relevant law; availability is not a certification of regional compliance. Contact us for information about the arrangements applicable to your data.</p>
          </section>

          <section id="rights">
            <h2 className="text-[16px] font-semibold">18. Your rights &amp; controls</h2>
            <p className="mt-3 text-[14px] leading-relaxed text-muted">You can edit your profile, change an available username, send or respond to friend requests, search usernames, message friends, end friendships, report users and block accounts. Some creation/change features require Rizz+; existing friendship chat remains available under the current rules.</p>
            <p className="mt-3 text-[14px] leading-relaxed text-muted">In My Profile → Settings → Blocked users, you can remove blocks you created. Blocks are directional: unblocking does not remove the other person’s block. If neither account blocks the other, future matching can resume subject to ordinary eligibility and recent-partner cooldown. Unblocking does not recreate old friendships or pending requests.</p>
            <p className="mt-3 text-[14px] leading-relaxed text-muted">Use the <Link href="/appeals" className="underline">appeals page</Link> for a recorded underage decision, temporary restriction or suspension, permanent ban, or other serious enforcement. Contact the published privacy address for access/export, correction, deletion, portability, restriction or objection, withdrawal of optional consent where applicable, privacy complaints, or regulator-contact information. Rights depend on applicable law; there is no automatic guarantee of reinstatement or disclosure of another person’s protected information or confidential moderation material.</p>

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
            {LEGAL_CONFIG.legalEmail && <p className="mt-2 text-muted">Legal notices: <a href={`mailto:${LEGAL_CONFIG.legalEmail}`} className="underline">{LEGAL_CONFIG.legalEmail}</a>.</p>}
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
                Contact details for this development preview are supplied through deployment configuration.
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
          <LegalNav className="border-t border-border pt-5"/>
        </div>
      </div>
    </main>
  )
}
