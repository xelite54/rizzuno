"use client"

import { VideoTile } from "./VideoTile"
import type { MediaPermissionState } from "@/hooks/useLocalMedia"

type SelfPanelProps = {
  localStream: MediaStream | null
  status: MediaPermissionState
  /** Removes the desktop rounding when this panel is flush against the homepage content panel. */
  flushDesktop?: boolean
}

export function SelfPanel({ localStream, status, flushDesktop = false }: SelfPanelProps) {
  const showVideo = Boolean(localStream) && status === "granted"

  return (
    <div className={`relative h-full w-full overflow-hidden rounded-2xl bg-surface ${flushDesktop ? "md:rounded-none" : ""}`}>
      {showVideo ? (
        <VideoTile role="self" localStream={localStream} mirrored />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-surface px-8 text-center">
          {status === "denied" ? (
            <p className="text-sm text-muted">
              Camera access was blocked. Enable it in your browser settings to be seen and start matching.
            </p>
          ) : status === "unavailable" ? (
            <p className="text-sm text-muted">No camera detected on this device. A camera is required to match.</p>
          ) : (
            <p className="text-sm text-muted">Preparing video…</p>
          )}
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent" />
    </div>
  )
}
