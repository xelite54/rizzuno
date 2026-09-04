"use client"

import { VideoTile } from "./VideoTile"
import { BrandMark } from "./BrandMark"
import type { MediaPermissionState } from "@/hooks/useLocalMedia"

type SelfPanelProps = {
  stream: MediaStream | null
  status: MediaPermissionState
  cameraEnabled: boolean
  /** Removes the desktop rounding when this panel is flush against the homepage content panel. */
  flushDesktop?: boolean
}

export function SelfPanel({ stream, status, cameraEnabled, flushDesktop = false }: SelfPanelProps) {
  const showVideo = Boolean(stream) && cameraEnabled && status === "granted"

  return (
    <div className={`relative h-full w-full overflow-hidden rounded-2xl bg-surface ${flushDesktop ? "md:rounded-none" : ""}`}>
      {showVideo ? (
        <VideoTile stream={stream} muted mirrored />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-surface px-8 text-center">
          {status === "denied" ? (
            <p className="text-sm text-muted">
              Camera access was blocked. Enable it in your browser settings to be seen and start matching.
            </p>
          ) : status === "unavailable" ? (
            <p className="text-sm text-muted">No camera detected on this device. A camera is required to match.</p>
          ) : status === "granted" && !cameraEnabled ? (
            <>
              {/* The same mark the login page uses, not a warning icon —
                  matching is just waiting on the camera, not broken. The
                  "why"/"what to do about it" for matching itself is owned by
                  StatusPill, which is on screen at the same time on the main
                  panel — this stays factual so the two don't say
                  overlapping things about matching. */}
              <BrandMark size={32} />
              <p className="text-sm text-muted">Camera is off</p>
            </>
          ) : (
            <p className="text-sm text-muted">Turning on your camera…</p>
          )}
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent" />
    </div>
  )
}
