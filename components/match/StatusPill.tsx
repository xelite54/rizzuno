"use client"

import { SearchingMark } from "./SearchingMark"
import { PausedNotice } from "./PausedNotice"
import type { MatchState } from "@/hooks/useMatchmaking"

type StatusPillProps = {
  state: MatchState
  /** No live camera track right now — matching can't start (or resume) until there is one. Changes the idle/paused copy to say so, rather than a generic message that gives no indication anything's actually blocking it. */
  cameraOff?: boolean
  onPauseMatching?: () => void
  /** How many accounts currently have a live connection — `null` until the server's first "online-count" arrives. Shown alongside the waiting-state label so "Finding someone…" isn't just a spinner with no sense of whether anyone else is even around. */
  onlineCount?: number | null
}

function describeOnlineCount(count: number): string {
  return count === 1 ? "1 person online" : `${count.toLocaleString()} people online`
}

// A function rather than a static lookup table — "idle" and "paused" both
// need a second, camera-dependent answer, not just one label per state.
function describeState(state: MatchState, cameraOff: boolean): string {
  switch (state) {
    case "idle":
      // Matching starts on its own the instant a live camera track exists
      // (see MatchStage's auto-start effect) — there's never a real action
      // to prompt for here, only a reason it hasn't started yet. Same copy
      // as "searching" on purpose — the gap between "camera's on" and the
      // server actually confirming "queued" is real but brief, and showing
      // a separate "Getting ready…" for it read as a distinct, stalled
      // step rather than the same wait just starting.
      return cameraOff ? "Turn on your camera to start matching" : "Finding someone…"
    case "searching":
      return "Finding someone…"
    case "connecting":
      return "Connecting…"
    case "peer-left":
      return "They left — finding someone new…"
    case "paused":
      // The camera-on case never reaches this label at all — see below,
      // where "paused" branches to the full PausedNotice treatment before
      // any of this pill markup is even considered.
      return cameraOff ? "Turn on your camera to resume matching" : ""
    case "active":
      return ""
  }
}

export function StatusPill({ state, cameraOff = false, onPauseMatching, onlineCount = null }: StatusPillProps) {
  // "Paused" has two genuinely different presentations depending on why —
  // camera-off is a small blocker explained inline like every other pill
  // state below, but a deliberate pause with the camera still on gets the
  // full branded PausedNotice treatment instead (there's no peer, and empty
  // video reads as broken rather than restful — see PausedNotice's own
  // comment). This is still the one place that decision gets made — nothing
  // above this component chooses between the two.
  if (state === "paused" && !cameraOff) {
    return <PausedNotice onlineCount={onlineCount} />
  }

  const label = describeState(state, cameraOff)
  if (!label) return null

  // Not shown during "idle"/"searching" (both now read "Finding someone…")
  // — just the label on its own there. Still shown for "connecting" (a
  // real match was found, WebRTC is negotiating) and "peer-left" (about to
  // search again) — "paused" never gets here at all (a deliberate stop, not
  // a wait, so it doesn't get a label to attach this to in the first place).
  const waitingForMatch = state === "connecting" || state === "peer-left"
  const onlineCountLabel = waitingForMatch && onlineCount !== null ? describeOnlineCount(onlineCount) : null

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-center gap-3 rounded-full bg-black/60 py-3 pl-3 pr-5">
        <SearchingMark />
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
