"use client"

import { VideoTile } from "./VideoTile"
import { BrandMark } from "./BrandMark"
import type { MediaPermissionState } from "@/hooks/useLocalMedia"

type SelfPanelProps = {
  stream: MediaStream | null
  status: MediaPermissionState
  cameraEnabled: boolean
}

export function SelfPanel({ stream, status, cameraEnabled }: SelfPanelProps) {
  const showVideo = Boolean(stream) && cameraEnabled && status === "granted"

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl bg-surface">
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
      {/* The brand wordmark, on your own side of the screen, top-left of
          this tile — present in every state above (live video, camera off,
          denied, unavailable, still turning on), not just the sign-in
          screen, so it's there through idle/searching/matching/an active
          call too, not just before you're signed in. The same two-tone
          accent/accent-2 gradient the rest of the brand mark uses, not
          plain white — deliberately the one spot of real color on this
          tile. The drop shadow keeps it legible over whatever's actually
          in the video, not just this app's own dark surface colors. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-2 top-2 bg-gradient-to-r from-accent to-accent-2 bg-clip-text text-[13px] font-extrabold uppercase tracking-[0.12em] text-transparent drop-shadow-[0_1px_3px_rgba(0,0,0,0.75)]"
      >
        Rizzuno
      </span>
    </div>
  )
}
