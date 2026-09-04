"use client"

import { useEffect, useRef, useState } from "react"
import { motion, useMotionValue, useTransform, animate, AnimatePresence, useReducedMotion } from "motion/react"
import { VideoTile } from "./VideoTile"
import { PersonBadge } from "./PersonBadge"
import { StatusPill } from "./StatusPill"
import { MicOffIcon } from "@/components/icons"
import { EASE_OUT, DURATION_BASE } from "@/lib/motion"
import type { FriendState } from "./FriendButton"
import type { MatchState, PeerProfile } from "@/hooks/useMatchmaking"

const SWIPE_DISTANCE_THRESHOLD = 140
const SWIPE_VELOCITY_THRESHOLD = 650
const WHEEL_THRESHOLD = 90
const WHEEL_IDLE_RESET_MS = 220

type SwipeStageProps = {
  matchState: MatchState
  peer: PeerProfile | null
  peerMicEnabled?: boolean
  friendState: FriendState
  onAddFriend: () => void
  remoteStream: MediaStream | null
  onSwipeComplete: () => void
  /** When true, swiping is disabled — used while a just-completed skip is still undoable. */
  locked?: boolean
  /** Shown as a small secondary action under "Finding someone…" a few seconds in. */
  onPauseMatching?: () => void
  /** Resuming from the paused state isn't a button — it's the same swipe-left gesture used to skip someone, so this fires off the end of that gesture instead. Left undefined (by MatchStage, whenever there's no live camera track) to disable that gesture entirely rather than let it silently no-op. */
  onResume?: () => void
  /** No live camera track right now — passed through to StatusPill so the idle/paused copy explains why nothing's happening instead of a generic message. */
  cameraOff?: boolean
  /** How many accounts are currently online — passed through to StatusPill so anyone sitting in a waiting state (idle/searching/connecting/peer-left) can see it, not just a static "Finding someone…". `null`/`undefined` until the server's first count arrives. */
  onlineCount?: number | null
}

export function SwipeStage({
  matchState,
  peer,
  peerMicEnabled = true,
  friendState,
  onAddFriend,
  remoteStream,
  onSwipeComplete,
  locked = false,
  onPauseMatching,
  onResume,
  cameraOff = false,
  onlineCount = null,
}: SwipeStageProps) {
  const reduceMotion = useReducedMotion()
  const x = useMotionValue(0)
  const rotate = useTransform(x, [-400, 0], [-8, 0])
  const scale = useTransform(x, [-400, 0], [0.92, 1])
  const nextScale = useTransform(x, [-400, 0], [1, 0.94])
  const nextOpacity = useTransform(x, [-400, -40, 0], [1, 0.55, 0.4])

  const [isExiting, setIsExiting] = useState(false)
  const [stageWidth, setStageWidth] = useState(1200)
  const wheelAccum = useRef(0)
  const wheelResetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Matching is never auto-started (see MatchStage.tsx) — "idle" (never
  // started, or just refreshed) and "paused" (deliberately stopped) are
  // both "not currently searching" from the guest's own point of view, and
  // share the exact same swipe-to-start/resume gesture; there's no
  // separate "Start"/"Resume" button for either, the same gesture that
  // skips someone mid-call does double duty here too, demonstrated rather
  // than explained (see PausedNotice, which StatusPill now shows for both
  // states with the camera on).
  const isWaitingToStart = matchState === "idle" || matchState === "paused"
  const canSwipe = (matchState === "active" || (isWaitingToStart && Boolean(onResume))) && !isExiting && !locked

  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width) setStageWidth(width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (matchState !== "active") x.set(0)
  }, [matchState, x])

  function finishExit() {
    animate(x, -stageWidth * 1.15, {
      type: reduceMotion ? "tween" : "spring",
      stiffness: 280,
      damping: 32,
      duration: reduceMotion ? 0.12 : undefined,
      onComplete: () => {
        // Same gesture, two different meanings depending on what's on
        // screen: skip the person you're with, or start/resume looking for
        // one (whether this is the very first search or a resumed one —
        // findMatch() itself doesn't care, see lib/matchStateMachine.ts).
        if (isWaitingToStart) {
          onResume?.()
        } else {
          onSwipeComplete()
        }
        x.set(0)
        setIsExiting(false)
      },
    })
  }

  function springBack() {
    animate(x, 0, {
      type: reduceMotion ? "tween" : "spring",
      stiffness: 420,
      damping: 34,
      duration: reduceMotion ? 0.1 : undefined,
    })
  }

  function completeSwipe() {
    if (isExiting) return
    setIsExiting(true)
    finishExit()
  }

  function handleDragEnd(_event: unknown, info: { offset: { x: number }; velocity: { x: number } }) {
    if (!canSwipe) return
    const pastDistance = info.offset.x < -SWIPE_DISTANCE_THRESHOLD
    const pastVelocity = info.velocity.x < -SWIPE_VELOCITY_THRESHOLD
    if (pastDistance || pastVelocity) {
      completeSwipe()
    } else {
      springBack()
    }
  }

  function handleWheel(event: React.WheelEvent) {
    if (!canSwipe) return
    if (Math.abs(event.deltaX) < Math.abs(event.deltaY)) return

    wheelAccum.current += event.deltaX
    x.set(Math.max(-stageWidth, Math.min(0, x.get() - event.deltaX)))

    clearTimeout(wheelResetTimer.current)
    if (wheelAccum.current >= WHEEL_THRESHOLD) {
      wheelAccum.current = 0
      completeSwipe()
      return
    }
    wheelResetTimer.current = setTimeout(() => {
      wheelAccum.current = 0
      springBack()
    }, WHEEL_IDLE_RESET_MS)
  }

  // Left or right arrow both act as a keyboard-accessible equivalent of
  // swiping left — there's no dedicated skip button anymore, drag/swipe is
  // the only visible entry point, but the keyboard shortcut still stands in
  // for it.
  function handleKeyDown(event: React.KeyboardEvent) {
    if (!canSwipe) return
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault()
      completeSwipe()
    }
  }

  return (
    <div
      ref={containerRef}
      onKeyDown={handleKeyDown}
      className={`relative h-full w-full overflow-hidden rounded-2xl ${isWaitingToStart ? "bg-[#0b0b0d] md:rounded-none" : "bg-surface"}`}
    >
      {!isWaitingToStart && (
        <motion.div style={{ scale: nextScale, opacity: nextOpacity }} className="absolute inset-0 bg-surface-2" />
      )}

      <motion.div
        style={{ x, rotate, scale }}
        drag={canSwipe ? "x" : false}
        dragConstraints={{ left: -stageWidth, right: 0 }}
        dragElastic={{ left: 0.4, right: 0.08 }}
        dragSnapToOrigin={false}
        onDragEnd={handleDragEnd}
        onWheel={handleWheel}
        tabIndex={0}
        role="group"
        aria-label={
          peer
            ? `In a call with ${peer.username ?? peer.handle}. Press left arrow to meet someone new.`
            : matchState === "paused"
              ? onResume
                ? "Matching paused. Press left arrow to resume."
                : "Matching paused. Turn on your camera to resume."
              : matchState === "idle"
                ? onResume
                  ? "Press left arrow to start matching."
                  : "Turn on your camera to start matching."
                : "Waiting for a match"
        }
        className="absolute inset-0 origin-bottom cursor-grab touch-pan-y outline-none focus-visible:ring-2 focus-visible:ring-accent-2 active:cursor-grabbing"
      >
        <VideoTile stream={remoteStream} className={isWaitingToStart ? "bg-[#0b0b0d]" : "bg-surface-2"} />
        {!isWaitingToStart && (
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
        )}

        {/* The brand wordmark — on the OTHER person's tile, not your own
            (see SelfPanel.tsx, which used to carry this): whoever you're
            matched with is what's actually on screen here, so this is what
            reads as "this is Rizzuno" to the person looking at this tile,
            not a mark sitting over your own camera that only you ever see.
            Present in every state (searching, paused, an active call),
            same as before — top-right rather than top-left so it never
            collides with PersonBadge's peer-name badge, which owns the
            top-left corner once a call is active. Same two-tone accent/
            accent-2 gradient the rest of the brand mark uses, sized up
            slightly from its old self-tile size. */}
        {!isWaitingToStart && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-2 top-2 z-10 bg-gradient-to-r from-accent to-accent-2 bg-clip-text text-[15px] font-extrabold uppercase tracking-[0.12em] text-transparent drop-shadow-[0_1px_3px_rgba(0,0,0,0.75)]"
          >
            Rizzuno.com
          </span>
        )}

        <AnimatePresence mode="wait">
          {matchState === "active" && peer ? (
            <motion.div
              key={peer.displayId}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: DURATION_BASE, ease: EASE_OUT }}
              className="pointer-events-none absolute inset-0"
            >
              <PersonBadge peer={peer} friendState={friendState} onAddFriend={onAddFriend} />
            </motion.div>
          ) : (
            <motion.div
              key="status"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: DURATION_BASE, ease: EASE_OUT }}
              className="absolute inset-0 flex items-center justify-center"
            >
              {/* StatusPill is the one authoritative status display — it
                  decides on its own (from `state`/`cameraOff` alone) whether
                  that means the compact pill or the full paused-branded
                  screen; nothing here branches between two components for
                  the same state. */}
              <StatusPill
                state={matchState}
                cameraOff={cameraOff}
                onPauseMatching={onPauseMatching}
                onlineCount={onlineCount}
                onResume={onResume}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {matchState === "active" && peer && !peerMicEnabled && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: DURATION_BASE, ease: EASE_OUT }}
              className="pointer-events-none absolute bottom-20 right-4 md:bottom-5 md:right-5"
            >
              <MicOffIcon className="h-5 w-5 text-white/80 drop-shadow-[0_1px_4px_rgba(0,0,0,0.65)]" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
