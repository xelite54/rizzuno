import { ciLaunchFixture } from "./ci-launch-fixture.mjs"
// Compile-only environment: no reachable provider and no production credentials.
// Production builds use npm run build directly and MUST supply real config.
import { spawnSync } from "node:child_process"
const result = spawnSync("npm", ["run", "build"], { stdio: "inherit", env: {
  ...process.env, ...ciLaunchFixture, NODE_ENV: "production", DATABASE_URL: "postgresql://ci:ci@127.0.0.1:1/ci",
  DATABASE_SSL_CA: "", DATABASE_SSL_CA_REQUIRED: "false",
  AUTH_SECRET: "ci-only-auth-secret-000000000000000000000", AUTH_GOOGLE_ID: "ci.invalid", AUTH_GOOGLE_SECRET: "ci-only",
  AUTH_URL: "https://ci.invalid", APP_URL: "https://ci.invalid", REALTIME_TICKET_SECRET: "ci-only-realtime-secret-000000000000000000",
  NEXT_PUBLIC_WS_URL: "wss://ci.invalid/ws", NEXT_PUBLIC_TURN_URL: "turn:ci.invalid:3478", TURN_STATIC_AUTH_SECRET: "ci-only-turn-secret",
  NEXT_PUBLIC_TURN_USERNAME: "", NEXT_PUBLIC_TURN_CREDENTIAL: "",
  SIGHTENGINE_API_USER: "ci-only", SIGHTENGINE_API_SECRET: "ci-only", BILLING_MODE: "free_test",
  IMAGE_STORAGE_URL: "https://ci.invalid", IMAGE_STORAGE_KEY: "ci-only", IMAGE_STORAGE_BUCKET: "ci-images",
} })
process.exit(result.status ?? 1)
