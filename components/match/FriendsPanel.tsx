"use client"
import { PublicProfilePosts } from "./PublicProfilePosts"
import { ReportButton } from "./ReportButton"
import { ProfileActionsMenu } from "./ProfileActionsMenu"
import { subscriptionHref } from "@/lib/upgradeNavigation"
import panelStyles from "./SocialPanel.module.css"

import { useEffect, useState } from "react"
import { PostGallery } from "./PostGallery"
import type { MatchInvitation, ReportCategory } from "@/lib/signaling/protocol"
import { containsBlockedChatContent, CHAT_BLOCKED_MESSAGE } from "@/lib/textFilter"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "motion/react"
import { ChevronLeftIcon, CloseIcon, DotsIcon, MailIcon, SearchIcon, SendIcon, UsersIcon } from "@/components/icons"
import { TypingDots } from "./MatchChatPanel"
import { isSameDay, formatDayLabel, formatTime } from "@/lib/chatFormat"
import { EASE_OUT, DURATION_QUICK, DURATION_BASE } from "@/lib/motion"
import type { DemoFriend, PendingRequest } from "@/hooks/useFriends"
import type { FriendChatEntry } from "@/hooks/useMatchmaking"

/**
 * Combines a friendship's real, persisted history (fetched once per open —
 * see the effect below) with whatever's arrived/been sent live this
 * session (`live`, from useMatchmaking's `friendMessages` — see its own
 * doc comment for why that's cache, not the source of truth). Deduped by
 * id: once a "sending" optimistic entry is acknowledged, useMatchmaking
 * rewrites its id to the real server-assigned one (see its "friend-chat-
 * sent" handler) — the same id a later history fetch would return for that
 * same message — so `live` naturally wins on any overlap (a fresher status
 * than whatever a stale history fetch already had) without ever double-
 * rendering the same message twice.
 */
function mergeFriendMessages(history: FriendChatEntry[], live: FriendChatEntry[]): FriendChatEntry[] {
  const merged = new Map<string, FriendChatEntry>()
  for (const message of history) merged.set(message.id, message)
  for (const message of live) merged.set(message.id, message)
  return [...merged.values()].sort((a, b) => a.ts - b.ts)
}

// A real account found by username search — see app/api/friends/search.
// Deliberately just a username, not an id: search results never carry the
// target's real account id to the client (see lib/db.ts's
// searchUsersByUsername doc comment) — acting on one (add friend, block)
// goes through app/api/friends/request|block, addressed by this same
// username, which resolve it back to a real id server-side only.
// alreadyRequested/alreadyFriends are real database state (see
// searchUsersByUsername's own doc comment) — checked so the row's own
// button reflects reality after a refresh, not just this session's clicks.
type SearchResultPerson = { username: string; profilePhoto?: string | null; alreadyRequested: boolean; alreadyFriends: boolean }

// How long to wait after the last keystroke before actually querying —
// long enough that fast typing doesn't fire a request per character, short
// enough that results still feel like they're updating "while typing" per
// the search UX this replaces.
const SEARCH_DEBOUNCE_MS = 350

type FriendsPanelProps = {
  open: boolean
  onClose: () => void
  friends: DemoFriend[]
  requests: PendingRequest[]
  matchInvitations: MatchInvitation[]
  matchInviteError: string | null
  canInviteToMatch: boolean
  onInviteToMatch: (userId: string) => void
  onRespondToMatchInvitation: (id: string, accept: boolean) => void
  onAcceptRequest: (id: string) => void
  onDeclineRequest: (id: string) => void
  onRemoveFriend: (id: string) => void
  onBlockPerson: (id: string, displayName: string) => void
  onReportPerson: (userId: string, category: ReportCategory) => void
  /** Reported whenever unread message count changes, so the header's Friends icon can badge it. Now a real sum of each friend's server-computed `unreadCount` (see DemoFriend's own doc comment) — never a local counter. */
  onUnreadMessagesChange?: (count: number) => void
  /** This session's live friend-chat cache, keyed by friendshipId — see useMatchmaking's `friendMessages` doc comment. Merged with real fetched history (below) rather than trusted alone. */
  friendMessages: Map<string, FriendChatEntry[]>
  onSendFriendMessage: (friendshipId: string, text: string) => void
  onMarkFriendChatRead: (friendshipId: string) => void
  /** Which friendships the other side is currently typing in — see useMatchmaking's `peerFriendTyping` doc comment. */
  peerFriendTyping: Set<string>
  onNotifyFriendTyping: (friendshipId: string) => void
}

type View = "list" | "chat" | "requests"

export function FriendsPanel({
  open,
  onClose,
  friends,
  requests,
  matchInvitations,
  matchInviteError,
  canInviteToMatch,
  onInviteToMatch,
  onRespondToMatchInvitation,
  onAcceptRequest,
  onDeclineRequest,
  onRemoveFriend,
  onBlockPerson,
  onReportPerson,
  onUnreadMessagesChange,
  friendMessages,
  onSendFriendMessage,
  onMarkFriendChatRead,
  peerFriendTyping,
  onNotifyFriendTyping,
}: FriendsPanelProps) {
  // Real, persisted history per friendship — fetched fresh every time that
  // conversation opens (see the effect below), merged with the live cache
  // (`friendMessages`, from useMatchmaking) rather than trusted alone. This
  // is rendered state/cache too, same as `friendMessages` itself — Postgres
  // is still the actual source of truth.
  const [historyById, setHistoryById] = useState<Record<string, FriendChatEntry[]>>({})
  const [view, setView] = useState<View>("list")
  const incomingMatchInvitations = matchInvitations.filter((invite) => invite.direction === "incoming")
  const requestCount = requests.length + incomingMatchInvitations.length
  const [activeId, setActiveId] = useState<string | null>(null)
  const [viewingRequesterId, setViewingRequesterId] = useState<string | null>(null)
  const [viewingFriendId, setViewingFriendId] = useState<string | null>(null)
  // The friend's REAL profile (username/profilePhoto/bio/posts), fetched
  // through GET /api/friends/profile/[friendshipId] the moment their
  // profile screen opens — friends-snapshot (the `friends` prop) stays
  // deliberately lightweight (id/userId/username/online/since) and never
  // carries this itself; see that route's own doc comment for the
  // server-side friendship-ownership check backing this fetch.
  const [friendProfileStatus, setFriendProfileStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle")
  const [friendProfile, setFriendProfile] = useState<{
    username: string | null
    profilePhoto: string | null
    bio: string
    posts: { id: string; dataUrl: string }[]
  } | null>(null)
  // Unfriend/Block both need a second tap to confirm before they actually
  // happen — one for the full-screen profile, one for the row "•••" menu
  // (they're separate surfaces, so separate confirm state).
  const [friendActionConfirm, setFriendActionConfirm] = useState<"unfriend" | "block" | null>(null)
  const [rowMenuConfirm, setRowMenuConfirm] = useState<"unfriend" | "block" | null>(null)
  const [draft, setDraft] = useState("")
  const [chatBlocked, setChatBlocked] = useState(false)

  // Per-row "•••" menu on a friend in the list (View profile / Unfriend / Block).
  const [rowMenuFriendId, setRowMenuFriendId] = useState<string | null>(null)

  // Username search: debounced against the real account search backend
  // (see app/api/friends/search) — searchResults/searchLoading/searchErrored
  // together drive the panel's four search states (idle/loading/results/
  // no-results), plus who's been sent a request and which searched
  // person's full profile is currently open.
  const [searchActive, setSearchActive] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    if (query.get("panel") === "friends" && query.has("search")) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore search after returning from membership
      setSearchQuery(query.get("search") ?? "")
      setSearchActive(true)
    }
  }, [])
  const [searchResults, setSearchResults] = useState<SearchResultPerson[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchErrored, setSearchErrored] = useState(false)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [sentUsernames, setSentUsernames] = useState<string[]>([])
  const [viewingSearchResultUsername, setViewingSearchResultUsername] = useState<string | null>(null)
  const [searchResultBlockConfirm, setSearchResultBlockConfirm] = useState(false)

  // The requester's full-screen profile is portaled to <body> so it isn't
  // constrained by this panel's own width — only render the portal once
  // mounted client-side.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- bridging server/client environments (document doesn't exist on the server), not mirroring existing state
    setMounted(true)
  }, [])

  // Report unread messages up to the header badge whenever they change —
  // including the initial seed, so the badge shows up before the panel is
  // ever opened. Pending requests are counted separately by whoever owns
  // that shared state. Real, server-computed counts (see DemoFriend's own
  // doc comment) — never a client-local counter.
  const totalUnread = friends.reduce((sum, friend) => sum + friend.unreadCount, 0)
  useEffect(() => {
    onUnreadMessagesChange?.(totalUnread)
  }, [totalUnread, onUnreadMessagesChange])

  // Reset back to the list a beat after the panel closes, so it doesn't
  // flash the wrong view the next time it opens.
  useEffect(() => {
    if (open) return
    const timer = setTimeout(() => {
      setView("list")
      setActiveId(null)
      setViewingRequesterId(null)
      setViewingFriendId(null)
      setFriendActionConfirm(null)
      setRowMenuFriendId(null)
      setRowMenuConfirm(null)
      setSearchActive(false)
      setSearchQuery("")
      setSearchResults([])
      setSearchLoading(false)
      setSearchErrored(false)
      setViewingSearchResultUsername(null)
      setSearchResultBlockConfirm(false)
    }, 250)
    return () => clearTimeout(timer)
  }, [open])

  // Fetches the friend's real profile the moment their profile screen
  // opens — cancels/ignores a stale in-flight response the same way the
  // search debounce effect below does, so closing and reopening a
  // different friend's profile quickly can never have an earlier fetch
  // land after a newer one already did.
  useEffect(() => {
    if (!viewingFriendId) {
      // Reacting to an external condition (no friend profile is open) by
      // clearing what was fetched for the last one — not mirroring
      // existing React state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFriendProfileStatus("idle")
      setFriendProfile(null)
      return
    }
    let cancelled = false
    setFriendProfileStatus("loading")
    setFriendProfile(null)
    fetch(`/api/friends/profile/${encodeURIComponent(viewingFriendId)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`friend profile fetch failed: ${res.status}`)
        return res.json()
      })
      .then((data: { username: string | null; profilePhoto: string | null; bio: string; posts: { id: string; dataUrl: string }[] }) => {
        if (cancelled) return
        if (!data.username) {
          // Should be impossible — onboarding requires a username before
          // matching (and therefore friending) ever works. Logged, not
          // silently papered over with an invented name (see Part 5 of
          // this fix) — genuinely missing is still shown as itself below,
          // not as "Someone".
          console.warn("friends panel: a confirmed friend's profile came back with no username")
        }
        setFriendProfile(data)
        setFriendProfileStatus("loaded")
      })
      .catch(() => {
        if (cancelled) return
        setFriendProfileStatus("error")
      })
    return () => {
      cancelled = true
    }
  }, [viewingFriendId])

  // Debounced search: waits SEARCH_DEBOUNCE_MS after the last keystroke
  // before actually querying, and cancels/ignores anything still in flight
  // for a query that's no longer current — the effect cleanup (clearing the
  // timer, aborting the fetch) runs before every re-run and on unmount, so
  // a slow earlier response can never land after a newer one already did.
  useEffect(() => {
    if (!searchActive) return
    const trimmed = searchQuery.trim()
    if (!trimmed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing stale results for an emptied query, not mirroring existing state
      setSearchResults([])
      setSearchLoading(false)
      setSearchErrored(false)
      return
    }

    setSearchLoading(true)
    setSearchErrored(false)
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/friends/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(`search failed: ${res.status}`)
        const data: { results?: SearchResultPerson[] } = await res.json()
        setSearchResults(Array.isArray(data.results) ? data.results : [])
        setSearchLoading(false)
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return
        setSearchResults([])
        setSearchErrored(true)
        setSearchLoading(false)
      }
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [searchQuery, searchActive])

  const active = friends.find((friend) => friend.id === activeId) ?? null
  const activeLiveMessages = active ? (friendMessages.get(active.id) ?? []) : []
  const activeMessages = active ? mergeFriendMessages(historyById[active.id] ?? [], activeLiveMessages) : []

  // Real, persisted history — fetched fresh every time a conversation
  // opens (a different friendship, or reopening the same one), the same
  // pattern the friend-profile fetch above already uses. Failing to load
  // must never block live chat — the merge above just falls back to
  // whatever the live cache already has if this never resolves.
  useEffect(() => {
    if (!activeId) return
    let cancelled = false
    fetch(`/api/friends/messages/${encodeURIComponent(activeId)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`friend messages fetch failed: ${res.status}`)
        return res.json()
      })
      .then((data: { messages?: { id: string; text: string; createdAt: number; mine: boolean; readAt: number | null }[] }) => {
        if (cancelled) return
        const loaded: FriendChatEntry[] = (data.messages ?? []).map((m) => ({
          id: m.id,
          from: m.mine ? "me" : "peer",
          text: m.text,
          ts: m.createdAt,
          readAt: m.readAt,
        }))
        setHistoryById((prev) => ({ ...prev, [activeId]: loaded }))
      })
      .catch(() => {
        console.warn("friends panel: failed to load message history")
      })
    return () => {
      cancelled = true
    }
  }, [activeId])

  // Marks the open conversation's received messages read — on opening it,
  // and again for any later message that arrives while it's still open
  // (`activeLiveMessages` changing covers both: a fresh live push, or this
  // account's own send transitioning "sending" -> "sent", which is a
  // harmless redundant mark-read). The server responds with a fresh
  // friends-snapshot, which is what actually zeroes `unreadCount` — see
  // useMatchmaking's markFriendChatRead().
  useEffect(() => {
    if (view !== "chat" || !active) return
    onMarkFriendChatRead(active.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the active conversation's own live messages, not onMarkFriendChatRead's identity
  }, [view, active?.id, activeLiveMessages])

  function openChat(id: string) {
    setChatBlocked(false)
    setActiveId(id)
    setView("chat")
  }

  function sendMessage() {
    if (!active || !draft.trim()) return
    const text = draft.trim()
    if (containsBlockedChatContent(text)) {
      setChatBlocked(true)
      return
    }
    setChatBlocked(false)
    setDraft("")
    onSendFriendMessage(active.id, text)
  }

  function handleRemoveFriend(id: string) {
    onRemoveFriend(id)
    setView("list")
    setActiveId(null)
    setViewingFriendId(null)
    setFriendActionConfirm(null)
    setRowMenuConfirm(null)
  }

  // Stronger than unfriend — also keeps them out of search going forward.
  function handleBlockPerson(id: string, displayName: string) {
    onBlockPerson(id, displayName)
    setView("list")
    setActiveId(null)
    setViewingFriendId(null)
    setViewingSearchResultUsername(null)
    setFriendActionConfirm(null)
    setRowMenuConfirm(null)
  }

  // Search results never carry a real account id client-side (see
  // SearchResultPerson's own comment) — blocking one goes through
  // POST /api/friends/block instead of the onBlockPerson prop (which needs
  // a real id the way friends/requesters already have one), addressed by
  // username, resolved server-side only. Fire-and-forget, same as
  // onBlockPerson's own WS send above — the UI updates immediately rather
  // than waiting on the response.
  function handleBlockSearchResult(username: string) {
    fetch("/api/friends/block", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    }).catch(() => {})
    setView("list")
    setViewingSearchResultUsername(null)
    setSearchResultBlockConfirm(false)
    setSearchResults((prev) => prev.filter((person) => person.username !== username))
  }

  // Fire-and-forget, same as handleBlockSearchResult above — ReportButton
  // shows its own "sent" confirmation locally rather than waiting on this,
  // and (unlike block) reporting doesn't end the interaction, so the
  // profile stays open.
  function handleReportSearchResult(username: string, category: ReportCategory) {
    fetch("/api/friends/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, category }),
    }).catch(() => {})
  }

  function handleAcceptRequest(id: string) {
    onAcceptRequest(id)
    setViewingRequesterId(null)
  }

  function handleDeclineRequest(id: string) {
    onDeclineRequest(id)
    setViewingRequesterId(null)
  }

  const viewingRequester = requests.find((request) => request.id === viewingRequesterId) ?? null
  const viewingFriend = friends.find((friend) => friend.id === viewingFriendId) ?? null

  const trimmedQuery = searchQuery.trim()
  // searchResults already comes back case-insensitive/partial-matched and
  // blocked-account-filtered from app/api/friends/search (see the debounced
  // effect above) — nothing further to derive here. Stable while a result's
  // profile is open, since the search input (the only thing that could
  // change it) is unreachable behind that full-screen view.
  const viewingSearchResult = searchResults.find((person) => person.username === viewingSearchResultUsername) ?? null

  function openSearchProfile(username: string) {
    const friend = friends.find((person) => person.username.toLowerCase() === username.toLowerCase())
    setSearchResultBlockConfirm(false)
    if (friend) {
      setViewingSearchResultUsername(null)
      setFriendActionConfirm(null)
      setViewingFriendId(friend.id)
    } else {
      setViewingSearchResultUsername(username)
    }
  }

  // Optimistic — marks "Requested" immediately, the same instant feedback
  // the old local-only stub had — but rolls back if the real request
  // (POST /api/friends/request, resolved server-side from username to a
  // real id — see that route's own comment) actually failed, so a rate
  // limit or a since-deleted account doesn't silently claim success.
  function sendFriendRequest(username: string) {
    if (sentUsernames.includes(username)) return
    setRequestError(null)
    setSentUsernames((prev) => [...prev, username])
    fetch("/api/friends/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    })
      .then(async (res) => {
        const data = await res.json()
        if (res.status === 402) {
          window.location.assign(subscriptionHref("friends"))
          return
        }
        if (!res.ok || data.result === "blocked") {
          const messages: Record<string, string> = {
            not_authenticated: "Sign in again to send a friend request.",
            rate_limited: "Too many requests. Wait a minute and try again.",
            not_found: "This profile is no longer available.",
            blocked: "A friend request can’t be sent to this account.",
            account_unavailable: "Your account can’t send requests right now.",
          }
          throw new Error(messages[data.error ?? data.result] ?? "Couldn’t save the friend request. Please try again.")
        }
        if (data.result === "already_friends" || data.result === "auto_accepted") {
          setSearchResults((previous) => previous.map((person) => person.username === username ? { ...person, alreadyFriends: true } : person))
        }
      })
      .catch((error: Error) => {
        setSentUsernames((prev) => prev.filter((u) => u !== username))
        setRequestError(error.message || "Couldn’t send the friend request. Please try again.")
      })
  }

  return (
    <>
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            aria-label="Close friends"
            tabIndex={-1}
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DURATION_QUICK, ease: EASE_OUT }}
            className="fixed inset-0 z-40 cursor-default bg-black/45"
          />
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: DURATION_BASE, ease: EASE_OUT }}
            className={`${panelStyles.panel} fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-surface md:w-96`}
            data-upgrade-return={`/?panel=friends&search=${encodeURIComponent(searchQuery)}`}
          >
            {requestError && <p role="alert" className="px-5 py-3 text-xs text-danger">{requestError}</p>}
            {view === "list" && (
              <>
                <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-border px-5">
                  {searchActive ? (
                    <>
                      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2">
                        <SearchIcon className="h-4 w-4 shrink-0 text-muted" />
                        <input
                          autoFocus
                          value={searchQuery}
                          onChange={(event) => setSearchQuery(event.target.value)}
                          placeholder="Search by username"
                          className="min-h-7 min-w-0 flex-1 bg-transparent text-[15px] text-foreground placeholder:text-muted focus:outline-none"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSearchActive(false)
                          setSearchQuery("")
                        }}
                        className="shrink-0 text-[13px] font-medium text-muted transition hover:text-foreground"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="flex min-w-0 flex-1 items-center gap-1.5">
                        <h2 className="text-[15px] font-semibold text-foreground">Friends</h2>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button type="button" onClick={() => setSearchActive(true)} aria-label="Search people" className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-2 text-muted transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2">
                          <SearchIcon className="h-4 w-4" />
                        </button>
                        {(
                          <button
                            type="button"
                            onClick={() => setView("requests")}
                            aria-label={`${requestCount} requests`}
                            className="relative flex h-11 w-11 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
                          >
                            <MailIcon className="h-4 w-4" />
                            {requestCount > 0 && <span className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-accent-foreground">
                              {requestCount}
                            </span>}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={onClose}
                          aria-label="Close friends"
                          className="flex h-11 w-11 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
                        >
                          <CloseIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {matchInviteError && <p role="alert" className="px-5 py-3 text-[12px] text-danger">{matchInviteError}</p>}
                {!canInviteToMatch && <p className="px-5 pt-3 text-[12px] text-muted">Return home with video available to invite a friend.</p>}
                {searchActive && trimmedQuery && (
                  <div className="absolute inset-x-3 top-[68px] z-10 max-h-80 overflow-y-auto rounded-2xl border border-border bg-surface p-1.5 shadow-xl">
                    {searchLoading ? (
                      <p className="px-3 py-4 text-center text-[13px] text-muted">Searching…</p>
                    ) : searchErrored ? (
                      <p className="px-3 py-4 text-center text-[13px] text-muted">Couldn&apos;t search — try again</p>
                    ) : searchResults.length === 0 ? (
                      <p className="px-3 py-4 text-center text-[13px] text-muted">No one found</p>
                    ) : (
                      searchResults.map((person) => {
                        const requested = person.alreadyRequested || sentUsernames.includes(person.username)
                        return (
                          <div
                            key={person.username}
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              openSearchProfile(person.username)
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault()
                                openSearchProfile(person.username)
                              }
                            }}
                            aria-label={`View @${person.username}'s profile`}
                            className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 transition hover:bg-surface-2"
                          >
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-2 text-[13px] font-semibold text-accent-foreground">
                              {person.profilePhoto ? (
                                // eslint-disable-next-line @next/next/no-img-element -- moderated user profile photo
                                <img src={person.profilePhoto} alt="" className="h-full w-full rounded-full object-cover" />
                              ) : person.username.charAt(0).toUpperCase()}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-medium text-foreground">
                                @{person.username}
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                if (person.alreadyFriends) openSearchProfile(person.username)
                                else sendFriendRequest(person.username)
                              }}
                              disabled={requested && !person.alreadyFriends}
                              className="shrink-0 h-8 rounded-lg bg-accent px-2.5 text-[12px] font-medium text-accent-foreground transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 disabled:opacity-50"
                            >
                              {person.alreadyFriends ? "View profile" : requested ? "Requested" : "Add"}
                            </button>
                          </div>
                        )
                      })
                    )}
                  </div>
                )}

                {searchActive && trimmedQuery ? null : friends.length === 0 ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-2">
                      <UsersIcon className="h-6 w-6 text-muted" />
                    </div>
                    <p className="text-[14px] font-medium text-foreground">No friends yet</p>
                    <button type="button" onClick={() => setSearchActive(true)} className="mt-2 flex h-11 items-center justify-center gap-2 rounded-xl bg-foreground px-5 text-[14px] font-semibold text-background transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"><SearchIcon className="h-4 w-4" />Find people</button>
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto py-2">
                    {friends.map((friend) => (
                      <div
                        key={friend.id}
                        className="relative mx-3 flex w-[calc(100%-1.5rem)] items-center gap-3 rounded-2xl px-3 py-3 transition hover:bg-surface-2"
                      >
                        <button
                          type="button"
                          onClick={() => openChat(friend.id)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <span className="relative shrink-0">
                            {friend.profilePhoto ? (
                              // eslint-disable-next-line @next/next/no-img-element -- local/data-URL profile photo, not a static asset
                              <img
                                src={friend.profilePhoto}
                                alt=""
                                className="h-9 w-9 rounded-full object-cover"
                              />
                            ) : (
                              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-2 text-[12px] font-semibold text-accent-foreground">
                                {friend.displayName.charAt(0)}
                              </span>
                            )}
                            <span
                              className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface ${
                                friend.online ? "bg-online" : "bg-muted"
                              }`}
                            />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-medium text-foreground">
                              {friend.displayName}
                            </span>
                          </span>
                        </button>
                        {friend.online && (
                          <button type="button" onClick={() => onInviteToMatch(friend.userId)} disabled={!canInviteToMatch || matchInvitations.some((invite) => invite.direction === "outgoing")}
                            className="h-11 shrink-0 rounded-xl border border-border px-3 text-[12px] font-medium text-foreground transition hover:bg-surface-2 disabled:opacity-40">
                            {matchInvitations.some((invite) => invite.userId === friend.userId && invite.direction === "outgoing") ? "Invited" : "Match"}
                          </button>
                        )}
                        {friend.unreadCount > 0 && (
                          <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-foreground">
                            {friend.unreadCount}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setRowMenuConfirm(null)
                            setRowMenuFriendId((prev) => (prev === friend.id ? null : friend.id))
                          }}
                          aria-label={`More options for ${friend.displayName}`}
                          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 ${
                            rowMenuFriendId === friend.id ? "bg-white/10 text-foreground" : ""
                          }`}
                        >
                          <DotsIcon className="h-4 w-4" />
                        </button>

                        <AnimatePresence>
                          {rowMenuFriendId === friend.id && (
                            <motion.div
                              initial={{ opacity: 0, y: -6, scale: 0.97 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, y: -6, scale: 0.97 }}
                              transition={{ duration: DURATION_QUICK, ease: EASE_OUT }}
                              className="absolute right-4 top-12 z-10 w-52 overflow-hidden rounded-2xl border border-border bg-surface p-1.5 shadow-xl"
                            >
                              {rowMenuConfirm ? (
                                <div className="px-2 py-1.5">
                                  <p className="mb-2 px-1 text-[12px] leading-snug text-muted">
                                    {rowMenuConfirm === "unfriend"
                                      ? `Unfriend ${friend.displayName}?`
                                      : `Block ${friend.displayName}? They won't be able to contact you.`}
                                  </p>
                                  <div className="flex gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => setRowMenuConfirm(null)}
                                      className="min-h-11 flex-1 rounded-xl border border-border py-2 text-[12px] font-medium text-muted transition hover:bg-surface-2 hover:text-foreground"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (rowMenuConfirm === "block") {
                                          handleBlockPerson(friend.userId, friend.displayName)
                                        } else {
                                          handleRemoveFriend(friend.id)
                                        }
                                        setRowMenuFriendId(null)
                                      }}
                                      className="min-h-11 flex-1 rounded-xl bg-danger py-2 text-[12px] font-medium text-accent-foreground transition hover:brightness-110"
                                    >
                                      {rowMenuConfirm === "unfriend" ? "Unfriend" : "Block"}
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setFriendActionConfirm(null)
                                      setViewingFriendId(friend.id)
                                      setRowMenuFriendId(null)
                                    }}
                                    className="w-full rounded-xl px-3 py-2.5 text-left text-[13px] text-foreground hover:bg-surface-2"
                                  >
                                    View profile
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setRowMenuConfirm("unfriend")}
                                    className="w-full rounded-xl px-3 py-2.5 text-left text-[13px] text-foreground hover:bg-surface-2"
                                  >
                                    Unfriend
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setRowMenuConfirm("block")}
                                    className="w-full rounded-xl px-3 py-2.5 text-left text-[13px] text-danger hover:bg-surface-2"
                                  >
                                    Block
                                  </button>
                                  <ReportButton
                                    onReport={(category) => onReportPerson(friend.userId, category)}
                                    onSubmitted={() => setTimeout(() => setRowMenuFriendId(null), 1100)}
                                    triggerClassName="w-full rounded-xl px-3 py-2.5 text-left text-[13px] text-danger hover:bg-surface-2"
                                  />
                                </>
                              )}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {view === "chat" && active && (
              <>
                <div className="flex h-16 shrink-0 items-center gap-1 border-b border-border px-3">
                  <button
                    type="button"
                    onClick={() => setView("list")}
                    aria-label="Back to friends"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
                  >
                    <ChevronLeftIcon className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFriendActionConfirm(null)
                      setViewingFriendId(active.id)
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-1.5 py-1.5 text-left transition hover:bg-surface-2"
                  >
                    {active.profilePhoto ? (
                      // eslint-disable-next-line @next/next/no-img-element -- local/data-URL profile photo, not a static asset
                      <img src={active.profilePhoto} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-2 text-[11px] font-semibold text-accent-foreground">
                        {active.displayName.charAt(0)}
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-medium text-foreground">
                        {active.displayName}
                      </span>
                      <span className="block text-[11px] text-muted">{active.online ? "Online" : "Offline"}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close friends"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
                  >
                    <CloseIcon className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex-1 space-y-1 overflow-y-auto px-4 py-3">
                  {activeMessages.map((message, index) => {
                    const previous = activeMessages[index - 1]
                    const showDayLabel = !previous || !isSameDay(new Date(previous.ts), new Date(message.ts))
                    const isMine = message.from === "me"
                    const isLastMine = isMine && !activeMessages.slice(index + 1).some((m) => m.from === "me")
                    return (
                      <div key={message.id}>
                        {showDayLabel && (
                          <div className="my-2 flex justify-center">
                            <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-muted">
                              {formatDayLabel(message.ts)}
                            </span>
                          </div>
                        )}
                        <div className={`max-w-[80%] ${isMine ? "ml-auto" : ""}`}>
                          <div
                            className={`rounded-2xl px-3.5 py-2 text-[13px] leading-snug ${
                              isMine ? "bg-accent text-accent-foreground" : "bg-surface-2 text-foreground"
                            }`}
                          >
                            {message.text}
                          </div>
                          <div className={`mt-1 flex items-center gap-1 px-1 text-[10px] text-muted ${isMine ? "justify-end" : ""}`}>
                            <span>
                              {isMine && message.status === "sending"
                                ? "Sending…"
                                : isMine && message.status === "failed"
                                  ? "Not delivered"
                                  : formatTime(message.ts)}
                            </span>
                            {/* "Read" only ever replaces the timestamp on this
                                account's own most recent delivered message —
                                mirroring how the other side's read-state is
                                shown up to their latest read message, not
                                individually per bubble. */}
                            {isMine && isLastMine && message.status !== "sending" && message.status !== "failed" && message.readAt && (
                              <span>· Read</span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  {active && peerFriendTyping.has(active.id) && <TypingDots />}
                </div>

                {chatBlocked && <p role="alert" className="px-3 py-2 text-[12px] text-danger">{CHAT_BLOCKED_MESSAGE}</p>}
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    sendMessage()
                  }}
                  className="flex items-center gap-1.5 border-t border-border p-3"
                >
                  <input
                    value={draft}
                    onChange={(event) => {
                      setDraft(event.target.value)
                      setChatBlocked(false)
                      if (event.target.value) onNotifyFriendTyping(active.id)
                    }}
                    placeholder="Message"
                    maxLength={500}
                    className="min-w-0 flex-1 rounded-xl border border-border bg-surface-2 px-3.5 py-2 text-[13px] text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
                  />
                  <button
                    type="submit"
                    disabled={!draft.trim()}
                    aria-label="Send message"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 disabled:opacity-40"
                  >
                    <SendIcon className="h-3.5 w-3.5" />
                  </button>
                </form>
              </>
            )}

            {view === "requests" && (
              <>
                <div className="flex h-16 shrink-0 items-center justify-between border-b border-border px-3">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setView("list")}
                      aria-label="Back to friends"
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
                    >
                      <ChevronLeftIcon className="h-4 w-4" />
                    </button>
                    <h2 className="text-[15px] font-semibold text-foreground">Requests</h2>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close friends"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
                  >
                    <CloseIcon className="h-4 w-4" />
                  </button>
                </div>

                {matchInviteError && <p role="alert" className="px-5 py-3 text-[12px] text-danger">{matchInviteError}</p>}
                {incomingMatchInvitations.length > 0 && (
                  <div className="max-h-[50%] shrink-0 overflow-y-auto px-3 pt-3">
                    <h3 className="px-1 pb-2 text-[12px] font-medium text-muted">Match invitations · expire after 1 minute</h3>
                    {incomingMatchInvitations.map((invite) => (
                      <div key={invite.id} className="mb-3 rounded-2xl border border-border p-4">
                        <p className="truncate text-[14px] font-semibold text-foreground">@{invite.username}</p>
                        <p className="mt-1 text-[12px] text-muted">Wants to match with you</p>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <button type="button" onClick={() => onRespondToMatchInvitation(invite.id, false)} className="h-11 rounded-xl border border-border text-[13px] text-muted hover:bg-surface-2">Decline</button>
                          <button type="button" disabled={!canInviteToMatch} onClick={() => onRespondToMatchInvitation(invite.id, true)} className="h-11 rounded-xl bg-foreground text-[13px] font-semibold text-background disabled:opacity-40">Accept & match</button>
                        </div>
                        {!canInviteToMatch && <p className="mt-2 text-[12px] text-muted">Return home with video available to accept.</p>}
                      </div>
                    ))}
                  </div>
                )}
                {requests.length === 0 ? (incomingMatchInvitations.length > 0 ? null : (
                  <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-2">
                      <MailIcon className="h-6 w-6 text-muted" />
                    </div>
                    <p className="text-[14px] font-medium text-foreground">No pending requests</p>
                  </div>
                )) : (
                  <div className="flex-1 overflow-y-auto py-2">
                    {requests.map((request) => (
                      <div
                        key={request.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setViewingRequesterId(request.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault()
                            setViewingRequesterId(request.id)
                          }
                        }}
                        aria-label={`View ${request.displayName}'s profile`}
                        className="mx-3 mb-3 grid cursor-pointer grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-3 rounded-2xl border border-border p-4 transition hover:bg-surface-2"
                      >
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-2 text-[14px] font-semibold text-accent-foreground">
                          {request.displayName.charAt(0)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-medium text-foreground">
                            {request.displayName}
                          </span>
                        </span>
                        <div
                          className="col-span-2 grid grid-cols-2 gap-2"
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => event.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => handleDeclineRequest(request.id)}
                            className="min-h-11 rounded-xl border border-border px-3 py-2 text-[13px] font-medium text-muted transition hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
                          >
                            Decline
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAcceptRequest(request.id)}
                            className="min-h-11 rounded-xl bg-accent px-3 py-2 text-[13px] font-medium text-accent-foreground transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
                          >
                            Accept
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

          </motion.div>
        </>
      )}
    </AnimatePresence>

    {mounted &&
      createPortal(
        <>
        <AnimatePresence>
          {viewingRequester && (
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={`${viewingRequester.displayName}'s profile`}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              transition={{ type: "tween", duration: DURATION_BASE, ease: EASE_OUT }}
              className={`${panelStyles.panel} fixed inset-0 z-[60] flex flex-col bg-surface`}
            >
              <div className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-4">
                <span className="flex-1 text-[15px] font-semibold text-foreground">Profile</span>
                <button
                  type="button"
                  onClick={() => setViewingRequesterId(null)}
                  aria-label="Close"
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </div>

              <div className="flex flex-1 flex-col items-center overflow-y-auto px-6 py-10 text-center">
                <span className="flex h-24 w-24 items-center justify-center rounded-full bg-accent-2 text-[32px] font-semibold text-accent-foreground">
                  {viewingRequester.displayName.charAt(0)}
                </span>
                <div className="mt-4 flex items-center gap-1">
                  <p className="text-[18px] font-semibold text-foreground">{viewingRequester.displayName}</p>
                  <ProfileActionsMenu ariaLabel={`More options for ${viewingRequester.displayName}`} align="center" compact>
                    {(closeMenu) => (
                      <ReportButton
                        onReport={(category) => onReportPerson(viewingRequester.senderId, category)}
                        onSubmitted={() => setTimeout(closeMenu, 1100)}
                        triggerClassName="w-full rounded-xl px-3 py-2.5 text-left text-[13px] text-danger hover:bg-surface-2"
                      />
                    )}
                  </ProfileActionsMenu>
                </div>
                <p className="mt-2 text-[12px] text-muted">Wants to be friends</p>

                <div className="mt-6 flex w-full max-w-xs gap-2">
                  <button
                    type="button"
                    onClick={() => handleDeclineRequest(viewingRequester.id)}
                    className="flex-1 rounded-lg border border-border px-4 py-2.5 text-[13px] font-medium text-muted transition hover:bg-surface-2 hover:text-foreground"
                  >
                    Decline
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAcceptRequest(viewingRequester.id)}
                    className="flex-1 rounded-lg bg-accent px-4 py-2.5 text-[13px] font-medium text-accent-foreground transition hover:brightness-110"
                  >
                    Accept
                  </button>
                </div>

                <div className="mt-8 w-full max-w-lg border-t border-border pt-8">
                  <PublicProfilePosts key={viewingRequester.username} username={viewingRequester.username} />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {viewingFriend && (() => {
            // Prefer the freshly fetched real profile the moment it's in —
            // falls back to the lightweight snapshot's own displayName only
            // for the (non-visible-name) aria-label/confirm-copy while that
            // fetch is still loading, never as a permanent substitute.
            const friendName = friendProfile?.username ?? viewingFriend.displayName
            const loading = friendProfileStatus === "loading" || friendProfileStatus === "idle"
            return (
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={`${friendName}'s profile`}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              transition={{ type: "tween", duration: DURATION_BASE, ease: EASE_OUT }}
              className={`${panelStyles.panel} fixed inset-0 z-[60] flex flex-col bg-surface`}
            >
              <div className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-4">
                <span className="flex-1 text-[15px] font-semibold text-foreground">Profile</span>
                <button
                  type="button"
                  onClick={() => setViewingFriendId(null)}
                  aria-label="Close"
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </div>

              <div className="flex flex-1 flex-col items-center px-6 py-10 text-center">
                {loading ? (
                  <>
                    <span className="h-24 w-24 shrink-0 animate-pulse rounded-full bg-surface-2" aria-hidden="true" />
                    <span className="mt-4 h-5 w-32 animate-pulse rounded bg-surface-2" aria-hidden="true" />
                  </>
                ) : (
                  <>
                    <span className="relative flex h-24 w-24 shrink-0">
                      {friendProfile?.profilePhoto ? (
                        // eslint-disable-next-line @next/next/no-img-element -- data-URL profile photo, not a static asset
                        <img
                          src={friendProfile.profilePhoto}
                          alt=""
                          className="h-24 w-24 rounded-full object-cover"
                        />
                      ) : (
                        <span className="flex h-24 w-24 items-center justify-center rounded-full bg-accent-2 text-[32px] font-semibold text-accent-foreground">
                          {friendName.charAt(0).toUpperCase()}
                        </span>
                      )}
                      {/* Presence dot, not a text label — shown only when
                          actually online, the same convention Instagram/etc.
                          use on a profile photo (silence means not online,
                          rather than a separate "Offline" state to announce). */}
                      {viewingFriend.online && (
                        <span className="absolute bottom-0.5 left-0.5 h-4 w-4 rounded-full border-2 border-surface bg-online" />
                      )}
                    </span>
                    <div className="mt-4 flex items-center gap-1">
                      <p className="text-[18px] font-semibold text-foreground">
                        {friendProfile?.username ? `@${friendProfile.username}` : friendName}
                      </p>
                      <ProfileActionsMenu ariaLabel={`More options for ${friendName}`} align="center" compact onClose={() => setFriendActionConfirm(null)}>
                        {(closeMenu) =>
                          friendActionConfirm ? (
                            <div className="px-2 py-1.5">
                              <p className="mb-2 px-1 text-[12px] leading-snug text-muted">
                                {friendActionConfirm === "unfriend"
                                  ? `Unfriend ${friendName}?`
                                  : `Block ${friendName}? They won't be able to contact you.`}
                              </p>
                              <div className="flex gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setFriendActionConfirm(null)}
                                  className="flex-1 rounded-lg border border-border py-1.5 text-[12px] font-medium text-muted transition hover:bg-surface-2 hover:text-foreground"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    friendActionConfirm === "block"
                                      ? handleBlockPerson(viewingFriend.userId, friendName)
                                      : handleRemoveFriend(viewingFriend.id)
                                  }
                                  className="flex-1 rounded-lg bg-danger py-1.5 text-[12px] font-medium text-accent-foreground transition hover:brightness-110"
                                >
                                  {friendActionConfirm === "unfriend" ? "Unfriend" : "Block"}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col">
                              <button
                                type="button"
                                onClick={() => setFriendActionConfirm("unfriend")}
                                className="w-full rounded-xl px-3 py-2.5 text-left text-[13px] text-foreground hover:bg-surface-2"
                              >
                                Unfriend
                              </button>
                              <button
                                type="button"
                                onClick={() => setFriendActionConfirm("block")}
                                className="w-full rounded-xl px-3 py-2.5 text-left text-[13px] text-danger hover:bg-surface-2"
                              >
                                Block
                              </button>
                              <ReportButton
                                onReport={(category) => onReportPerson(viewingFriend.userId, category)}
                                onSubmitted={() => setTimeout(closeMenu, 1100)}
                                triggerClassName="w-full rounded-xl px-3 py-2.5 text-left text-[13px] text-danger hover:bg-surface-2"
                              />
                            </div>
                          )
                        }
                      </ProfileActionsMenu>
                    </div>
                    {friendProfile?.bio && (
                      <p className="mt-1.5 max-w-xs text-[13px] leading-relaxed text-muted">{friendProfile.bio}</p>
                    )}
                    {friendProfileStatus === "error" && (
                      <p className="mt-1.5 text-[12px] text-danger">Couldn&apos;t load this profile — try again.</p>
                    )}
                  </>
                )}

                <div className="mt-8 w-full max-w-lg border-t border-border pt-8">
                  {loading ? (
                    <div className="grid grid-cols-3 gap-3">
                      {[0, 1, 2].map((i) => (
                        <span key={i} className="aspect-square animate-pulse rounded-xl bg-surface-2" aria-hidden="true" />
                      ))}
                    </div>
                  ) : friendProfile && friendProfile.posts.length > 0 ? (
                    <PostGallery key={viewingFriend.id} posts={friendProfile.posts} owner={friendProfile.username ? `@${friendProfile.username}` : friendName} />
                  ) : (
                    <div className="flex items-center justify-center py-10 text-[13px] text-muted">No posts yet</div>
                  )}
                </div>
              </div>
            </motion.div>
            )
          })()}
        </AnimatePresence>

        <AnimatePresence>
          {viewingSearchResult && (
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={`@${viewingSearchResult.username}'s profile`}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              transition={{ type: "tween", duration: DURATION_BASE, ease: EASE_OUT }}
              className={`${panelStyles.panel} fixed inset-0 z-[60] flex flex-col bg-surface`}
            >
              <div className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-4">
                <span className="flex-1 text-[15px] font-semibold text-foreground">Profile</span>
                <button
                  type="button"
                  onClick={() => setViewingSearchResultUsername(null)}
                  aria-label="Close"
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </div>

              <div className="flex flex-1 flex-col items-center overflow-y-auto px-6 py-10 text-center">
                <span className="flex h-24 w-24 items-center justify-center rounded-full bg-accent-2 text-[32px] font-semibold text-accent-foreground">
                  {viewingSearchResult.profilePhoto ? (
                    // eslint-disable-next-line @next/next/no-img-element -- moderated user profile photo
                    <img src={viewingSearchResult.profilePhoto} alt="" className="h-full w-full rounded-full object-cover" />
                  ) : viewingSearchResult.username.charAt(0).toUpperCase()}
                </span>
                <div className="mt-4 flex items-center gap-1">
                  <p className="text-[18px] font-semibold text-foreground">@{viewingSearchResult.username}</p>
                  <ProfileActionsMenu ariaLabel={`More options for @${viewingSearchResult.username}`} align="center" compact onClose={() => setSearchResultBlockConfirm(false)}>
                    {(closeMenu) =>
                      searchResultBlockConfirm ? (
                        <div className="px-2 py-1.5">
                          <p className="mb-2 px-1 text-[12px] leading-snug text-muted">
                            Block @{viewingSearchResult.username}? They won&apos;t be able to contact you, and won&apos;t
                            show up in search.
                          </p>
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => setSearchResultBlockConfirm(false)}
                              className="flex-1 rounded-lg border border-border py-1.5 text-[12px] font-medium text-muted transition hover:bg-surface-2 hover:text-foreground"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => handleBlockSearchResult(viewingSearchResult.username)}
                              className="flex-1 rounded-lg bg-danger py-1.5 text-[12px] font-medium text-accent-foreground transition hover:brightness-110"
                            >
                              Block
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col">
                          <button
                            type="button"
                            onClick={() => setSearchResultBlockConfirm(true)}
                            className="w-full rounded-xl px-3 py-2.5 text-left text-[13px] text-danger hover:bg-surface-2"
                          >
                            Block
                          </button>
                          <ReportButton
                            onReport={(category) => handleReportSearchResult(viewingSearchResult.username, category)}
                            onSubmitted={() => setTimeout(closeMenu, 1100)}
                            triggerClassName="w-full rounded-xl px-3 py-2.5 text-left text-[13px] text-danger hover:bg-surface-2"
                          />
                        </div>
                      )
                    }
                  </ProfileActionsMenu>
                </div>

                <div className="mt-6 w-full max-w-xs">
                  <button
                    type="button"
                    onClick={() => viewingSearchResult.alreadyFriends ? openSearchProfile(viewingSearchResult.username) : sendFriendRequest(viewingSearchResult.username)}
                    disabled={
                      viewingSearchResult.alreadyFriends
                        ? !friends.some((friend) => friend.username === viewingSearchResult.username)
                        : viewingSearchResult.alreadyRequested || sentUsernames.includes(viewingSearchResult.username)
                    }
                    className="h-11 w-full rounded-xl bg-foreground px-4 text-[14px] font-semibold text-background transition hover:opacity-90 disabled:opacity-50"
                  >
                    {viewingSearchResult.alreadyFriends
                      ? "View profile"
                      : viewingSearchResult.alreadyRequested || sentUsernames.includes(viewingSearchResult.username)
                        ? "Requested"
                        : "Add friend"}
                  </button>
                </div>

                <div className="mt-8 w-full max-w-lg border-t border-border pt-8">
                  <PublicProfilePosts key={viewingSearchResult.username} username={viewingSearchResult.username} />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        </>,
        document.body
      )}
    </>
  )
}
