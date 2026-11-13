# Dependency security verification — 2026-11-13

The [latest failed CI run](https://github.com/xelite54/rizzuno/actions/runs/41363702026)
at `95d8da0edcf73739098f705d4e17fb190004a92f` reported **21 vulnerabilities:
1 critical, 4 high, and 16 moderate**. Its security job failed at
`npm audit --audit-level=high`; its browser job also failed on the second mobile
photo-viewer swipe. Quality and Redis integration jobs had passed.

After updating and running a clean `npm ci`, both `npm audit --audit-level=high`
and the full JSON audit passed with **0 vulnerabilities**: 0 critical, 0 high,
0 moderate, 0 low, and 0 informational. Development dependencies are included.
Audit results reflect the npm advisory database on the verification date.

## Dependency changes

| Dependency | Previous | Verified version |
| --- | --- | --- |
| Next.js and eslint-config-next | 16.3.5 | 16.4.6 |
| Sharp | 0.35.4 | 0.35.5 |
| Sharp's platform libvips packages | 1.3.3 | 1.3.4 |
| Zod (transitive) | 4.4.3 | 4.6.7 |
| source-map-js (transitive) | 1.2.1 | 1.2.2 |
| brace-expansion (transitive) | 1.1.18 / 5.0.9 | 1.1.22 / 5.0.13 |
| TypeScript ESLint packages (transitive) | 8.67.0 | 8.72.2 |
| Parser's minimatch (transitive) | 10.2.6 | 11.0.8 |

The lockfile includes the updated native packages for supported platforms.
The installed Next.js upgrade documentation was reviewed before code changes.
No application migration was needed; existing React, authentication, image,
database, and realtime interfaces passed verification.

The current TypeScript ESLint parser still requests vulnerable minimatch 10.
A `package.json` override applies minimatch 11.0.8 **only** beneath
`@typescript-eslint/typescript-estree`. Other consumers retain their compatible
versions and export shapes. The parser uses the named CommonJS `minimatch`
function, which this version preserves. An additional real-parser check verified
that project-service glob matching accepts matching paths, returns a TypeScript
program, and rejects unmatched paths. Remove the override when the parser's
own dependency range includes a patched release.

Relevant advisories:

- [Next.js critical cache RCE](https://github.com/advisories/GHSA-673q-mjm6-r5xr)
- [Sharp librsvg vulnerability](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)
- [Zod constrained collection memory exhaustion](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
- [source-map-js indexed map denial of service](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)
- [brace-expansion recursion denial of service](https://github.com/advisories/GHSA-qhr7-859c-m2p7)
- [minimatch glob amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249)

## Browser regression correction

The failed mobile test was reproduced locally. `AnimatePresence` retains the
departing images while the next photo slides into place. The dialog label changes
first, so the runner proceeded before the displayed image settled. Its next
touch started on an outgoing image's offscreen coordinates and hit the page
instead of the swipe surface.

The harness now reports the number of image elements. Its existing photo
predicate requires exactly one image, the expected photo's alt text, and a
centered image inside the viewport before continuing. It retains real touch,
keyboard, boundary, focus, click-outside, and close-button assertions and does
not disable animations or change application behavior.

The full homepage runs also exposed a local Chrome cleanup issue: the browser's
crash reporter inherited its stderr pipe, keeping Node alive after the browser
exited and all assertions passed. The shared test launcher now destroys that
diagnostics pipe on browser exit. This preserves failure diagnostics collected
while Chrome is running and allows the runners to finish without forcing a
successful process exit or relaxing any browser sandbox settings.

## Verification

Environment: Node.js 24.15.0, npm 11.12.1, macOS arm64, Chrome 157.0.8103.52.
The Redis integration test used a temporary Redis 8.10.2 server binary.

| Check | Result |
| --- | --- |
| `npm ci` | Passed; 0 vulnerabilities |
| `npm audit --audit-level=high` | Passed; 0 vulnerabilities |
| `npm audit --json` | All severity counts 0 |
| `npm ls --all` | Passed; no invalid dependency relationships |
| `npm run lint` | Passed; no warnings or errors |
| `npm run typecheck` | Passed for application, tests, and browser harness |
| `npm test` | 343 passed, 0 failed, 0 skipped |
| `npm run test:cluster` | 1 passed, 0 failed; real cross-process Redis matchmaking, coordinator death, fencing, replacement, and reconnect |
| `node scripts/ci-build.mjs` | Passed; invokes the production `npm run build` with isolated fixture configuration; 33 static page-generation tasks completed |
| Real TypeScript ESLint parser with scoped minimatch override | Matching and unmatched project-service paths behaved correctly |
| `npm run test:postviewer:browser` | Passed on desktop/mobile galleries and profile sheets; both swipe directions and all other assertions preserved |
| `npm run test:profiles:browser` | Passed for invitations, friends, requests, search, current match, and history |
| `npm run test:webrtc:browser` | Passed; 120,212 ms bidirectional call, 24 samples; media controls, transport recovery, random/direct calls, chat, legal gate, and sign-out |
| `npm run test:homepage:browser` | Passed; 180,980 ms, 17,357 frame/DOM samples; responsive layout, age declaration, geographic denial, and persistent controls |
| `npm run test:homepage:runtime` | Passed; 181,832 ms; real hooks/HTTP/WebSocket/WebRTC, reconnects, session refresh, camera recovery, matching, legal acceptance, and geographic denial |

All five browser commands exited successfully after the cleanup correction; the
default two-/three-minute stability durations were retained. Lint, all three
TypeScript checks, and the security audit were run again after the final edits.

Security workflow thresholds, secret scanning, production configuration
validation, authorization, moderation, and launch-readiness checks remain intact.
No production deployment was performed.

Browser coverage uses real Chromium, React hooks, HTTP, WebSockets, WebRTC,
SDP/ICE/DTLS/RTP, and playback with synthetic camera/microphone sources and
fixture account/database services. Physical devices, Google sign-in, and a live
production TURN relay are outside these local automated tests. No production
credentials or deployments are needed to run them.
