# Age eligibility and additional assurance

Updated November 1, 2026. This documents implementation and release inputs, not a legal opinion or a compliance certification. No external provider has been selected, provisioned or validated by this change. The 52 mandatory exclusions and access mechanism are documented in [GEOGRAPHIC_ACCESS.md](GEOGRAPHIC_ACCESS.md); the United States is currently excluded in its entirety.

## User experience and enforcement

The unchecked declaration reads “I confirm I am 18 or older and meet applicable age requirements.” Continue is disabled until selected. No date of birth is requested or calculated. Google sign-in remains the next step. Signed-in users actively confirm and accept the current documents before matchmaking. An affirmative declaration is self-attestation, never verified age.

The server requires the literal boolean `confirmedAdult: true`; old DOB submissions do not work. Eligibility uses an HMAC-signed, HTTP-only, SameSite=Lax cookie, Secure with a `__Host-` name in production. Its version, method, jurisdiction-policy hash, minimum-age threshold and absolute expiry are checked independently of the UI. Maximum lifetime is 24 hours, bounded by provider and policy expiry. Legal acceptance remains an account record with version and timestamp; historical records are preserved.

OAuth initiation/callback, account acceptance and realtime ticket issuance check current eligibility. Tickets carry the signed country, available subdivision, policy hash and eligibility expiry to the realtime service. Admission, eligibility-sensitive actions, final matchmaking checks and the existing periodic access sweep reject excluded or removed locations and expired or changed eligibility. Existing bans, restrictions, legal-acceptance checks, underage reports, urgent safety review, appeals and child-safety workflows remain enforced. Report and appeal pages remain reachable when product access is denied.

## Required deployment decisions

Keep an explicit `SUPPORTED_COUNTRIES` allowlist excluding all 52 blocked countries. For every enabled country, or approved subdivision selected by `SUPPORTED_SUBDIVISIONS_JSON`, supply an `AGE_POLICIES_JSON` entry:

```json
{
  "XX": {
    "mode": "unavailable",
    "minimumAge": 18,
    "reference": "actual scoped review and supporting legal sources",
    "reviewBy": "YYYY-MM-DD"
  }
}
```

This is a schema illustration, not a valid jurisdiction or an approval. Supported modes are `self_attestation`, `provider`, and `unavailable`. Self-attestation may be enabled only when the documented review determines additional assurance is not required for this service/location. Use `provider` wherever required, with a method that actually meets the relevant standard. Use `unavailable` until an appropriate check can be offered. The minimum is 18; the review must set a higher threshold wherever applicable. No parent-consent route admits ineligible users. Historical U.S. majority floors in code do not enable any U.S. state while the nationwide exclusion applies.

Missing, invalid, unreviewed or expired entries deny eligibility; production launch validation requires a current entry for each allowlisted location. Changing an entry changes its hash and invalidates prior eligibility for that location. The realtime deployment needs the same policies and geolocation allowlists as the web deployment. There is no fallback to development self-attestation in any environment, including when `SKIP_LAUNCH_READINESS` bypasses the older launch checks.

Use only reviewed hosting geolocation (actual Vercel ingress supplies country/subdivision); browser fields do not select policy. Missing required subdivisions are denied independently of national policy. This IP-derived signal has limitations, including proxies and VPNs; it is not proof of residence or guaranteed circumvention resistance. Standalone hosting needs an authenticated, reviewed location source before regional access can be enabled; this change does not trust arbitrary forwarded headers.

For each jurisdiction, record: the service's features and statutory scope; adult-content thresholds versus social-media duties; effective dates; current injunctions, stays and appeals; the required minimum age; accepted methods and accuracy/fairness requirements; privacy, deletion and retention rules; provider/subprocessor locations; and the next review date. Revisit decisions before enabling new features or jurisdictions and when legal status changes. Do not interpret an age checkbox, a Google account, or the blanket U.S. approval flag as this review.

## Optional provider bridge contract

The implementation uses an HTTPS server-to-server bridge, rather than pretending a particular vendor's API is integrated. A real service or reviewed vendor adapter must implement this contract and be tested in its sandbox before enabling `provider` locations. Configuration:

- `AGE_ASSURANCE_API_URL`: fixed HTTPS bridge base URL; redirects from API calls are rejected.
- `AGE_ASSURANCE_API_KEY`: server-only bearer credential, never a `NEXT_PUBLIC_` variable.
- `AGE_ASSURANCE_PROVIDER_NAME` and `AGE_ASSURANCE_PRIVACY_URL`: accurate provider identity and HTTPS notice shown before the check.
- `AGE_ASSURANCE_REDIRECT_ORIGIN`: exact approved HTTPS origin for hosted verification pages.
- `APP_URL`: canonical application origin, HTTPS in production.

`POST {base}/sessions` receives `{reference, minimumAge, jurisdiction, returnUrl}`. `reference` is a fresh random UUID unrelated to the Google account. Return `{transactionId, redirectUrl}`; the identifier must match `[A-Za-z0-9_-]{1,200}` and the redirect must use the approved origin. The bridge must bind the transaction to that reference, threshold and jurisdiction, and ensure its end-user verification flow cannot substitute another session's outcome. Do not pass age results or identity data in the return URL.

Rizzuno stores the transaction/reference and policy hash in a separately signed HTTP-only cookie for 15 minutes, clears browser eligibility and redirects. The return address is `APP_URL/?ageAssurance=complete`. That query flag only tells the browser to request completion through same-origin `POST /api/eligibility/assurance`; it is never evidence of age. Canceled/missing flows leave the user ineligible. Pending flows allow an explicit retry.

`POST {base}/sessions/result` receives `{transactionId, reference}` under the same bearer authentication. Return `{transactionId, reference, minimumAge, jurisdiction, status, meetsMinimumAge, expiresAt}`. Only `status: "passed"`, literal `meetsMinimumAge: true`, matching transaction/reference/threshold/jurisdiction and a future integer `expiresAt` in epoch milliseconds can grant provider eligibility. `pending` grants no access; other outcomes deny access. The expiry is capped to 24 hours and policy expiry. Requests have a ten-second timeout, no caching and no redirects. Browser assertions and unverified webhooks cannot grant access. API failures or invalid bindings fail closed. Shared database rate limits cap starts globally and completion retries per opaque reference; the provider must also implement appropriate abuse controls.

The bridge must return only the limited result fields above. Do not send names, exact DOBs, government-ID images, selfies or biometric templates to Rizzuno. Review the underlying provider's method, deletion duties, retention, security, subprocessors and independent assurance before enabling it. Require applicable identifying-data deletion by the provider, rather than assuming that a small Rizzuno result cookie satisfies a provider's duties. Bound provider-side transaction retention and clear expired transactions. Rizzuno's rate-limit keys are hashed and removed by the existing expired-limiter cleanup; no new identity-document archive or persistent age-profile table is created.

## Legal and structural reference notes

The existing Rizzuno documents retain separate service/eligibility, conduct, enforcement, data-use, sharing, retention, rights and contact sections. [OmeTV Terms](https://ome.tv/terms/), [Privacy Policy](https://ome.tv/privacy/) and [Rules](https://ome.tv/rules/) were consulted for that broad organization only. Rizzuno's language describes its own Google authentication, WebRTC limitations, moderation and data handling. It does not import OmeTV's operator details, licenses, monitoring claims or provider practices.

Primary-source examples checked on October 30, 2026 illustrate why policy must be scoped and maintained:

- The higher product thresholds reflect general majority rules described in [Nebraska §43-2101](https://nebraskalegislature.gov/laws/statutes.php?statute=43-2101), [Alabama DHR guidance citing §26-1-1](https://dhr.alabama.gov/wp-content/uploads/2026/01/OHC-02-Placement-of-Children-.pdf), and [Mississippi Department of Education guidance citing §1-3-27](https://msachieves.mdek12.org/mde-offers-back-to-school-enrollment-guidance/). Contracting, emancipation and other exceptions require separate analysis; the product does not offer an exception flow or equate contractual capacity with permission to use Rizzuno.
- [Nebraska §86-1703](https://nebraskalegislature.gov/laws/statutes.php?statute=86-1703) includes age checks for covered social-media accounts and identifying-information deletion duties. The [district court's June 2026 order in NetChoice v. Hilgers](https://docs.justia.com/cases/federal/district-courts/nebraska/nedce/4:2026cv03149/111385/33) preliminarily enjoins specified age-verification and parental-consent provisions. Statutory publication alone therefore cannot determine current enforceability; check later docket activity before a launch decision.
- [Mississippi's official 2024 legislative summary for HB 1126](https://www.legislature.ms.gov/media/1352/senate_summary_final_2024_v3.pdf) describes registration-age and commercially reasonable verification duties for covered digital services. This historical summary is not evidence that every provision is currently enforceable; the launch review must examine current litigation and statutory scope.
- [Texas Civil Practice and Remedies Code Chapter 129B](https://statutes.capitol.texas.gov/Docs/CP/pdf/CP.129B.pdf) addresses commercial entities publishing defined sexual material above its statutory threshold. Do not treat an adult-only social service and an adult-content site as automatically having identical legal duties, or infer an exemption solely from a ban on nudity.
- [Ofcom's age-assurance guidance](https://www.ofcom.org.uk/online-safety/protecting-children/age-assurance) distinguishes highly effective methods from self-declaration and contractual restrictions. This is relevant if the UK is considered for access; an 18+ notice alone does not establish that children cannot access a service.

These examples are not an exhaustive state/country inventory, a finding that a particular law applies to Rizzuno, or a guarantee of legal compliance. No production jurisdiction approvals are shipped as part of this change.
