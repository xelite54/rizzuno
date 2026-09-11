# WebRTC browser regression

Run `npm run test:webrtc:browser` from the repository root. It launches two isolated Chrome processes and a localhost instance of the real Rizzuno signaling server. Set `CHROME_PATH` if Chrome is installed elsewhere. The default stability hold is 120 seconds; `MEDIA_HOLD_MS` can shorten it when debugging a failing scenario. Shortened runs do not establish the two-minute requirement.

The harness uses the real React hooks (`useLocalMedia`, `useMatchmaking`, `useSignalingSocket`, `useWebRTC`), SelfPanel/VideoTile, SwipeStage, PeerProfileSheet, MatchChatPanel, browser SDP/ICE/DTLS/RTP, and video playback. Canvas cameras produce moving red/blue pictures, and Web Audio supplies microphone tracks. Only capture hardware, account-ticket issuance, and database services are test fixtures. No Google authentication, production account, physical camera, phone, or production TURN relay is exercised. The native fake-device getUserMedia path stalled on this host, so deterministic browser media sources supply the capture fixture.

## Root cause reproduced

With the old setup, both browsers called `addTransceiver` before receiving SDP. Chrome reproduced four answerer transceivers, an unassociated answerer camera sender, and an offerer video direction of `sendonly`. The answerer's camera could never reach the offerer through that first answer.

`addTrack` creates the initial sendrecv transceivers that the answerer can associate with the incoming offer. Subsequent changes use the retained sender's `replaceTrack`. This follows the [WebRTC transceiver association rules](https://www.w3.org/TR/webrtc/#rtcrtptransceiver-interface). No second connection or extra negotiation round is required.

## Final verification

The full browser run passed with a **120,368 ms hold and 24 five-second samples**. Each side had one peer connection, one open socket, two associated sendrecv transceivers, and 1,808 incoming decoded/outgoing sent video frames at the last sample.

| Browser | Self camera RGB | Peer camera RGB | State |
| --- | --- | --- | --- |
| A | 255, 1, 0 (red) | 1, 0, 255 (blue) | active |
| B | 1, 0, 255 (blue) | 255, 1, 0 (red) | active |

The same run passed:

- Audio-first ontrack delivery followed by remote video publication and playback.
- Continuous React rerenders and more than two minutes of incomplete hydration state without room/socket teardown.
- Muted autoplay fallback, followed by a user gesture restoring peer sound.
- Mute/unmute, camera replacement, and ended capture reacquisition on a simulated foreground event.
- Skip, next random match, and friend/direct call, each creating exactly one new peer per device for the new room. A third synthetic account supplies the next random partner, preserving the real recent-partner cooldown.
- A short simulated transport interruption without a restart, followed by a longer interruption and one actual SDP ICE restart on the same connection.
- Paused peer video remaining connecting despite 142 decoded inbound frames, followed by bounded clean room termination.
- Intentional sign-out closing the signaling socket.

Other checks: root TypeScript, browser-harness TypeScript, **232 passing tests**, ESLint (zero errors; one pre-existing image-moderation warning), and production build. The optional whole-tests TypeScript project still reports existing mock-module/type errors outside these changes; its tests execute successfully.

TURN route tests verify authenticated issuance, HMAC-SHA1 credential contents, future expiry, and an opaque username. The local environment has no TURN configuration, so relay allocation against the production provider remains unverified. The client retains `iceTransportPolicy: "all"`, STUN/direct connectivity, and credentialed legacy fallback.

## Remaining live acceptance check

These automated results do not establish physical-device or Google-session behavior. Before declaring the user's full acceptance test complete, run the deployed change with two different Google accounts on Mac and phone: verify all four tiles simultaneously for two minutes, mute/unmute, supported camera switching, skip/new random match, friend call, and actual mobile background/foreground. Verify one `webrtc: peer created` per room/device and inspect socket close diagnostics. A real relay allocation is also needed to establish production TURN usability. Production inspection subsequently confirmed that both Vercel (READY) and Railway (SUCCESS) are already serving commit `be06780809446cddd831ca7e0f76d843a6b8baa3`, which includes the fixes. The public rizzuno.com bundle contains the corrected media lifecycle; `/api/realtime/turn` responds 401 without authentication and Railway `/health` responds 200. No redundant deployment was performed.

A restricted live TURN probe is prepared in `verifyProductionTurn.mts`. It reads only the production TURN URL and shared secret, mints a five-minute credential, and tests relayed ping/pong between two isolated browser peers. It is restricted to the ExpressTURN hosts observed in the production bundle and emits only connection state, candidate types, and error codes. Execution awaits explicit user approval because automatic approval review rejected retrieving production secrets and transmitting derived credentials to the relay without that specific authorization.

## Matched profile and mobile chat regression

The harness also opens each peer profile while video is still connecting and sends messages through the real chat form in both directions, checking peer receipt and sender acknowledgment. The chat is deliberately mounted under a transformed, clipped 96 × 128 container to reproduce the mobile self-tile bug. With the portal fix, its panel and input remain visible and hit-testable at 390 × 844, 320 × 568, 390 × 430, and 844 × 390. The reduced-height viewport models available keyboard space; it does not exercise an actual iOS keyboard. A `mobile-chat.png` screenshot is saved alongside the JSON evidence. This UI regression passed with a shortened five-second media hold; the earlier two-minute media result above remains a separate run.
