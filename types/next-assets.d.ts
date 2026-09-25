// Committed stand-in for the gitignored, build-generated next-env.d.ts:
// declares CSS-module and image imports so `npm run typecheck` passes on a
// fresh checkout (CI) before `next build` has ever run.
/// <reference types="next" />
/// <reference types="next/image-types/global" />
