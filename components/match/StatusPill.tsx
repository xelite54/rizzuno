"use client"

import { BrandMark } from "./BrandMark"
import { PausedNotice } from "./PausedNotice"
import type { MatchState } from "@/hooks/useMatchmaking"

type StatusPillProps = {
  state: MatchState
  /** No live camera track right now — matching can't start (or resume) until there is one. Changes the idle/paused copy to say so, rather than a generic message that gives no indication anything's actually blocking it. */
  cameraOff?: boolean
  onPauseMatching?: () => void
  /** How many accounts currently have a live connection — `null` until the server's first "online-count" arrives. Shown alongside the waiting-state label so "Finding someone…" isn't just a spinner with no sense of whether anyone else is even around. */
  onlineCount?: number | null
  /** Starts a fresh search — the same callback SwipeStage already threads through for the "paused" swipe-to-resume gesture, reused here for "error"'s own retry button. A real findMatch() call, not a generic "try again" no-op: it resets the ack-timeout's retry budget itself (see useMatchmaking.ts), so this is a genuinely new attempt, not a continuation of the exhausted one. */
  onResume?: () => void
}

function describeOnlineCount(count: number): string {
  return count === 1 ? "1 person online" : `${count.toLocaleString()} people online`
}

// A function rather than a static lookup table — "idle" and "paused" both
// need a second, camera-dependent answer, not just one label per state.
function describeState(state: MatchState, cameraOff: boolean): string {
  switch (state) {
    case "idle":
      // Matching is never auto-started (see MatchStage.tsx) — a first
      // visit or a refresh lands here and stays until the guest actually
      // swipes. The camera-on case never reaches this label at all — see
      // below, where "idle" branches to the same PausedNotice treatment
      // "paused" gets, before any of this pill markup is even considered.
      return cameraOff ? "Turn on your camera to start matching" : ""
    case "queue-pending":
      // "find"/"skip" was sent, but the server hasn't confirmed queue
      // membership ("queued") or found a match yet — see useMatchmaking's
      // own doc comment on this state. Used to show its own "Getting
      // ready…" label here, distinct from "searching"'s "Finding
      // someone…" — but the gap between the two is normally sub-second,
      // so in practice that just meant a visible flicker from one label to
      // the other almost immediately. Same label as "searching" now, so
      // there's nothing to flicker between; queue-pending resolving to a
      // real queue entry a moment later is invisible instead of announced.
      return "Finding someone…"
    case "searching":
      return "Finding someone…"
    case "connecting":
      return "Connecting…"
    case "peer-left":
      return "They left — finding someone new…"
    case "paused":
      // The camera-on case never reaches this label at all — see below,
      // where "paused" (like "idle" above) branches to the full
      // PausedNotice treatment before any of this pill markup is even
      // considered.
      return cameraOff ? "Turn on your camera to resume matching" : ""
    case "active":
      return ""
    case "error":
      // Reached only after the ack-timeout's own one automatic retry ALSO
      // went unanswered (see useMatchmaking.ts's decideQueuePendingTimeout)
      // — a real, honest dead end, not another silent retry.
      return "Couldn't find a match right now"
  }
}

export function StatusPill({ state, cameraOff = false, onPauseMatching, onlineCount = null, onResume }: StatusPillProps) {
  // "idle" and "paused" both get the full branded PausedNotice treatment
  // when the camera is on — matching is never auto-started (see
  // MatchStage.tsx), so a first visit ("idle") and a deliberate pause
  // ("paused") are the same "not currently searching, swipe when ready"
  // moment from the guest's own point of view, and share the exact same
  // "stay zone" screen rather than one of them showing a blank tile. Camera
  // off still gets its own small inline blocker instead, for both — there's
  // a more specific, actionable thing to say (there's no peer either way,
  // and empty video reads as broken rather than restful — see
  // PausedNotice's own comment). This is still the one place that decision
  // gets made — nothing above this component chooses between the two.
  if ((state === "idle" || state === "paused") && !cameraOff) {
    return <PausedNotice onlineCount={onlineCount} />
  }

  const label = describeState(state, cameraOff)
  if (!label) return null

  // Not shown during "idle"/"queue-pending"/"searching" — just the label on
  // its own there. Still shown for "connecting" (a real match was found,
  // WebRTC is negotiating) and "peer-left" (about to search again) —
  // "paused" never gets here at all (a deliberate stop, not a wait, so it
  // doesn't get a label to attach this to in the first place).
  const waitingForMatch = state === "connecting" || state === "peer-left"
  const onlineCountLabel = waitingForMatch && onlineCount !== null ? describeOnlineCount(onlineCount) : null

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-center gap-3 rounded-full bg-black/60 py-3 pl-3 pr-5">
        {/* The same mark the login page uses — not a separate
            reimplementation of it, just this component at a size that
            fits next to the pill's own text. */}
        <BrandMark size={26} />
        <span className="text-[14px] font-semibold tracking-tight text-foreground">{label}</span>
        {onlineCountLabel && (
          <>
            <span className="h-1 w-1 rounded-full bg-white/30" aria-hidden="true" />
            <span className="text-[13px] font-medium text-muted">{onlineCountLabel}</span>
          </>
        )}
      </div>
      {/* Right away, not delayed — a delay just meant this and the "Finding
          someone…" label it sits under went out of sync with the moment
          searching actually starts (e.g. right after an undo window ends).
          Shown during "queue-pending" too — wanting to stop trying is valid
          before the server has confirmed the attempt, not just after. */}
      {(state === "searching" || state === "queue-pending") && onPauseMatching && (
        <button
          type="button"
          onClick={onPauseMatching}
          className="text-[13px] font-medium text-muted transition hover:text-foreground hover:underline underline-offset-2"
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
