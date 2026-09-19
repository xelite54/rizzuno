# Real device / TURN acceptance

Synthetic command: npm run test:webrtc:browser (default two-minute hold). It exercises real browser WebRTC against fixture accounts and database, not Google, physical cameras or production TURN.

Record release, date, device/OS/browser, network and safe pass/fail evidence. Use two different Google accounts on a Mac and physical phone. Test legal acceptance, camera and microphone allow/deny/retry, Wi-Fi↔cellular in both directions, both self/peer video tiles, audible speech, supported camera switch, mute/unmute, skip/rematch, friend call, background→foreground, two-minute sustained call and network recovery. Include blocked-user/rematch exclusion. Do not retain identifiable screenshots or SDP/IP dumps unnecessarily.

TURN: in an authenticated browser fetch /api/realtime/turn, confirm bounded expiry and no permanent shared secret in response/bundle. Securely save only its temporary iceServers response in a local restricted file. Set ALLOW_TURN_PROBE=1, TURN_PROBE_CREDENTIAL_FILE and TURN_PROBE_ALLOWED_HOSTS (comma-separated reviewed hostnames), then run `node --import tsx tests/browser/verifyProductionTurn.mts`. It uses isolated relay-only peers, checks allocated relay candidates, selected local AND remote relay candidate types and relayed data ping/pong. No cloud CLI credentials or permanent TURN secret are read. Delete credential file after testing. Do not run on untrusted PRs or publish credential files as artifacts.

A 200 credential endpoint is not relay verification. The dedicated probe is separate from the physical video test; both must pass. The default application's iceTransportPolicy remains all. Provider quotas/regions and relay transport support require operator confirmation.
