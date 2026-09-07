"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"

type Profile = { bio: string; posts: { id: string; dataUrl: string }[] }

export function PublicProfilePosts({ username }: { username?: string | null }) {
  const [result, setResult] = useState<{ owner: string; profile?: Profile; error?: string } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  useEffect(() => {
    if (!username) return
    const controller = new AbortController()
    fetch(`/api/profile/public/${encodeURIComponent(username)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 404 ? "Profile unavailable." : "Couldn’t load posts.")
        return response.json() as Promise<Profile>
      })
      .then((profile) => { if (!controller.signal.aborted) setResult({ owner: username, profile }) })
      .catch((error: Error) => { if (!controller.signal.aborted) setResult({ owner: username, error: error.message }) })
    return () => controller.abort()
  }, [username, attempt])
  useEffect(() => {
    if (!selected) return
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setSelected(null) }
    document.addEventListener("keydown", close)
    return () => document.removeEventListener("keydown", close)
  }, [selected])
  const current = result?.owner === username ? result : null
  if (!username) return <p className="py-6 text-xs text-muted">Profile unavailable.</p>
  if (!current) return <p role="status" className="py-6 text-xs text-muted">Loading posts…</p>
  if (current.error) return <div className="py-6 text-xs text-muted"><p role="alert">{current.error}</p><button className="mt-3 underline" onClick={() => { setResult(null); setAttempt((value) => value + 1) }}>Try again</button></div>
  return <div className="w-full">
    {current.profile?.bio && <p className="mb-5 whitespace-pre-wrap break-words text-sm text-muted">{current.profile.bio}</p>}
    {current.profile?.posts.length ? <div className="grid grid-cols-3 gap-2">
      {current.profile.posts.map((post) => <button key={post.id} onClick={() => setSelected(post.dataUrl)} aria-label="Enlarge photo" className="aspect-square overflow-hidden rounded-xl focus-visible:outline-2 focus-visible:outline-accent">
        {/* eslint-disable-next-line @next/next/no-img-element -- moderated user upload */}
        <img src={post.dataUrl} alt="Profile post" className="h-full w-full object-cover" />
      </button>)}
    </div> : <p className="py-6 text-xs text-muted">No posts yet</p>}
    {selected && createPortal(<div role="dialog" aria-modal="true" aria-label="Expanded photo" className="fixed inset-0 z-[100] flex items-center justify-center bg-[#09070df5] p-6" onClick={() => setSelected(null)}>
      <button autoFocus onClick={() => setSelected(null)} aria-label="Close photo" className="absolute right-5 top-5 h-11 w-11 rounded-full border border-white/20 text-2xl text-white">×</button>
      {/* eslint-disable-next-line @next/next/no-img-element -- moderated user upload */}
      <img src={selected} alt="Expanded profile post" className="max-h-[85dvh] max-w-full rounded-lg object-contain" onClick={(event) => event.stopPropagation()} />
    </div>, document.body)}
  </div>
}
