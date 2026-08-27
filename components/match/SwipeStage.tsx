"use client"

import { useEffect, useRef, useState } from "react"
import { motion, useMotionValue, useTransform, animate, AnimatePresence, useReducedMotion } from "motion/react"
import { VideoTile } from "./VideoTile"
import { PersonBadge } from "./PersonBadge"
import { StatusPill } from "./StatusPill"
import { PausedNotice } from "./PausedNotice"
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

  // Paused counts as swipeable too — there's no "Resume" button anymore,
  // resuming just reuses the same swipe-left gesture as skipping someone,
  // demonstrated rather than explained.
  const canSwipe = (matchState === "active" || (matchState === "paused" && Boolean(onResume))) && !isExiting && !locked

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
        // screen: skip the person you're with, or resume looking for one.
        if (matchState === "paused") {
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
      className="relative h-full w-full overflow-hidden rounded-2xl bg-surface"
    >
      <motion.div style={{ scale: nextScale, opacity: nextOpacity }} className="absolute inset-0 bg-surface-2" />

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
              : "Waiting for a match"
        }
        className="absolute inset-0 origin-bottom cursor-grab touch-pan-y outline-none focus-visible:ring-2 focus-visible:ring-accent-2 active:cursor-grabbing"
      >
        <VideoTile stream={remoteStream} className="bg-surface-2" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />

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
              {matchState === "paused" && onResume ? (
                <PausedNotice onlineCount={onlineCount} />
              ) : (
                <StatusPill
                  state={matchState}
                  cameraOff={cameraOff}
                  onPauseMatching={onPauseMatching}
                  onlineCount={onlineCount}
                />
              )}
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
