"use client"

import { BrandMark } from "./BrandMark"
import { PausedNotice } from "./PausedNotice"
import type { MatchState } from "@/hooks/useMatchmaking"

type StatusPillProps = {
  state: MatchState
  /** No live camera track right now — matching can't start (or resume) until there is one. Changes the idle/paused copy to say so, rather than a generic message that gives no indication anything's actually blocking it. */
  cameraUnavailable?: boolean
  onPauseMatching?: () => void
  /** How many accounts currently have a live connection — `null` until the server's first "online-count" arrives. Shown alongside the waiting-state label so "Finding someone…" isn't just a spinner with no sense of whether anyone else is even around. */
  onlineCount?: number | null
  /** Starts a fresh search — the same callback SwipeStage already threads through for the "paused" swipe-to-resume gesture, reused here for "error"'s own retry button. A real findMatch() call, not a generic "try again" no-op: it resets the ack-timeout's retry budget itself (see useMatchmaking.ts), so this is a genuinely new attempt, not a continuation of the exhausted one. */
  onResume?: () => void
}

// A function rather than a static lookup table — "idle" and "paused" both
// need a second, camera-dependent answer, not just one label per state.
function describeState(state: MatchState, cameraUnavailable: boolean): string {
  switch (state) {
    case "idle":
      // Matching is never auto-started (see MatchStage.tsx) — a first
      // visit or a refresh lands here and stays until the guest actually
      // swipes. The camera-on case never reaches this label at all — see
      // below, where "idle" branches to the same PausedNotice treatment
      // "paused" gets, before any of this pill markup is even considered.
      return cameraUnavailable ? "Camera access is required to start matching" : ""
    case "queue-pending":
    case "searching":
    case "peer-left":
      // No label while waiting for a match — just the bare logo (see the
      // render below, which shows BrandMark alone whenever this returns
      // ""). "connecting" is the one waiting phase that still gets an
      // actual word, since it's a distinct, shorter beat once someone's
      // actually been found and the call is coming together.
      return ""
    case "connecting":
      return "Connecting…"
    case "paused":
      // The camera-on case never reaches this label at all — see below,
      // where "paused" (like "idle" above) branches to the full
      // PausedNotice treatment before any of this pill markup is even
      // considered.
      return cameraUnavailable ? "Camera access is required to resume matching" : ""
    case "active":
      return ""
    case "error":
      // Reached only after the ack-timeout's own one automatic retry ALSO
      // went unanswered (see useMatchmaking.ts's decideQueuePendingTimeout)
      // — a real, honest dead end, not another silent retry.
      return "Couldn't find a match right now"
  }
}

export function StatusPill({ state, cameraUnavailable = false, onPauseMatching, onlineCount = null, onResume }: StatusPillProps) {
  // "idle" and "paused" both get the full branded PausedNotice treatment
  // when the camera is on — matching is never auto-started (see
  // MatchStage.tsx), so a first visit ("idle") and a deliberate pause
  // ("paused") are the same "not currently searching, swipe when ready"
  // moment from the guest's own point of view, and share the exact same
  // signed-in home screen rather than one of them showing a blank tile. Camera
  // off still gets its own small inline blocker instead, for both — there's
  // a more specific, actionable thing to say (there's no peer either way,
  // and empty video reads as broken rather than restful — see
  // PausedNotice's own comment). This is still the one place that decision
  // gets made — nothing above this component chooses between the two.
  if ((state === "idle" || state === "paused") && !cameraUnavailable) {
    return <PausedNotice onlineCount={onlineCount} paused={state === "paused"} />
  }

  const label = describeState(state, cameraUnavailable)
  // Waiting for a match is a bare logo, not empty — see describeState.
  // "active" (mid-call) is the one truly label-less state that renders
  // nothing at all here, since PersonBadge/the wordmark on the peer's own
  // tile already cover that moment.
  const logoOnly = !label && (state === "queue-pending" || state === "searching" || state === "peer-left")
  if (!label && !logoOnly) return null

  return (
    <div className="flex flex-col items-center gap-3">
      {/* The dark pill background is only for contrast behind actual text
          ("Connecting…"/"Couldn't find a match…") — the bare logo shown
          while just waiting for a match (queue-pending/searching/
          peer-left, no label at all) sits directly over the video with no
          backdrop behind it. */}
      <div className={label ? "flex items-center gap-3 rounded-full bg-black/60 py-3 pl-3 pr-5" : "flex items-center p-3"}>
        {/* The same mark the login page uses — not a separate
            reimplementation of it, just this component at a size that
            fits next to the pill's own text. */}
        <BrandMark size={26} />
        {label && <span className="text-[14px] font-semibold tracking-tight text-foreground">{label}</span>}
      </div>
      {/* Right away, not delayed — a delay just meant this and the "Finding
          someone…" label it sits under went out of sync with the moment
          searching actually starts. Shown during "queue-pending" too —
          wanting to stop trying is valid before the server has confirmed
          the attempt, not just after. */}
      {(state === "searching" || state === "queue-pending") && onPauseMatching && (
        <button
          type="button"
          onClick={onPauseMatching}
          className="text-[13px] font-medium text-muted drop-shadow-[0_1px_3px_rgba(0,0,0,0.75)] transition hover:text-foreground hover:underline underline-offset-2"
        >
          Pause matching
        </button>
      )}
      {/* "error" only ever reaches here after the automatic retry budget is
          spent — the only way out from here is a genuinely new attempt,
          never another silent auto-retry. */}
      {state === "error" && onResume && (
        <button
          type="button"
          onClick={onResume}
          className="text-[13px] font-medium text-muted transition hover:text-foreground hover:underline underline-offset-2"
        >
          Try again
        </button>
      )}
    </div>
  )
}
