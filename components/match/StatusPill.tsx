"use client"

import { SearchingMark } from "./SearchingMark"
import type { MatchState } from "@/hooks/useMatchmaking"

const COPY: Record<MatchState, string> = {
  idle: "Say hello to get started",
  searching: "Finding someone…",
  connecting: "Connecting…",
  active: "",
  "peer-left": "They left — finding someone new…",
  paused: "",
}

type StatusPillProps = {
  state: MatchState
  onPauseMatching?: () => void
}

export function StatusPill({ state, onPauseMatching }: StatusPillProps) {
  const label = COPY[state]
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
