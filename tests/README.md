# Rizzuno automated tests

Real, executed tests for the matchmaking/realtime state machine — not just
narrated reasoning. No new dependency: uses Node's own built-in test runner
(`node:test`), which this project's already-required Node 22+ has, plus
`tsx` (already a dependency) to run the `.mts` files directly.

Run with:

```
npm test
```

## Why `.mts`, not `.ts`

The root `tsconfig.json`/project has no `"type": "module"`, so a plain
top-level `await` in a `.ts` file run through `tsx` transforms to CJS output,
which doesn't support it. `.mts` forces ESM regardless of that setting — the
files here use dynamic `import()` after `node:test`'s `mock.module()` calls,
which needs to happen before `server/matchmaker.ts`/`server/ws-server.ts`
(and, transitively, `lib/db.ts`) are ever loaded.

`tests/` is excluded from the root `tsconfig.json`'s type-check scope (so
`npx tsc --noEmit` and `next build` both skip it) — `tests/tsconfig.json`
exists for editor support, not as a separate required build step; the tests
are validated by actually running them.

## What's covered

- **`signalBacklog.test.mts`** — the pure, framework-independent
  `lib/signalBacklog.ts` class (ordered per-room buffering of WebRTC
  offer/answer/ICE signals that arrive before `useWebRTC` has subscribed
  yet, and its buffered-signal cap).
- **`matchmaker.test.mts`** — `server/matchmaker.ts`'s reserve → commit /
  abort state machine directly, against a lightweight in-memory
  `CheckLive`/`FakeConnection` registry (not real sockets — see
  `ws-server.test.mts` for that) that drives the exact same
  open/seeking/`searchGeneration`/room contract `server/ws-server.ts`'s real
  `makeCheckLive` implements. `lib/db.ts`'s `isBlockedEitherWay` is mocked
  (`node:test`'s `mock.module`, `--experimental-test-module-mocks`) so
  nothing needs a live Postgres. Each test builds its own `Matchmaker`
  instance (the class is exported specifically for this) so one test's
  leftover, never-matched queue entries can never leak into another. Covers:
  a stale (pre-leave/pre-rejoin) `searchGeneration` snapshot never being
  used to commit a match, a paused/closed initiator or candidate aborting
  the attempt cleanly, and the recent-partner cooldown being recorded only
  on `commitMatch`, never on a bare reservation or `deleteReservation`.
- **`ws-server.test.mts`** — full integration tests: a real HTTP server +
  the real `server/ws-server.ts` WebSocket server, real `ws` client
  connections, real signed tickets (`lib/realtimeTicket.ts`'s actual
  `mintTicket`/`verifyTicket`, unmocked), and a mocked `lib/db.ts`
  (`helpers/dbMock.mts`) that can simulate failures (a thrown
  `areFriends`/`addBlock`/friends-snapshot query) and artificial delays —
  `blockCheckDelayMs` (the block-check inside `reserveMatch`) and
  `friendsCheckDelayMs` (the Friends lookup between reservation and
  "matched" actually being sent) — to create genuine async race windows for
  pause/camera-off/disconnect-during-lookup and socket-closes-right-before-
  delivery scenarios, exercised through the real client-facing protocol
  (send "leave"/"leave"+"find"/close the socket) rather than simulated.

## What's intentionally NOT covered here

- `hooks/useMatchmaking.ts`, `hooks/useWebRTC.ts`, `components/match/
  MatchStage.tsx` — real React hooks/components using browser-only APIs
  (`RTCPeerConnection`, DOM). Testing these would need a browser or DOM
  environment (jsdom + a React test renderer) that isn't set up in this
  project; adding one is a bigger call than this task's scope. Their logic
  is instead covered indirectly: the pure backlog class they use is fully
  tested, and the server-side contract they talk to (what a real
  hello/find/block/profile-update round trip actually does) is exercised
  end-to-end via `ws-server.test.mts`.
- A real Postgres, a real TURN relay, and a real two-browser/two-Google-
  account production run — none of those are reachable from an automated
  test in this environment either.
