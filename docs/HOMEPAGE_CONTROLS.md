# Homepage controls and deployment verification

## Root causes

The old production homepage unmounted all four controls through `signedIn && legalAccepted && onboarded && !restriction`. The persistent-controls revision removed that gate, but never reached production: Vercel deployment `dpl_7APGLw9G8qurbXm5T2RWySX9pAWF` for `c96c8ce9` failed while loading `next.config.ts` with `Missing required configuration: AUTH_URL`. Both `AUTH_URL` and `APP_URL` were absent. They are now configured in the project's production environment to its verified canonical domain, `https://rizzuno.com`. Secret values are never committed or logged; sensitive Vercel variables are redacted when downloaded, so the cloud build must validate their actual values.

There were two additional source-level conflicts. Controls inherited the camera's Motion layout transform and clipping, and `useHomeSplit`/`useCallLayout` depended on different combinations of auth/legal/profile/restriction state. Also, hello retry timers could outlive a successful `ready`; another ticket attempt reset readiness and cleared restrictions before admission. The integration regression injects an error followed by `ready` and asserts no extra ticket/hello is sent when the former two-second timer would have fired. Running this test against the original hook failed: ticket count increased from 3 to 4 after ready; the fixed hook cancels that stale retry.

## Implementation

- A persistent sibling overlay shares the video's final layout geometry through `stageLayout` and `selfFrame` CSS. It does not inherit camera transforms or overflow. Existing control icons, positions relative to the self frame, and callbacks are retained.
- Only matchmaking state selects home versus call layout. Auth, profile, legal checks, presence, and camera readiness control action availability, not layout or control lifetime.
- A single cancellable hello retry is scoped to the current connection/account, with one ticket request in flight. `ready` cancels retries and clears restrictions; a ticket response alone does neither. Teardown invalidates pending responses/timers.
- No new visibility timers, forced reloads, or CSS hiding workarounds were added.

## Tests

`npm run test:homepage:runtime` renders the actual `MatchStage`, Auth.js `SessionProvider`, all application hooks, Motion/CSS, and the real WebSocket server. HTTP/database services and capture hardware are fixtures, not the state-producing React hooks. Two Chrome clients run real media/signaling. The default three-minute run covers hydration, session refresh, legal acceptance refresh, hello/reconnect, rate-limited tickets, invalid-ticket restriction/recovery, camera loss/recovery, searching, matching, skip, pause, and desktop/mobile layouts. It monitors original button DOM identities, removals, duplication, visibility, clipping, viewport bounds, React commits/mounts, and console errors. Expected injected fault diagnostics are distinguished from unexpected errors.

`npm run test:homepage:browser` retains the exhaustive state-fixture test as supplemental coverage. Both tests save evidence to the printed temporary directory. Set `CHROME_PATH` when Chrome is installed outside the default macOS path. Shorter `HOMEPAGE_HOLD_MS` values are for debugging and do not prove several-minute stability.

`PRODUCTION_URL=https://rizzuno.com node --import tsx tests/browser/runHomepageProduction.mts` checks the actual deployed homepage for three minutes, alternates desktop/mobile dimensions, records network responses and console errors, and verifies original control DOM identities and computed visibility. It uses an isolated, signed-out browser, not a real Google account. Authenticated state/recovery coverage comes from the separate integration test; do not describe that fixture coverage as live authenticated production verification.
