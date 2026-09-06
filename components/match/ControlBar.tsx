"use client"

import { MicIcon, MicOffIcon } from "@/components/icons"

type ControlBarProps = {
  micEnabled: boolean
  onToggleMic: () => void
}

/** Microphone control; chat is adjacent in the self-video overlay. */
export function ControlBar({ micEnabled, onToggleMic }: ControlBarProps) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onToggleMic}
        aria-pressed={!micEnabled}
        aria-label={micEnabled ? "Mute microphone" : "Unmute microphone"}
        className={`flex h-9 w-9 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 ${
          micEnabled
            ? "text-foreground hover:bg-white/15 active:bg-white/15"
            : "bg-danger text-accent-foreground hover:brightness-110"
        }`}
      >
        {micEnabled ? <MicIcon className="h-[17px] w-[17px]" /> : <MicOffIcon className="h-[17px] w-[17px]" />}
      </button>
    </div>
  )
}
