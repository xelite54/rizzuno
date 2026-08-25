"use client"

import { SearchingMark } from "./SearchingMark"
import type { MatchState } from "@/hooks/useMatchmaking"

type StatusPillProps = {
  state: MatchState
  /** No live camera track right now — matching can't start (or resume) until there is one. Changes the idle/paused copy to say so, rather than a generic message that gives no indication anything's actually blocking it. */
  cameraOff?: boolean
  onPauseMatching?: () => void
}

// A function rather than a static lookup table — "idle" and "paused" both
// need a second, camera-dependent answer, not just one label per state.
function describeState(state: MatchState, cameraOff: boolean): string {
  switch (state) {
    case "idle":
      // Matching starts on its own the instant a live camera track exists
      // (see MatchStage's auto-start effect) — there's never a real action
      // to prompt for here, only a reason it hasn't started yet.
      return cameraOff ? "Turn on your camera to start matching" : "Getting ready…"
    case "searching":
      return "Finding someone…"
    case "connecting":
      return "Connecting…"
    case "peer-left":
      return "They left — finding someone new…"
    case "paused":
      // Only reached when paused *and* the camera's off — see SwipeStage,
      // which shows PausedNotice instead whenever a real resume is
      // possible (`onResume` is only passed down while the camera is on).
      return cameraOff ? "Turn on your camera to resume matching" : ""
    case "active":
      return ""
  }
}

export function StatusPill({ state, cameraOff = false, onPauseMatching }: StatusPillProps) {
  const label = describeState(state, cameraOff)
  if (!label) return null

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-center gap-3 rounded-full bg-black/60 py-3 pl-3 pr-5">
        <SearchingMark />
        <span className="text-[14px] font-semibold tracking-tight text-foreground">{label}</span>
      </div>
      {/* Right away, not delayed — a delay just meant this and the "Finding
          someone…" label it sits under went out of sync with the moment
          searching actually starts (e.g. right after an undo window ends). */}
      {state === "searching" && onPauseMatching && (
        <button
          type="button"
          onClick={onPauseMatching}
          className="text-[13px] font-medium text-muted transition hover:text-foreground hover:underline underline-offset-2"
        >
          Pause matching
        </button>
      )}
    </div>
  )
}
