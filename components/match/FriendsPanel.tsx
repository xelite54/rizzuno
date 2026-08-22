"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "motion/react"
import { ChevronLeftIcon, CloseIcon, DotsIcon, MailIcon, SearchIcon, SendIcon, UsersIcon } from "@/components/icons"
import { isSameDay, formatDayLabel, formatTime } from "@/lib/chatFormat"
import { EASE_OUT, DURATION_QUICK, DURATION_BASE } from "@/lib/motion"
import type { DemoFriend, PendingRequest } from "@/hooks/useFriends"

type MessageContent = { kind: "text"; text: string } | { kind: "image"; dataUrl: string }
type FriendMessage = { id: string; from: "me" | "them"; content: MessageContent; ts: number }

type DirectoryPerson = { id: string; displayName: string; username: string }

// No real user-search backend exists yet — empty rather than fabricated
// results, so searching honestly shows "No one found" for everyone until
// there's a real directory to query.
const DIRECTORY: DirectoryPerson[] = []

type FriendsPanelProps = {
  open: boolean
  onClose: () => void
  friends: DemoFriend[]
  requests: PendingRequest[]
  blockedIds: string[]
  onAcceptRequest: (id: string) => void
  onDeclineRequest: (id: string) => void
  onRemoveFriend: (id: string) => void
  onBlockPerson: (id: string, displayName: string) => void
  /** Reported whenever unread message count changes, so the header's Friends icon can badge it. */
  onUnreadMessagesChange?: (count: number) => void
}

type View = "list" | "chat" | "requests"

export function FriendsPanel({
  open,
  onClose,
  friends,
  requests,
  blockedIds,
  onAcceptRequest,
  onDeclineRequest,
  onRemoveFriend,
  onBlockPerson,
  onUnreadMessagesChange,
}: FriendsPanelProps) {
  const [unread, setUnread] = useState<Record<string, number>>({})
  const [messages, setMessages] = useState<Record<string, FriendMessage[]>>({})
  const [view, setView] = useState<View>("list")
  const [activeId, setActiveId] = useState<string | null>(null)
  const [viewingRequesterId, setViewingRequesterId] = useState<string | null>(null)
  const [viewingFriendId, setViewingFriendId] = useState<string | null>(null)
  // Unfriend/Block both need a second tap to confirm before they actually
  // happen — one for the full-screen profile, one for the row "•••" menu
  // (they're separate surfaces, so separate confirm state).
  const [friendActionConfirm, setFriendActionConfirm] = useState<"unfriend" | "block" | null>(null)
  const [rowMenuConfirm, setRowMenuConfirm] = useState<"unfriend" | "block" | null>(null)
  const [draft, setDraft] = useState("")

  // Per-row "•••" menu on a friend in the list (View profile / Unfriend / Block).
  const [rowMenuFriendId, setRowMenuFriendId] = useState<string | null>(null)

  // Username search: a local directory to search, who's been sent a request,
  // and which searched person's full profile is currently open.
  const [searchActive, setSearchActive] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [sentRequestIds, setSentRequestIds] = useState<string[]>([])
  const [viewingSearchResultId, setViewingSearchResultId] = useState<string | null>(null)
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
  // that shared state.
  const totalUnread = Object.values(unread).reduce((sum, count) => sum + count, 0)
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
      setViewingSearchResultId(null)
      setSearchResultBlockConfirm(false)
    }, 250)
    return () => clearTimeout(timer)
  }, [open])

  const active = friends.find((friend) => friend.id === activeId) ?? null
  const activeMessages = active ? (messages[active.id] ?? []) : []

  function openChat(id: string) {
    setActiveId(id)
    setView("chat")
    setUnread((prev) => ({ ...prev, [id]: 0 }))
  }

  function sendMessage() {
    if (!active || !draft.trim()) return
    const text = draft.trim()
    const friendId = active.id
    const messageId = crypto.randomUUID()
    setDraft("")
    setMessages((prev) => ({
      ...prev,
      [friendId]: [...(prev[friendId] ?? []), { id: messageId, from: "me", content: { kind: "text", text }, ts: Date.now() }],
    }))
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
    setViewingSearchResultId(null)
    setFriendActionConfirm(null)
    setRowMenuConfirm(null)
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

  const trimmedQuery = searchQuery.trim().toLowerCase()
  // Blocked people never show up in search, whichever side did the blocking.
  const searchableDirectory = DIRECTORY.filter((person) => !blockedIds.includes(person.id))
  const searchResults = trimmedQuery
    ? searchableDirectory.filter(
        (person) =>
          person.username.toLowerCase().includes(trimmedQuery) ||
          person.displayName.toLowerCase().includes(trimmedQuery)
      )
    : []
  const viewingSearchResult = searchableDirectory.find((person) => person.id === viewingSearchResultId) ?? null

  function sendFriendRequest(id: string) {
    setSentRequestIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
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
            className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-surface md:w-96"
          >
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
                          className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted focus:outline-none"
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
                        <button
                          type="button"
                          onClick={() => setSearchActive(true)}
                          aria-label="Search people"
                          className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
                        >
                          <SearchIcon className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {requests.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setView("requests")}
                            aria-label={`${requests.length} friend request${requests.length === 1 ? "" : "s"}`}
                            className="relative flex h-8 w-8 items-center justify-center rounded-full text-muted transition hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
                          >
                            <MailIcon className="h-4 w-4" />
                            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-accent-foreground">
                              {requests.length}
                            </span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={onClose}
                          aria-label="Close friends"
                          className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
                        >
                          <CloseIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {searchActive && trimmedQuery && (
                  <div className="absolute inset-x-3 top-[68px] z-10 max-h-80 overflow-y-auto rounded-2xl border border-border bg-surface p-1.5 shadow-xl">
                    {searchResults.length === 0 ? (
                      <p className="px-3 py-4 text-center text-[13px] text-muted">No one found</p>
                    ) : (
                      searchResults.map((person) => {
                        const requested = sentRequestIds.includes(person.id)
                        return (
                          <div
                            key={person.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              setSearchResultBlockConfirm(false)
                              setViewingSearchResultId(person.id)
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault()
                                setSearchResultBlockConfirm(false)
                                setViewingSearchResultId(person.id)
                              }
                            }}
                            aria-label={`View ${person.displayName}'s profile`}
                            className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 transition hover:bg-surface-2"
                          >
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-2 text-[13px] font-semibold text-accent-foreground">
                              {person.displayName.charAt(0)}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-medium text-foreground">
                                {person.displayName}
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                sendFriendRequest(person.id)
                              }}
                              disabled={requested}
                              className="shrink-0 rounded-lg bg-accent px-2.5 py-1.5 text-[12px] font-medium text-accent-foreground transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 disabled:opacity-50"
                            >
                              {requested ? "Requested" : "Add"}
                            </button>
                          </div>
                        )
                      })
                    )}
                  </div>
                )}

                {friends.length === 0 ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-2">
                      <UsersIcon className="h-6 w-6 text-muted" />
                    </div>
                    <p className="text-[14px] font-medium text-foreground">No friends yet</p>
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto py-2">
                    {friends.map((friend) => (
                      <div
                        key={friend.id}
                        className="relative flex w-full items-center gap-2 px-5 py-3 transition hover:bg-surface-2"
                      >
                        <button
                          type="button"
                          onClick={() => openChat(friend.id)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <span className="relative shrink-0">
                            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-2 text-[14px] font-semibold text-accent-foreground">
                              {friend.displayName.charAt(0)}
                            </span>
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
                        {(unread[friend.id] ?? 0) > 0 && (
                          <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-foreground">
                            {unread[friend.id]}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setRowMenuConfirm(null)
                            setRowMenuFriendId((prev) => (prev === friend.id ? null : friend.id))
                          }}
                          aria-label={`More options for ${friend.displayName}`}
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 ${
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
                                      className="flex-1 rounded-lg border border-border py-1.5 text-[12px] font-medium text-muted transition hover:bg-surface-2 hover:text-foreground"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (rowMenuConfirm === "block") {
                                          handleBlockPerson(friend.id, friend.displayName)
                                        } else {
                                          handleRemoveFriend(friend.id)
                                        }
                                        setRowMenuFriendId(null)
                                      }}
                                      className="flex-1 rounded-lg bg-danger py-1.5 text-[12px] font-medium text-accent-foreground transition hover:brightness-110"
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
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
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
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-2 text-[12px] font-semibold text-accent-foreground">
                      {active.displayName.charAt(0)}
                    </span>
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
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
                  >
                    <CloseIcon className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex-1 space-y-1 overflow-y-auto px-4 py-3">
                  {activeMessages.map((message, index) => {
                    const previous = activeMessages[index - 1]
                    const showDayLabel = !previous || !isSameDay(new Date(previous.ts), new Date(message.ts))
                    const isMine = message.from === "me"
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
                          {message.content.kind === "image" ? (
                            // eslint-disable-next-line @next/next/no-img-element -- local/data-URL chat images, not a static asset
                            <img
                              src={message.content.dataUrl}
                              alt="Shared photo"
                              className="max-h-48 w-auto rounded-xl border border-border object-cover"
                            />
                          ) : (
                            <div
                              className={`rounded-2xl px-3.5 py-2 text-[13px] leading-snug ${
                                isMine ? "bg-accent text-accent-foreground" : "bg-surface-2 text-foreground"
                              }`}
                            >
                              {message.content.text}
                            </div>
                          )}
                          <div className={`mt-1 flex items-center gap-1 px-1 text-[10px] text-muted ${isMine ? "justify-end" : ""}`}>
                            <span>{formatTime(message.ts)}</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    sendMessage()
                  }}
                  className="flex items-center gap-1.5 border-t border-border p-3"
                >
                  <input
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
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
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
                    >
                      <ChevronLeftIcon className="h-4 w-4" />
                    </button>
                    <h2 className="text-[15px] font-semibold text-foreground">Friend requests</h2>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close friends"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
                  >
                    <CloseIcon className="h-4 w-4" />
                  </button>
                </div>

                {requests.length === 0 ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-2">
                      <MailIcon className="h-6 w-6 text-muted" />
                    </div>
                    <p className="text-[14px] font-medium text-foreground">No pending requests</p>
                  </div>
                ) : (
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
                        className="flex cursor-pointer items-center gap-3 px-5 py-3 transition hover:bg-surface-2"
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
                          className="flex shrink-0 items-center gap-1.5"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => handleDeclineRequest(request.id)}
                            className="rounded-lg border border-border px-2.5 py-1.5 text-[12px] font-medium text-muted transition hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
                          >
                            Decline
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAcceptRequest(request.id)}
                            className="rounded-lg bg-accent px-2.5 py-1.5 text-[12px] font-medium text-accent-foreground transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
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
              className="fixed inset-0 z-[60] flex flex-col bg-surface"
            >
              <div className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-4">
                <span className="flex-1 text-[15px] font-semibold text-foreground">Profile</span>
                <button
                  type="button"
                  onClick={() => setViewingRequesterId(null)}
                  aria-label="Close"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </div>

              <div className="flex flex-1 flex-col items-center px-6 py-10 text-center">
                <span className="flex h-24 w-24 items-center justify-center rounded-full bg-accent-2 text-[32px] font-semibold text-accent-foreground">
                  {viewingRequester.displayName.charAt(0)}
                </span>
                <p className="mt-4 text-[18px] font-semibold text-foreground">{viewingRequester.displayName}</p>
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

                <div className="mt-8 w-full max-w-lg">
                  <div className="flex items-center justify-center py-10 text-[13px] text-muted">No posts yet</div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {viewingFriend && (
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={`${viewingFriend.displayName}'s profile`}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              transition={{ type: "tween", duration: DURATION_BASE, ease: EASE_OUT }}
              className="fixed inset-0 z-[60] flex flex-col bg-surface"
            >
              <div className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-4">
                <span className="flex-1 text-[15px] font-semibold text-foreground">Profile</span>
                <button
                  type="button"
                  onClick={() => setViewingFriendId(null)}
                  aria-label="Close"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </div>

              <div className="flex flex-1 flex-col items-center px-6 py-10 text-center">
                <span className="flex h-24 w-24 items-center justify-center rounded-full bg-accent-2 text-[32px] font-semibold text-accent-foreground">
                  {viewingFriend.displayName.charAt(0)}
                </span>
                <p className="mt-4 text-[18px] font-semibold text-foreground">{viewingFriend.displayName}</p>
                <p className="mt-2 text-[12px] text-muted">{viewingFriend.online ? "Online now" : "Offline"}</p>

                <div className="mt-8 w-full max-w-xs border-t border-border pt-4">
                  {friendActionConfirm ? (
                    <>
                      <p className="mb-3 text-[13px] leading-relaxed text-muted">
                        {friendActionConfirm === "unfriend"
                          ? `Unfriend ${viewingFriend.displayName}?`
                          : `Block ${viewingFriend.displayName}? They won't be able to contact you.`}
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setFriendActionConfirm(null)}
                          className="flex-1 rounded-lg border border-border px-4 py-2.5 text-[13px] font-medium text-muted transition hover:bg-surface-2 hover:text-foreground"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            friendActionConfirm === "block"
                              ? handleBlockPerson(viewingFriend.id, viewingFriend.displayName)
                              : handleRemoveFriend(viewingFriend.id)
                          }
                          className="flex-1 rounded-lg bg-danger px-4 py-2.5 text-[13px] font-medium text-accent-foreground transition hover:brightness-110"
                        >
                          {friendActionConfirm === "unfriend" ? "Unfriend" : "Block"}
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => setFriendActionConfirm("unfriend")}
                        className="w-full rounded-xl px-3 py-2.5 text-[13px] text-foreground transition hover:bg-surface-2"
                      >
                        Unfriend
                      </button>
                      <button
                        type="button"
                        onClick={() => setFriendActionConfirm("block")}
                        className="w-full rounded-xl px-3 py-2.5 text-[13px] text-danger transition hover:bg-surface-2"
                      >
                        Block
                      </button>
                    </div>
                  )}
                </div>

                <div className="mt-8 w-full max-w-lg">
                  <div className="flex items-center justify-center py-10 text-[13px] text-muted">No posts yet</div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {viewingSearchResult && (
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={`${viewingSearchResult.displayName}'s profile`}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              transition={{ type: "tween", duration: DURATION_BASE, ease: EASE_OUT }}
              className="fixed inset-0 z-[60] flex flex-col bg-surface"
            >
              <div className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-4">
                <span className="flex-1 text-[15px] font-semibold text-foreground">Profile</span>
                <button
                  type="button"
                  onClick={() => setViewingSearchResultId(null)}
                  aria-label="Close"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </div>

              <div className="flex flex-1 flex-col items-center px-6 py-10 text-center">
                <span className="flex h-24 w-24 items-center justify-center rounded-full bg-accent-2 text-[32px] font-semibold text-accent-foreground">
                  {viewingSearchResult.displayName.charAt(0)}
                </span>
                <p className="mt-4 text-[18px] font-semibold text-foreground">{viewingSearchResult.displayName}</p>

                <div className="mt-6 w-full max-w-xs">
                  {searchResultBlockConfirm ? (
                    <>
                      <p className="mb-3 text-[13px] leading-relaxed text-muted">
                        Block {viewingSearchResult.displayName}? They won&apos;t be able to contact you, and won&apos;t
                        show up in search.
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setSearchResultBlockConfirm(false)}
                          className="flex-1 rounded-lg border border-border px-4 py-2.5 text-[13px] font-medium text-muted transition hover:bg-surface-2 hover:text-foreground"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => handleBlockPerson(viewingSearchResult.id, viewingSearchResult.displayName)}
                          className="flex-1 rounded-lg bg-danger px-4 py-2.5 text-[13px] font-medium text-accent-foreground transition hover:brightness-110"
                        >
                          Block
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => sendFriendRequest(viewingSearchResult.id)}
                        disabled={sentRequestIds.includes(viewingSearchResult.id)}
                        className="w-full rounded-lg bg-accent px-4 py-2.5 text-[13px] font-medium text-accent-foreground transition hover:brightness-110 disabled:opacity-50"
                      >
                        {sentRequestIds.includes(viewingSearchResult.id) ? "Requested" : "Add friend"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSearchResultBlockConfirm(true)}
                        className="mt-2 w-full rounded-lg px-4 py-2 text-[13px] font-medium text-danger transition hover:bg-surface-2"
                      >
                        Block
                      </button>
                    </>
                  )}
                </div>

                <div className="mt-8 w-full max-w-lg">
                  <div className="flex items-center justify-center py-10 text-[13px] text-muted">No posts yet</div>
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
