"use client"
import { UserAvatar } from "@/components/UserAvatar"
import { useUserProfile } from "@/components/profile/UserProfileProvider"
import { ReportDialog } from "@/components/report/ReportDialog"
import panelStyles from "./SocialPanel.module.css"

import { useEffect, useRef, useState } from "react"
import type { MatchInvitation, ReportCategory } from "@/lib/signaling/protocol"
import { containsBlockedChatContent, CHAT_BLOCKED_MESSAGE } from "@/lib/textFilter"
import { CHAT_SEND_MIN_INTERVAL_MS, CHAT_SEND_TOO_FAST_MESSAGE } from "@/lib/chatRateLimit"
import { AnimatePresence, motion } from "motion/react"
import { ChevronLeftIcon, CloseIcon, DotsIcon, MailIcon, ReplyIcon, SearchIcon, SendIcon, UsersIcon } from "@/components/icons"
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
  onReportPerson: (userId: string, category: ReportCategory, details?: string) => void
  /** Reported whenever unread message count changes, so the header's Friends icon can badge it. Now a real sum of each friend's server-computed `unreadCount` (see DemoFriend's own doc comment) — never a local counter. */
  onUnreadMessagesChange?: (count: number) => void
  /** This session's live friend-chat cache, keyed by friendshipId — see useMatchmaking's `friendMessages` doc comment. Merged with real fetched history (below) rather than trusted alone. */
  friendMessages: Map<string, FriendChatEntry[]>
  onSendFriendMessage: (friendshipId: string, text: string, replyToId?: string | null) => void
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
  // Remove friend/Block in the row "•••" menu need a second tap to confirm.
  const [rowMenuConfirm, setRowMenuConfirm] = useState<"unfriend" | "block" | null>(null)
  const [draft, setDraft] = useState("")
  // Holds whichever reason the draft is currently blocked for — content
  // filtering (CHAT_BLOCKED_MESSAGE) or sending too fast
  // (CHAT_SEND_TOO_FAST_MESSAGE) — null when there's nothing to show.
  const [chatSendError, setChatSendError] = useState<string | null>(null)
  // When the active conversation last actually sent a message — keyed per
  // friendship (a Map, not a single ref) so switching conversations never
  // lets one friend's throttle affect another's. Purely a client-side
  // pace limiter against rapid-tapping Send; see lib/chatRateLimit.ts's
  // own doc comment for why this isn't a security boundary.
  const lastFriendChatSentAtRef = useRef<Map<string, number>>(new Map())
  // Which message (if any) the draft is currently replying to — cleared on
  // send, on switching conversations, and on the panel closing, the same
  // way `draft` itself already resets for each of those.
  const [replyingTo, setReplyingTo] = useState<FriendChatEntry | null>(null)

  // Per-row "•••" menu on a friend in the list (View profile / Remove friend / Block).
  const [rowMenuFriendId, setRowMenuFriendId] = useState<string | null>(null)
  // The shared Report dialog, held outside the row menu so it survives that menu closing.
  const [reportingFriend, setReportingFriend] = useState<{ userId: string; username: string } | null>(null)
  // Each row's own wrapping element, keyed by friend.id — populated by the
  // row's own ref callback below, purely so the outside-click effect can
  // tell "inside the currently-open row" (its trigger + dropdown) apart
  // from everywhere else, without needing one ref per friend declared up
  // front (the friends list itself is dynamic).
  const rowMenuRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // Clicking anywhere outside the open row menu (its trigger or dropdown)
  // closes it — the same as clicking the trigger again would. A click
  // elsewhere (another row, the chat, the background) should never leave
  // this open underneath whatever was actually clicked.
  useEffect(() => {
    if (!rowMenuFriendId) return
    function handlePointerDown(event: PointerEvent) {
      const container = rowMenuRefs.current.get(rowMenuFriendId!)
      if (container && !container.contains(event.target as Node)) {
        setRowMenuFriendId(null)
        setRowMenuConfirm(null)
      }
    }
    document.addEventListener("pointerdown", handlePointerDown)
    return () => document.removeEventListener("pointerdown", handlePointerDown)
  }, [rowMenuFriendId])

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
      setRowMenuFriendId(null)
      setRowMenuConfirm(null)
      setSearchActive(false)
      setSearchQuery("")
      setSearchResults([])
      setSearchLoading(false)
      setSearchErrored(false)
      setReplyingTo(null)
    }, 250)
    return () => clearTimeout(timer)
  }, [open])

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
      .then((data: { messages?: { id: string; text: string; createdAt: number; mine: boolean; readAt: number | null; replyToId: string | null }[] }) => {
        if (cancelled) return
        const loaded: FriendChatEntry[] = (data.messages ?? []).map((m) => ({
          id: m.id,
          from: m.mine ? "me" : "peer",
          text: m.text,
          ts: m.createdAt,
          readAt: m.readAt,
          replyToId: m.replyToId,
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
    setChatSendError(null)
    setReplyingTo(null)
    setActiveId(id)
    setView("chat")
  }

  function sendMessage() {
    if (!active || !draft.trim()) return
    const text = draft.trim()
    if (containsBlockedChatContent(text)) {
      setChatSendError(CHAT_BLOCKED_MESSAGE)
      return
    }
    const now = Date.now()
    const lastSentAt = lastFriendChatSentAtRef.current.get(active.id) ?? 0
    if (now - lastSentAt < CHAT_SEND_MIN_INTERVAL_MS) {
      setChatSendError(CHAT_SEND_TOO_FAST_MESSAGE)
      return
    }
    lastFriendChatSentAtRef.current.set(active.id, now)
    setChatSendError(null)
    setDraft("")
    onSendFriendMessage(active.id, text, replyingTo?.id ?? null)
    setReplyingTo(null)
  }

  function handleRemoveFriend(id: string) {
    onRemoveFriend(id)
    setView("list")
    setActiveId(null)
    setRowMenuConfirm(null)
  }

  // Stronger than unfriend — also keeps them out of search going forward.
  function handleBlockPerson(id: string, displayName: string) {
    onBlockPerson(id, displayName)
    setView("list")
    setActiveId(null)
    setRowMenuConfirm(null)
  }

  // Every "view profile" here opens the one shared profile (see
  // components/profile/UserProfileProvider) — only the identity differs.
  const { openUserProfile, sendFriendRequestByUsername, isRequestPending, requestError } = useUserProfile()
  function openFriendProfile(friend: DemoFriend) {
    openUserProfile({ source: "friend", username: friend.username || null, displayName: friend.displayName, photo: friend.profilePhoto, userId: friend.userId })
  }
  function openRequestProfile(request: PendingRequest) {
    openUserProfile({ source: "request", username: request.username || null, displayName: request.displayName, photo: request.profilePhoto, userId: request.senderId })
  }
  function openSearchProfile(person: SearchResultPerson) {
    openUserProfile({
      source: "search",
      username: person.username,
      displayName: person.username,
      photo: person.profilePhoto,
      hint: { alreadyRequested: person.alreadyRequested, alreadyFriends: person.alreadyFriends },
      // Blocking from the profile also drops them from these results.
      onBlocked: () => setSearchResults((prev) => prev.filter((p) => p.username !== person.username)),
    })
  }

  // Optimistic "Requested" with rollback on failure — shared with the
  // profile's own Add friend (see UserProfileProvider).
  function sendFriendRequest(username: string) {
    void sendFriendRequestByUsername(username).then((outcome) => {
      if (outcome === "already_friends" || outcome === "auto_accepted") {
        setSearchResults((previous) => previous.map((person) => person.username === username ? { ...person, alreadyFriends: true } : person))
      }
    })
  }

  const trimmedQuery = searchQuery.trim()

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
                        const requested = person.alreadyRequested || isRequestPending(person.username)
                        return (
                          <div
                            key={person.username}
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              openSearchProfile(person)
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault()
                                openSearchProfile(person)
                              }
                            }}
                            aria-label={`View ${person.username}'s profile`}
                            className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 transition hover:bg-surface-2"
                          >
                            <UserAvatar name={person.username} username={person.username} photo={person.profilePhoto} className="h-9 w-9 text-[13px]" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-medium text-foreground">
                                {person.username}
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                if (person.alreadyFriends) openSearchProfile(person)
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
                        ref={(el) => {
                          if (el) rowMenuRefs.current.set(friend.id, el)
                          else rowMenuRefs.current.delete(friend.id)
                        }}
                        className="relative mx-3 flex w-[calc(100%-1.5rem)] items-center gap-3 rounded-2xl px-3 py-3 transition hover:bg-surface-2"
                      >
                        <button
                          type="button"
                          onClick={() => openChat(friend.id)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <span className="relative shrink-0">
                            <UserAvatar name={friend.displayName} username={friend.username || null} photo={friend.profilePhoto} className="h-9 w-9 text-[12px]" />
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
                                      ? `Remove ${friend.displayName} as a friend?`
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
                                      {rowMenuConfirm === "unfriend" ? "Remove friend" : "Block"}
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      openFriendProfile(friend)
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
                                    Remove friend
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setRowMenuConfirm("block")}
                                    className="w-full rounded-xl px-3 py-2.5 text-left text-[13px] text-danger hover:bg-surface-2"
                                  >
                                    Block
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => { setRowMenuFriendId(null); setReportingFriend({ userId: friend.userId, username: friend.username }) }}
                                    className="w-full rounded-xl px-3 py-2.5 text-left text-[13px] text-danger hover:bg-surface-2"
                                  >
                                    Report
                                  </button>
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
                      openFriendProfile(active)
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-1.5 py-1.5 text-left transition hover:bg-surface-2"
                  >
                    <UserAvatar name={active.displayName} username={active.username || null} photo={active.profilePhoto} className="h-8 w-8 text-[11px]" />
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
                        {/* The reply button lives in the same row as the
                            bubble, on its trailing (outer) side, so it's
                            reachable without covering the text — hidden
                            until the mouse is actually near that row
                            (group-hover), rather than sitting dimly visible
                            all the time. */}
                        <div className={`group flex max-w-[80%] items-end gap-1 ${isMine ? "ml-auto flex-row-reverse" : ""}`}>
                          <div className="min-w-0">
                            <div
                              className={`rounded-2xl px-3.5 py-2 text-[13px] leading-snug ${
                                isMine ? "bg-accent text-accent-foreground" : "bg-surface-2 text-foreground"
                              }`}
                            >
                              {message.replyToId && (() => {
                                const quoted = activeMessages.find((m) => m.id === message.replyToId)
                                return (
                                  <div
                                    className={`mb-1.5 rounded-md border-l-2 py-1 pl-2 text-[11px] ${
                                      isMine ? "border-accent-foreground/40 text-accent-foreground/75" : "border-foreground/25 text-muted"
                                    }`}
                                  >
                                    <p className="font-medium">
                                      {quoted ? (quoted.from === "me" ? "You" : active?.displayName ?? "Them") : "Original message"}
                                    </p>
                                    <p className="truncate">{quoted ? quoted.text : "Message no longer available"}</p>
                                  </div>
                                )
                              })()}
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
                          <button
                            type="button"
                            onClick={() => setReplyingTo(message)}
                            aria-label="Reply to this message"
                            className="mb-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted opacity-0 transition hover:bg-surface-2 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
                          >
                            <ReplyIcon className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                  {active && peerFriendTyping.has(active.id) && <TypingDots />}
                </div>

                {replyingTo && (
                  <div className="flex items-center gap-2 border-t border-border bg-surface-2 px-3 py-2">
                    <ReplyIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium text-muted">
                        Replying to {replyingTo.from === "me" ? "yourself" : active?.displayName ?? "them"}
                      </p>
                      <p className="truncate text-[12px] text-foreground">{replyingTo.text}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setReplyingTo(null)}
                      aria-label="Cancel reply"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
                    >
                      <CloseIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                {chatSendError && <p role="alert" className="px-3 py-2 text-[12px] text-danger">{chatSendError}</p>}
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    sendMessage()
                  }}
                  className={`flex items-center gap-1.5 p-3 ${replyingTo ? "" : "border-t border-border"}`}
                >
                  <input
                    value={draft}
                    onChange={(event) => {
                      setDraft(event.target.value)
                      setChatSendError(null)
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
                        <p className="truncate text-[14px] font-semibold text-foreground">{invite.username}</p>
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
                        onClick={() => openRequestProfile(request)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault()
                            openRequestProfile(request)
                          }
                        }}
                        aria-label={`View ${request.displayName}'s profile`}
                        className="mx-3 mb-3 grid cursor-pointer grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-3 rounded-2xl border border-border p-4 transition hover:bg-surface-2"
                      >
                        <UserAvatar name={request.displayName} username={request.username || null} photo={request.profilePhoto} className="h-11 w-11 text-[14px]" />
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
                            onClick={(event) => { event.stopPropagation(); onDeclineRequest(request.id) }}
                            className="min-h-11 rounded-xl border border-border px-3 py-2 text-[13px] font-medium text-muted transition hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
                          >
                            Decline
                          </button>
                          <button
                            type="button"
                            onClick={(event) => { event.stopPropagation(); onAcceptRequest(request.id) }}
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

    <ReportDialog
      open={!!reportingFriend}
      target={{ type: "user", id: reportingFriend?.username ?? "" }}
      submitOrdinary={reportingFriend ? (category, details) => onReportPerson(reportingFriend.userId, category, details) : undefined}
      onClose={() => setReportingFriend(null)}
    />
    </>
  )
}
